"""
Cycle Backtest Service.

Simulates an AutoTrader cycle strategy over historical data using a
walk-forward methodology — at each rebalance point, the allocator
only sees data available up to that date (no look-ahead bias).

Process:
  1. Fetch `total_days + lookback_days` of daily candles for all symbols.
  2. Walk forward day-by-day, pausing at each rebalance interval.
  3. At each rebalance: run all strategy backtests on the trailing
     `lookback_days` window → Sharpe-weighted allocation → rebalance portfolio.
  4. Between rebalances: track portfolio value from daily close prices.
  5. Return equity curve, per-rebalance events, aggregate metrics, and
     a buy-and-hold benchmark for comparison.

Note: LLM allocation is intentionally NOT used in the hot backtest loop —
it would be non-deterministic and slow. Sharpe-weighted allocation is the
ground-truth replay. The LLM can still run a single current-state recommendation
(returned as `ai_commentary`) if Ollama is available.
"""
import asyncio
import logging
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.brokers import get_broker
from app.models.candlestick import Timeframe, Broker
from app.models.backtest import BacktestConfig
from app.backtesting.engine import BacktestEngine
from app.algorithms import STRATEGY_REGISTRY
from app.services.autotrader import MIN_WEIGHT, MAX_WEIGHT

log = logging.getLogger(__name__)

_engine = BacktestEngine()

# Max strategies to backtest per symbol per rebalance (keep fast)
MAX_STRATEGIES = 5
# Semaphore: concurrent symbol fetches
FETCH_SEM = 3


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe(v: float) -> float:
    if v != v or v == float("inf"):
        return 9999.0
    if v == float("-inf"):
        return -9999.0
    return v


def _sharpe_alloc(symbol_sharpes: dict[str, float]) -> dict[str, float]:
    """Convert {symbol: sharpe} → {symbol: weight} with floor/ceiling."""
    syms = list(symbol_sharpes.keys())
    sharpes = [max(symbol_sharpes[s], 0.01) for s in syms]
    total = sum(sharpes)
    raw = [s / total for s in sharpes]
    clipped = [max(MIN_WEIGHT, min(MAX_WEIGHT, w)) for w in raw]
    clip_sum = sum(clipped)
    normalised = [w / clip_sum for w in clipped]
    return {syms[i]: round(normalised[i], 6) for i in range(len(syms))}


def _best_sharpe_for_symbol(symbol: str, candles, end_date: datetime) -> tuple[float, str]:
    """
    Run all strategies on the candle slice ending at end_date.
    Returns (best_sharpe, best_strategy_name).
    """
    start_date = candles[0].timestamp if candles else end_date - timedelta(days=90)
    strategies = list(STRATEGY_REGISTRY.keys())[:MAX_STRATEGIES]
    best_sharpe = 0.01
    best_strat  = strategies[0] if strategies else "rsi"

    from app.models.candlestick import CandleSeries
    series = CandleSeries(
        symbol=symbol,
        timeframe=Timeframe.D1,
        candles=candles,
        broker=Broker.ALPACA,
    )

    for strat_name in strategies:
        try:
            cfg = BacktestConfig(
                symbol=symbol,
                strategy=strat_name,
                start_date=start_date,
                end_date=end_date,
                initial_capital=10_000.0,
                timeframe=Timeframe.D1,
                broker=Broker.ALPACA,
                commission=0.001,
                slippage=0.001,
            )
            result = _engine.run(cfg, series)
            sr = _safe(result.sharpe_ratio)
            if sr > best_sharpe:
                best_sharpe = sr
                best_strat  = strat_name
        except Exception:
            pass

    return best_sharpe, best_strat


def _candles_up_to(candles: list, cutoff: datetime) -> list:
    """Return candles with timestamp <= cutoff (all tz-aware)."""
    cutoff_utc = cutoff.astimezone(timezone.utc)
    return [c for c in candles if c.timestamp.astimezone(timezone.utc) <= cutoff_utc]


def _compute_returns(candles: list) -> dict[str, float]:
    """Build a {date_str: close} dict from a candle list."""
    return {
        c.timestamp.astimezone(timezone.utc).strftime("%Y-%m-%d"): c.close
        for c in candles
    }


# ── Main ──────────────────────────────────────────────────────────────────────

