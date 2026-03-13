"""
Risk Management Service.

Provides portfolio-level and trade-level risk calculations:
  - Historical VaR / CVaR (Expected Shortfall)
  - Kelly criterion position sizing
  - Fixed-fractional position sizing
  - Pairwise correlation matrix
  - Full portfolio risk report (P&L, VaR, sector exposure, correlations)
"""
import asyncio
import logging

import numpy as np
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.brokers import get_broker
from app.models.candlestick import Timeframe, Broker

log = logging.getLogger(__name__)


# ── Pure math helpers ─────────────────────────────────────────────────────────

def calc_historical_var(returns: list[float], confidence: float = 0.95) -> float:
    """
    Historical Value-at-Risk at the given confidence level.
    Returns a positive number representing the potential daily loss.
    E.g. var=0.02 means a (1-confidence) chance of losing > 2% in a single day.
    """
    if len(returns) < 10:
        return 0.0
    arr = np.array(returns)
    return float(-np.percentile(arr, (1 - confidence) * 100))


def calc_cvar(returns: list[float], confidence: float = 0.95) -> float:
    """
    Conditional VaR / Expected Shortfall.
    Average loss in the worst (1-confidence) tail. Always >= VaR.
    """
    if len(returns) < 10:
        return 0.0
    arr = np.array(returns)
    cutoff = np.percentile(arr, (1 - confidence) * 100)
    tail = arr[arr <= cutoff]
    return float(-tail.mean()) if len(tail) > 0 else 0.0


def kelly_fraction(win_rate: float, avg_win_pct: float, avg_loss_pct: float) -> float:
    """
    Kelly criterion: optimal fraction of capital to risk per trade.
    win_rate: probability of a winning trade (0–1).
    avg_win_pct / avg_loss_pct: positive decimals (e.g. 0.05 = 5%).
    Returns half-Kelly (/ 2) capped at 0.50 for practical safety.
    """
    if avg_loss_pct <= 0 or avg_win_pct <= 0 or win_rate <= 0 or win_rate >= 1:
        return 0.0
    b = avg_win_pct / avg_loss_pct
    q = 1.0 - win_rate
    kelly = (b * win_rate - q) / b
    return round(max(0.0, min(0.5, kelly / 2)), 4)


def fixed_fractional_size(
    capital: float,
    price: float,
    stop_loss_pct: float,
    risk_per_trade_pct: float = 0.02,
) -> dict:
    """
    Fixed-fractional position sizing.

    Risk `risk_per_trade_pct` of capital on this trade; stop loss is
    `stop_loss_pct` below entry (e.g. 0.05 = 5%).

    Returns: shares, position_value, capital_at_risk, stop_price, pct_of_capital.
    """
    if price <= 0 or stop_loss_pct <= 0:
        return {
            "shares": 0,
            "position_value": 0.0,
            "capital_at_risk": 0.0,
            "stop_price": 0.0,
            "pct_of_capital": 0.0,
        }
    dollar_risk   = capital * risk_per_trade_pct
    risk_per_share = price * stop_loss_pct
    shares        = int(dollar_risk / risk_per_share) if risk_per_share > 0 else 0
    return {
        "shares":          shares,
        "position_value":  round(shares * price, 2),
        "capital_at_risk": round(shares * risk_per_share, 2),
        "stop_price":      round(price * (1 - stop_loss_pct), 2),
        "pct_of_capital":  round((shares * price) / capital * 100, 2) if capital > 0 else 0.0,
    }


def correlation_matrix(closes_map: dict[str, list[float]]) -> dict:
    """
    Compute pairwise Pearson correlation matrix from close-price series.
    Returns: {"symbols": [...], "matrix": [[float, ...], ...]}
    """
    syms = list(closes_map.keys())
    n    = len(syms)
    mat  = [[1.0] * n for _ in range(n)]

    # Convert prices to daily returns
    returns_map: dict[str, np.ndarray] = {}
    for sym, closes in closes_map.items():
        arr = np.array(closes)
        returns_map[sym] = np.diff(arr) / arr[:-1] if len(arr) >= 2 else np.array([0.0])

    for i in range(n):
        for j in range(i + 1, n):
            ri, rj   = returns_map[syms[i]], returns_map[syms[j]]
            min_len  = min(len(ri), len(rj))
            if min_len < 5:
                c = 0.0
            else:
                c = float(np.corrcoef(ri[-min_len:], rj[-min_len:])[0, 1])
                if c != c:   # NaN guard
                    c = 0.0
            mat[i][j] = round(c, 4)
            mat[j][i] = round(c, 4)

    return {"symbols": syms, "matrix": mat}


def _safe(v: float) -> float:
    return 0.0 if (v != v or abs(v) == float("inf")) else v


# ── Async: full portfolio risk report ─────────────────────────────────────────

