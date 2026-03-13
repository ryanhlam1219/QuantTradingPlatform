"""
Portfolio Builder Service.

Takes a list of (symbol, strategy) pairs and:
  1. Runs a 1-year backtest for each pair
  2. Computes Sharpe-weighted capital allocation
  3. Applies floor (min 5%) and ceiling (max 40%) per position
  4. Asks Ollama to review and rate the portfolio
  5. Returns a structured plan ready for user approval and execution

Execution (after approval):
  - Places all market orders simultaneously via AlpacaExecutor
  - Returns per-order results with success/failure per symbol
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.config import settings
from app.brokers import get_broker
from app.models.candlestick import Timeframe, Broker
from app.models.backtest import BacktestConfig
from app.backtesting.engine import BacktestEngine
from app.executor.alpaca_executor import AlpacaExecutor
from app.services.ollama import ollama

log = logging.getLogger(__name__)

_engine   = BacktestEngine()
_executor = AlpacaExecutor()

# Allocation constraints
MIN_WEIGHT = 0.05   # no position gets less than 5%
MAX_WEIGHT = 0.40   # no position gets more than 40%


def _sharpe_weighted_allocation(
    items: list[dict],
    total_capital: float,
) -> list[dict]:
    """
    Compute Sharpe-weighted capital allocation with floor/ceiling.

    items: list of dicts with at least {"symbol", "strategy", "sharpe_ratio"}
    Returns items enriched with {"weight", "weight_pct", "capital", "shares"}
    """
    if not items:
        return []

    # Shift sharpes so all are positive (floor at 0.01 to avoid zero-weight positions)
    sharpes = [max(item["sharpe_ratio"], 0.01) for item in items]
    total_sharpe = sum(sharpes)

    # Raw weights
    weights = [s / total_sharpe for s in sharpes]

    # Clip to [MIN_WEIGHT, MAX_WEIGHT] and renormalise once
    clipped = [max(MIN_WEIGHT, min(MAX_WEIGHT, w)) for w in weights]
    clip_total = sum(clipped)
    normalised = [w / clip_total for w in clipped]

    for i, item in enumerate(items):
        w       = normalised[i]
        capital = total_capital * w
        price   = item.get("current_price", 1.0)
        shares  = max(1, int(capital / price)) if price > 0 else 1
        item["weight"]     = round(w, 4)
        item["weight_pct"] = round(w * 100, 2)
        item["capital"]    = round(capital, 2)
        item["shares"]     = shares

    return items


async def _deduplicate_by_correlation(
    items: list[dict],
    threshold: float = 0.85,
    lookback_days: int = 90,
) -> list[dict]:
    """
    Drop one of any pair of assets with Pearson correlation > threshold,
    keeping the one with the higher Sharpe ratio to improve diversification.
    """
    if len(items) < 2:
        return items

    import numpy as np

    broker = get_broker(Broker.ALPACA)
    end    = datetime.now(timezone.utc)
    start  = end - timedelta(days=lookback_days + 5)

    async def fetch_closes(sym: str):
        try:
            series = await broker.get_candles(sym, Timeframe.D1, start, end, limit=lookback_days + 5)
            closes = [c.close for c in sorted(series.candles, key=lambda c: c.timestamp)]
            return sym, closes
        except Exception:
            return sym, []

    fetched    = await asyncio.gather(*[fetch_closes(it["symbol"]) for it in items])
    closes_map = {sym: closes for sym, closes in fetched if len(closes) >= 10}

    def daily_returns(closes):
        arr = np.array(closes)
        return np.diff(arr) / arr[:-1] if len(arr) >= 2 else np.array([0.0])

    dropped: set[int] = set()
    for i in range(len(items)):
        if i in dropped:
            continue
        sym_i = items[i]["symbol"]
        ret_i = daily_returns(closes_map.get(sym_i, [1.0, 1.0]))
        for j in range(i + 1, len(items)):
            if j in dropped:
                continue
            sym_j = items[j]["symbol"]
            ret_j = daily_returns(closes_map.get(sym_j, [1.0, 1.0]))
            min_len = min(len(ret_i), len(ret_j))
            if min_len < 5:
                continue
            corr = float(np.corrcoef(ret_i[-min_len:], ret_j[-min_len:])[0, 1])
            if corr != corr:   # NaN guard
                continue
            if corr > threshold:
                if items[i].get("sharpe_ratio", 0) >= items[j].get("sharpe_ratio", 0):
                    dropped.add(j)
                    log.info("Correlation filter: dropped %s (corr %.2f with %s)", sym_j, corr, sym_i)
                else:
                    dropped.add(i)
                    log.info("Correlation filter: dropped %s (corr %.2f with %s)", sym_i, corr, sym_j)
                    break

    return [it for idx, it in enumerate(items) if idx not in dropped]


async def _backtest_pair(
    symbol: str,
    strategy: str,
    current_price: float,
) -> dict:
    """Run a 1-year backtest for symbol+strategy. Returns enriched dict."""
    broker = get_broker(Broker.ALPACA)
    end    = datetime.now(timezone.utc)
    start  = end - timedelta(days=365)

    base = {
        "symbol":        symbol,
        "strategy":      strategy,
        "current_price": current_price,
        "sharpe_ratio":  0.01,    # fallback so weight calc still works
        "total_return":  0.0,
        "max_drawdown":  0.0,
        "win_rate":      0.0,
        "total_trades":  0,
        "error":         None,
    }

    try:
        series = await broker.get_candles(symbol, Timeframe.D1, start, end, limit=365)
        if not series or len(series.candles) < 30:
            raise ValueError(f"Only {len(series.candles) if series else 0} candles")

        config = BacktestConfig(
            symbol=symbol,
            strategy=strategy,
            start_date=series.candles[0].timestamp,
            end_date=series.candles[-1].timestamp,
            initial_capital=10_000.0,
        )
        result = _engine.run(config, series)
        base.update({
            "sharpe_ratio":  result.sharpe_ratio,
            "total_return":  result.total_return,
            "max_drawdown":  result.max_drawdown,
            "win_rate":      result.win_rate,
            "total_trades":  result.total_trades,
        })
    except Exception as e:
        log.warning("Backtest failed %s/%s: %s", symbol, strategy, e)
        base["error"] = str(e)

    return base


async def build_portfolio(
    pairs: list[dict],        # [{"symbol": str, "strategy": str, "current_price": float}, ...]
    total_capital: float,
    review_with_ai: bool = True,
) -> dict:
    """
    Build a complete portfolio plan from strategy-asset pairs.

    Returns:
    {
      items: [{symbol, strategy, sharpe_ratio, weight, weight_pct, capital, shares, ...}],
      total_capital,
      ai_review (Ollama rating or fallback),
      built_at
    }
    """
    if not pairs:
        return {"error": "No asset-strategy pairs provided", "items": []}

    # Run all backtests concurrently (capped at 5 parallel to avoid rate limits)
    sem = asyncio.Semaphore(5)

    async def bounded(pair: dict):
        async with sem:
            return await _backtest_pair(
                pair["symbol"],
                pair["strategy"],
                pair.get("current_price", 0.0),
            )

    items = await asyncio.gather(*[bounded(p) for p in pairs])
    items = list(items)

    # ── Correlation filter ────────────────────────────────────────────────────
    # If two holdings have daily-return correlation > 0.85, keep only the
    # higher-Sharpe one to improve diversification.
    items = await _deduplicate_by_correlation(items, threshold=0.85)

    # Allocation
    items = _sharpe_weighted_allocation(items, total_capital)

    # AI review
    ai_review = {}
    if review_with_ai:
        ai_review = await ollama.rate_portfolio(items, total_capital)

    return {
        "items":          items,
        "total_capital":  total_capital,
        "ai_review":      ai_review,
        "built_at":       datetime.now(timezone.utc).isoformat(),
    }


async def execute_portfolio(
    items: list[dict],
    dry_run: bool = False,
) -> list[dict]:
    """
    Execute all portfolio positions simultaneously.

    items: each must have {symbol, strategy, shares, side}
    Returns list of {symbol, strategy, shares, order_result, success, error}
    """
    sem = asyncio.Semaphore(5)

    async def place(item: dict) -> dict:
        async with sem:
            sym    = item["symbol"]
            side   = item.get("side", "buy")
            shares = item.get("shares", 1)
            out    = {"symbol": sym, "strategy": item.get("strategy"), "shares": shares, "side": side}
            if dry_run:
                out.update({"success": True, "dry_run": True, "order_result": {"status": "simulated"}})
                return out
            try:
                order = await _executor.place_order(
                    symbol=sym, qty=shares, side=side,
                    order_type="market", time_in_force="day",
                )
                out.update({"success": True, "order_result": order})
            except Exception as e:
                err_str = str(e)
                if "403" in err_str:
                    err_str = "Insufficient buying power for this order (Alpaca 403)."
                log.error("Order failed %s: %s", sym, e)
                out.update({"success": False, "error": err_str, "order_result": None})
            return out

    results = await asyncio.gather(*[place(item) for item in items])
    return list(results)


# ─────────────────────────────────────────────────────────────────────────────
# Walk-Forward Validation
# ─────────────────────────────────────────────────────────────────────────────

async def _backtest_pair_window(
    symbol: str,
    strategy: str,
    current_price: float,
    start: datetime,
    end: datetime,
    label: str,
) -> dict:
    """Run a backtest for a specific date window. Returns metrics + equity curve."""
    broker = get_broker(Broker.ALPACA)
    base = {
        "symbol":        symbol,
        "strategy":      strategy,
        "current_price": current_price,
        "window":        label,
        "sharpe_ratio":  0.0,
        "total_return":  0.0,
        "max_drawdown":  0.0,
        "win_rate":      0.0,
        "total_trades":  0,
        "equity_curve":  [],
        "error":         None,
    }
    try:
        series = await broker.get_candles(symbol, Timeframe.D1, start, end, limit=500)
        if not series or len(series.candles) < 10:
            raise ValueError(f"Only {len(series.candles) if series else 0} candles in window")
        config = BacktestConfig(
            symbol=symbol,
            strategy=strategy,
            start_date=series.candles[0].timestamp,
            end_date=series.candles[-1].timestamp,
            initial_capital=10_000.0,
        )
        result = _engine.run(config, series)
        base.update({
            "sharpe_ratio": result.sharpe_ratio,
            "total_return": result.total_return,
            "max_drawdown": result.max_drawdown,
            "win_rate":     result.win_rate,
            "total_trades": result.total_trades,
            "equity_curve": result.equity_curve,
        })
    except Exception as e:
        log.warning("Window backtest failed %s/%s [%s]: %s", symbol, strategy, label, e)
        base["error"] = str(e)
    return base


def _validation_verdict(items: list[dict]) -> dict:
    """
    Compute an overall walk-forward validation verdict.

    Compares out-of-sample (OOS) Sharpe to in-sample (IS) Sharpe.
    Strategy degrades significantly if OOS / IS < 0.5 or OOS < 0.
    """
    valid = [i for i in items if not i.get("oos_error") and not i.get("is_error")]
    if not valid:
        return {"verdict": "INSUFFICIENT_DATA", "confidence_score": 0, "detail": "Not enough data for validation."}

    avg_is  = sum(i["is_sharpe"]  for i in valid) / len(valid)
    avg_oos = sum(i["oos_sharpe"] for i in valid) / len(valid)

    # Degradation ratio: how much OOS drops vs IS
    if avg_is <= 0:
        ratio = 1.0 if avg_oos >= 0 else 0.0
    else:
        ratio = avg_oos / avg_is

    # Confidence score 0–100
    # 100 = OOS matches IS perfectly
    # 50  = OOS is half of IS (some degradation, expected)
    # 0   = OOS is negative while IS was positive
    confidence = max(0, min(100, int(ratio * 80 + (20 if avg_oos > 0 else 0))))

    # Verdict
    positive_oos = sum(1 for i in valid if i["oos_return"] > 0)
    pos_pct = positive_oos / len(valid)

    if avg_oos >= 0.5 and ratio >= 0.6 and pos_pct >= 0.5:
        verdict = "VALIDATED"
        summary = (
            f"Out-of-sample Sharpe ({avg_oos:.2f}) is {ratio*100:.0f}% of in-sample ({avg_is:.2f}). "
            f"{positive_oos}/{len(valid)} positions were profitable in the hold-out period. "
            "Strategy shows reasonable persistence."
        )
    elif avg_oos >= 0 and ratio >= 0.3:
        verdict = "CAUTION"
        summary = (
            f"Out-of-sample Sharpe ({avg_oos:.2f}) is only {ratio*100:.0f}% of in-sample ({avg_is:.2f}). "
            "Significant degradation — the strategy may be overfitted to the training period. "
            "Consider reducing position sizes or extending the evaluation period."
        )
    else:
        verdict = "REJECTED"
        summary = (
            f"Out-of-sample Sharpe ({avg_oos:.2f}) does not support in-sample results ({avg_is:.2f}). "
            "The strategy does not appear to generalise to the hold-out period. "
            "Avoid executing this portfolio without further investigation."
        )

    return {
        "verdict":          verdict,
        "confidence_score": confidence,
        "avg_is_sharpe":    round(avg_is, 3),
        "avg_oos_sharpe":   round(avg_oos, 3),
        "degradation_pct":  round((1 - ratio) * 100, 1),
        "profitable_oos":   f"{positive_oos}/{len(valid)}",
        "summary":          summary,
    }


async def validate_portfolio(
    pairs: list[dict],
    oos_days: int = 90,
) -> dict:
    """
    Walk-forward validation.

    For each (symbol, strategy) pair:
      - In-sample  (IS):  365 days before the hold-out period
      - Out-of-sample (OOS): the most recent `oos_days` days

    This tests whether the strategies that looked good on a full-year backtest
    also performed during the most recent period — which was NOT used to select them.

    Args:
        pairs:    same format as build_portfolio pairs
        oos_days: length of the hold-out window (30, 60, or 90 days)

    Returns:
        {
          oos_days,
          items: [{symbol, strategy, is_sharpe, is_return, oos_sharpe, oos_return, ...}],
          verdict: {verdict, confidence_score, summary, ...},
          validated_at
        }
    """
    now     = datetime.now(timezone.utc)
    oos_end   = now
    oos_start = now - timedelta(days=oos_days)
    is_end    = oos_start
    is_start  = is_end - timedelta(days=365)

    sem = asyncio.Semaphore(4)

    async def run_pair(pair: dict):
        async with sem:
            sym      = pair["symbol"]
            strategy = pair["strategy"]
            price    = pair.get("current_price", 0.0)

            is_result, oos_result = await asyncio.gather(
                _backtest_pair_window(sym, strategy, price, is_start, is_end,  "in_sample"),
                _backtest_pair_window(sym, strategy, price, oos_start, oos_end, "out_of_sample"),
            )

            return {
                "symbol":        sym,
                "strategy":      strategy,
                "is_sharpe":     is_result["sharpe_ratio"],
                "is_return":     is_result["total_return"],
                "is_max_dd":     is_result["max_drawdown"],
                "is_trades":     is_result["total_trades"],
                "oos_sharpe":    oos_result["sharpe_ratio"],
                "oos_return":    oos_result["total_return"],
                "oos_max_dd":    oos_result["max_drawdown"],
                "oos_trades":    oos_result["total_trades"],
                "oos_equity":    oos_result["equity_curve"],
                "is_error":      is_result.get("error"),
                "oos_error":     oos_result.get("error"),
            }

    items = list(await asyncio.gather(*[run_pair(p) for p in pairs]))
    verdict = _validation_verdict(items)

    return {
        "oos_days":      oos_days,
        "is_period":     f"{is_start.date()} → {is_end.date()}",
        "oos_period":    f"{oos_start.date()} → {oos_end.date()}",
        "items":         items,
        "verdict":       verdict,
        "validated_at":  now.isoformat(),
    }