async def run_cycle_backtest(
    symbols:              list[str],
    total_capital:        float,
    rebalance_every_days: int = 7,
    total_days:           int = 365,
    lookback_days:        int = 90,
) -> dict:
    """
    Walk-forward cycle backtest.

    Args:
        symbols:              Assets to simulate
        total_capital:        Starting capital ($)
        rebalance_every_days: How often the cycle fires (maps from interval_minutes)
        total_days:           Length of simulation window in days
        lookback_days:        Rolling window (days) used for strategy evaluation

    Returns a dict with:
        equity_curve:       [{date, equity, benchmark_equity}]
        rebalance_events:   [{date, weights, best_strategies, sharpes, portfolio_value}]
        metrics:            {total_return, annualized_return, sharpe, max_drawdown,
                             win_rate, total_rebalances, ...}
        benchmark_metrics:  same shape, for equal-weight buy-and-hold
        symbols_used:       list of symbols that had valid data
        errors:             {symbol: error_message}
    """
    # Clamp inputs
    rebalance_every_days = max(1, rebalance_every_days)
    total_days           = max(30, min(total_days, 1825))   # 1 month – 5 years
    lookback_days        = max(30, min(lookback_days, 365))

    end_date   = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=total_days + lookback_days + 10)  # +10 buffer

    # ── 1. Fetch candles ──────────────────────────────────────────────────────
    sem = asyncio.Semaphore(FETCH_SEM)

    async def fetch(sym: str) -> tuple[str, list, Optional[str]]:
        async with sem:
            try:
                broker = get_broker(Broker.ALPACA)
                series = await broker.get_candles(
                    symbol=sym,
                    timeframe=Timeframe.D1,
                    start=start_date,
                    end=end_date,
                    limit=10000,
                )
                if not series.candles:
                    return sym, [], "No candle data returned"
                return sym, series.candles, None
            except Exception as e:
                return sym, [], str(e)

    log.info("CycleBacktest: fetching candles for %d symbols", len(symbols))
    fetch_results = await asyncio.gather(*[fetch(s) for s in symbols])

    candles_map: dict[str, list] = {}
    errors: dict[str, str] = {}
    for sym, candles, err in fetch_results:
        if err:
            errors[sym] = err
        else:
            candles_map[sym] = candles

    valid_syms = list(candles_map.keys())
    if not valid_syms:
        return {"error": "No historical data could be fetched for any symbol.", "items": []}

    # ── 2. Build common date spine ────────────────────────────────────────────
    # All trading dates in the simulation window
    sim_start = end_date - timedelta(days=total_days)

    # Collect all dates from all symbols, intersected to common trading days
    date_sets = []
    for sym in valid_syms:
        date_sets.append({
            c.timestamp.astimezone(timezone.utc).strftime("%Y-%m-%d")
            for c in candles_map[sym]
            if c.timestamp.astimezone(timezone.utc) >= sim_start
        })
    common_dates = sorted(set.intersection(*date_sets)) if date_sets else []

    if len(common_dates) < rebalance_every_days:
        return {"error": f"Not enough overlapping trading days ({len(common_dates)}) to run backtest.", "items": []}

    # Close price lookup: {sym: {date_str: close}}
    close_map: dict[str, dict[str, float]] = {
        sym: _compute_returns(candles_map[sym]) for sym in valid_syms
    }

    # ── 3. Walk forward ───────────────────────────────────────────────────────
    portfolio_equity = total_capital
    # Equal-weight buy-and-hold benchmark: buy equal shares on day 0, hold
    bh_starts = {sym: close_map[sym].get(common_dates[0], None) for sym in valid_syms}
    bh_valid  = [s for s in valid_syms if bh_starts[s]]
    bh_eq_wt  = 1.0 / len(bh_valid) if bh_valid else 0
    bh_shares = {s: (total_capital * bh_eq_wt) / bh_starts[s] for s in bh_valid}

    equity_curve: list[dict] = []
    rebalance_events: list[dict] = []

    # Current holdings: {sym: shares}
    holdings: dict[str, float] = {}
    # Track for Sharpe calc on daily returns
    daily_returns: list[float] = []
    prev_equity = total_capital

    days_since_rebalance = rebalance_every_days  # trigger rebalance on day 0

    for date_str in common_dates:
        # Current prices
        prices = {sym: close_map[sym].get(date_str) for sym in valid_syms}
        prices = {sym: p for sym, p in prices.items() if p}

        # ── Rebalance ─────────────────────────────────────────────────────────
        if days_since_rebalance >= rebalance_every_days:
            days_since_rebalance = 0

            # Run strategy backtests on lookback window (synchronously — already in async context)
            cutoff_dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            lookback_start = cutoff_dt - timedelta(days=lookback_days)

            symbol_sharpes: dict[str, float] = {}
            best_strats: dict[str, str] = {}

            for sym in valid_syms:
                if sym not in prices:
                    continue
                window = [
                    c for c in candles_map[sym]
                    if lookback_start <= c.timestamp.astimezone(timezone.utc) <= cutoff_dt
                ]
                if len(window) < 10:
                    symbol_sharpes[sym] = 0.01
                    best_strats[sym]    = "rsi"
                    continue
                sharpe, strat = _best_sharpe_for_symbol(sym, window, cutoff_dt)
                symbol_sharpes[sym] = sharpe
                best_strats[sym]    = strat

            if symbol_sharpes:
                weights = _sharpe_alloc(symbol_sharpes)
            else:
                weights = {sym: 1 / len(valid_syms) for sym in valid_syms}

            # Liquidate to cash, then buy new allocation
            portfolio_value = sum(holdings.get(sym, 0) * prices.get(sym, 0) for sym in valid_syms)
            if not holdings:
                portfolio_value = portfolio_equity  # first rebalance — use starting capital

            new_holdings: dict[str, float] = {}
            for sym, weight in weights.items():
                if sym in prices and prices[sym] > 0:
                    allocated = portfolio_value * weight
                    new_holdings[sym] = allocated / prices[sym]
            holdings = new_holdings

            rebalance_events.append({
                "date":             date_str,
                "weights":          weights,
                "best_strategies":  best_strats,
                "sharpes":          {sym: round(symbol_sharpes.get(sym, 0), 4) for sym in best_strats},
                "portfolio_value":  round(portfolio_value, 2),
            })

        # ── Mark-to-market ────────────────────────────────────────────────────
        portfolio_equity = sum(holdings.get(sym, 0) * prices.get(sym, 0) for sym in valid_syms)
        if not holdings:
            portfolio_equity = total_capital  # before first rebalance

        # Benchmark
        bh_equity = sum(bh_shares.get(s, 0) * close_map[s].get(date_str, bh_starts.get(s, 0) or 0) for s in bh_valid)

        equity_curve.append({
            "date":             date_str,
            "equity":           round(portfolio_equity, 2),
            "benchmark_equity": round(bh_equity, 2),
        })

        if prev_equity > 0:
            daily_returns.append((portfolio_equity - prev_equity) / prev_equity)
        prev_equity = portfolio_equity
        days_since_rebalance += 1

    # ── 4. Compute aggregate metrics ──────────────────────────────────────────
    if not equity_curve:
        return {"error": "Empty equity curve — no overlapping trading days.", "items": []}

    start_eq = equity_curve[0]["equity"]
    end_eq   = equity_curve[-1]["equity"]
    total_return = (end_eq - start_eq) / start_eq if start_eq else 0
    trading_days = len(equity_curve)
    ann_return   = (1 + total_return) ** (252 / trading_days) - 1 if trading_days > 0 else 0

    equities    = [e["equity"] for e in equity_curve]
    peak        = equities[0]
    max_dd      = 0.0
    for eq in equities:
        if eq > peak:
            peak = eq
        dd = (eq - peak) / peak if peak else 0
        if dd < max_dd:
            max_dd = dd

    sharpe = 0.0
    if len(daily_returns) > 1:
        mu  = float(np.mean(daily_returns))
        std = float(np.std(daily_returns))
        sharpe = round(_safe((mu / std) * np.sqrt(252)), 4) if std > 0 else 0.0

    # Benchmark metrics
    bh_start = equity_curve[0]["benchmark_equity"]
    bh_end   = equity_curve[-1]["benchmark_equity"]
    bh_return = (bh_end - bh_start) / bh_start if bh_start else 0
    bh_ann    = (1 + bh_return) ** (252 / trading_days) - 1 if trading_days > 0 else 0
    bh_eqs    = [e["benchmark_equity"] for e in equity_curve]
    bh_peak   = bh_eqs[0]
    bh_max_dd = 0.0
    for eq in bh_eqs:
        if eq > bh_peak:
            bh_peak = eq
        dd = (eq - bh_peak) / bh_peak if bh_peak else 0
        if dd < bh_max_dd:
            bh_max_dd = dd

    bh_daily = []
    for i in range(1, len(bh_eqs)):
        if bh_eqs[i - 1] > 0:
            bh_daily.append((bh_eqs[i] - bh_eqs[i - 1]) / bh_eqs[i - 1])
    bh_sharpe = 0.0
    if len(bh_daily) > 1:
        mu = float(np.mean(bh_daily))
        std = float(np.std(bh_daily))
        bh_sharpe = round(_safe((mu / std) * np.sqrt(252)), 4) if std > 0 else 0.0

    return {
        "equity_curve":      equity_curve,
        "rebalance_events":  rebalance_events,
        "metrics": {
            "total_return":       round(total_return, 6),
            "annualized_return":  round(ann_return, 6),
            "sharpe_ratio":       sharpe,
            "max_drawdown":       round(max_dd, 6),
            "final_equity":       round(end_eq, 2),
            "total_rebalances":   len(rebalance_events),
            "trading_days":       trading_days,
        },
        "benchmark_metrics": {
            "total_return":       round(bh_return, 6),
            "annualized_return":  round(bh_ann, 6),
            "sharpe_ratio":       bh_sharpe,
            "max_drawdown":       round(bh_max_dd, 6),
            "final_equity":       round(bh_end, 2),
            "label":              "Equal-weight buy & hold",
        },
        "symbols_used":    valid_syms,
        "symbols_errored": errors,
        "config": {
            "total_capital":        total_capital,
            "rebalance_every_days": rebalance_every_days,
            "total_days":           total_days,
            "lookback_days":        lookback_days,
        },
    }