async def portfolio_risk_report(
    holdings: list[dict],   # [{symbol, qty, entry_price}]
    lookback_days: int = 252,
) -> dict:
    """
    Fetch recent daily candles for every holding, then compute:
      - Per-position current value, P&L
      - Portfolio-level VaR 95%, VaR 99%, CVaR 95%
      - Max drawdown and Sharpe ratio
      - Concentration (weight per holding)
      - Sector exposure
      - Pairwise correlation matrix + high-correlation warnings (> 0.80)
    """
    from app.services.screener import ASSET_META  # lazy to avoid circular import

    if not holdings:
        return {"error": "No holdings provided."}

    symbols = [h["symbol"].upper() for h in holdings]
    broker  = get_broker(Broker.ALPACA)
    end     = datetime.now(timezone.utc)
    start   = end - timedelta(days=lookback_days + 10)

    async def fetch(sym: str):
        try:
            series = await broker.get_candles(sym, Timeframe.D1, start, end, limit=lookback_days + 10)
            return sym, series.candles
        except Exception:
            return sym, None

    fetch_results = await asyncio.gather(*[fetch(s) for s in symbols])
    candles_map: dict[str, list] = {sym: c for sym, c in fetch_results if c}

    # Build closes and per-date lookup
    closes_map:  dict[str, list[float]]        = {}
    current_prices: dict[str, float]           = {}
    date_closes: dict[str, dict[str, float]]   = {}

    for sym, candles in candles_map.items():
        sorted_c = sorted(candles, key=lambda c: c.timestamp)
        closes   = [c.close for c in sorted_c]
        closes_map[sym]   = closes
        current_prices[sym] = closes[-1] if closes else 0.0
        date_closes[sym]  = {
            c.timestamp.astimezone(timezone.utc).strftime("%Y-%m-%d"): c.close
            for c in sorted_c
        }

    # Per-position details
    positions  = []
    total_value = 0.0
    total_cost  = 0.0

    for h in holdings:
        sym   = h["symbol"].upper()
        qty   = float(h.get("qty", 0))
        entry = float(h.get("entry_price", 0))
        price = current_prices.get(sym, entry)
        cost  = qty * entry
        val   = qty * price
        pnl   = val - cost
        total_value += val
        total_cost  += cost
        positions.append({
            "symbol":        sym,
            "qty":           qty,
            "entry_price":   round(entry, 4),
            "current_price": round(price, 4),
            "cost_basis":    round(cost, 2),
            "current_value": round(val, 2),
            "pnl":           round(pnl, 2),
            "pnl_pct":       round((pnl / cost * 100) if cost > 0 else 0.0, 2),
            "sector":        ASSET_META.get(sym, {}).get("sector", "Unknown"),
        })

    # Portfolio daily returns (value-weighted across all holdings)
    all_dates = sorted(set.union(*[set(d.keys()) for d in date_closes.values()]) if date_closes else set())
    portfolio_returns: list[float] = []
    prev_val: Optional[float] = None

    for date_str in all_dates:
        day_val = sum(
            float(h.get("qty", 0)) * date_closes.get(h["symbol"].upper(), {}).get(date_str, 0.0)
            for h in holdings
        )
        if prev_val and prev_val > 0:
            portfolio_returns.append((day_val - prev_val) / prev_val)
        prev_val = day_val

    # Risk metrics
    var_95  = calc_historical_var(portfolio_returns, 0.95)
    cvar_95 = calc_cvar(portfolio_returns, 0.95)
    var_99  = calc_historical_var(portfolio_returns, 0.99)

    # Max drawdown from simulated portfolio equity
    max_dd = 0.0
    if portfolio_returns:
        running = total_cost or 1.0
        peak    = running
        for r in portfolio_returns:
            running *= (1 + r)
            if running > peak:
                peak = running
            dd = (running - peak) / peak if peak > 0 else 0.0
            if dd < max_dd:
                max_dd = dd

    # Sharpe ratio
    sharpe = 0.0
    if len(portfolio_returns) > 1:
        arr = np.array(portfolio_returns)
        mu, std = float(arr.mean()), float(arr.std())
        sharpe = round(_safe((mu / std) * np.sqrt(252)), 4) if std > 0 else 0.0

    # Concentration
    concentration = sorted(
        [
            {
                "symbol":     p["symbol"],
                "weight_pct": round(p["current_value"] / total_value * 100, 2) if total_value else 0.0,
            }
            for p in positions
        ],
        key=lambda x: -x["weight_pct"],
    )

    # Sector exposure
    sector_exp: dict[str, float] = {}
    for p in positions:
        sector_exp[p["sector"]] = sector_exp.get(p["sector"], 0.0) + p["current_value"]
    sector_breakdown = sorted(
        [
            {
                "sector": k,
                "value":  round(v, 2),
                "pct":    round(v / total_value * 100, 2) if total_value else 0.0,
            }
            for k, v in sector_exp.items()
        ],
        key=lambda x: -x["value"],
    )

    # Correlation matrix
    corr = (
        correlation_matrix(closes_map)
        if len(closes_map) > 1
        else {"symbols": list(closes_map.keys()), "matrix": [[1.0]]}
    )

    # High-correlation warnings
    high_corr_pairs = []
    syms_list = corr["symbols"]
    mat       = corr["matrix"]
    for i in range(len(syms_list)):
        for j in range(i + 1, len(syms_list)):
            if mat[i][j] > 0.80:
                high_corr_pairs.append({
                    "a":           syms_list[i],
                    "b":           syms_list[j],
                    "correlation": mat[i][j],
                })

    total_pnl = total_value - total_cost
    return {
        "positions":        positions,
        "summary": {
            "total_cost":    round(total_cost, 2),
            "total_value":   round(total_value, 2),
            "total_pnl":     round(total_pnl, 2),
            "total_pnl_pct": round((total_pnl / total_cost * 100) if total_cost > 0 else 0.0, 2),
        },
        "risk_metrics": {
            "var_95":       round(var_95 * 100, 4),
            "cvar_95":      round(cvar_95 * 100, 4),
            "var_99":       round(var_99 * 100, 4),
            "max_drawdown": round(max_dd * 100, 4),
            "sharpe_ratio": sharpe,
            "trading_days": len(portfolio_returns),
        },
        "concentration":    concentration,
        "sector_breakdown": sector_breakdown,
        "correlation":      corr,
        "high_corr_pairs":  high_corr_pairs,
    }
