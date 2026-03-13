"""
Asset Screener Service.

Fetches recent candle data for a list of symbols and computes:
  - trend_score:      % price above 20-day MA  (+ve = bullish, -ve = bearish)
  - volatility_ann:   annualised standard deviation of daily returns
  - momentum_30d:     30-day price return
  - volume_rank:      normalised volume vs its own 20-day average (1.0 = average)
  - market_condition: "trending_up" | "trending_down" | "ranging" | "volatile"

Pre-built watchlists are defined here. Sector/market-cap metadata is a lightweight
lookup table — we don't need an external API for this.
"""
import asyncio
import math
from datetime import datetime, timezone, timedelta
from typing import Optional

import numpy as np

from app.brokers import get_broker
from app.models.candlestick import Timeframe, Broker


# ── Watchlists ───────────────────────────────────────────────────────────────

WATCHLISTS: dict[str, list[str]] = {
    "sp100_top": [
        "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK.B",
        "JPM", "UNH", "V", "XOM", "LLY", "JNJ", "MA", "PG", "AVGO", "HD",
        "MRK", "COST", "CVX", "ABBV", "PEP", "KO", "WMT", "BAC", "CRM",
        "MCD", "ACN", "CSCO", "TMO", "ABT", "LIN", "NKE", "ORCL", "AMD",
        "TXN", "NFLX", "INTC", "QCOM",
    ],
    "top_crypto": [
        "BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD",
        "ADA/USD", "AVAX/USD", "DOGE/USD", "MATIC/USD", "DOT/USD",
    ],
    "growth_tech": [
        "NVDA", "AMD", "PLTR", "SNOW", "CRWD", "ZS", "MDB", "DDOG",
        "NET", "OKTA", "TTWO", "RBLX", "RIVN", "LCID", "IONQ",
    ],
    "etfs": [
        "SPY", "QQQ", "DIA", "IWM", "GLD", "SLV", "TLT", "VTI",
        "VOO", "ARKK", "XLE", "XLF", "XLK", "XLV", "SMH",
    ],
}

# Lightweight metadata for filtering (sector / market-cap)
ASSET_META: dict[str, dict] = {
    # mega-cap tech
    "AAPL":   {"sector": "Technology",    "market_cap": "mega"},
    "MSFT":   {"sector": "Technology",    "market_cap": "mega"},
    "NVDA":   {"sector": "Technology",    "market_cap": "mega"},
    "AMZN":   {"sector": "Consumer",      "market_cap": "mega"},
    "GOOGL":  {"sector": "Technology",    "market_cap": "mega"},
    "META":   {"sector": "Technology",    "market_cap": "mega"},
    "TSLA":   {"sector": "Automotive",    "market_cap": "large"},
    "JPM":    {"sector": "Financials",    "market_cap": "mega"},
    "V":      {"sector": "Financials",    "market_cap": "large"},
    "MA":     {"sector": "Financials",    "market_cap": "large"},
    "JNJ":    {"sector": "Healthcare",    "market_cap": "mega"},
    "UNH":    {"sector": "Healthcare",    "market_cap": "mega"},
    "LLY":    {"sector": "Healthcare",    "market_cap": "mega"},
    "PG":     {"sector": "Consumer",      "market_cap": "large"},
    "KO":     {"sector": "Consumer",      "market_cap": "large"},
    "PEP":    {"sector": "Consumer",      "market_cap": "large"},
    "XOM":    {"sector": "Energy",        "market_cap": "mega"},
    "CVX":    {"sector": "Energy",        "market_cap": "large"},
    "AMD":    {"sector": "Technology",    "market_cap": "large"},
    "AVGO":   {"sector": "Technology",    "market_cap": "mega"},
    "NFLX":   {"sector": "Technology",    "market_cap": "large"},
    "PLTR":   {"sector": "Technology",    "market_cap": "mid"},
    "CRWD":   {"sector": "Technology",    "market_cap": "large"},
    "SNOW":   {"sector": "Technology",    "market_cap": "large"},
    "DDOG":   {"sector": "Technology",    "market_cap": "mid"},
    "NET":    {"sector": "Technology",    "market_cap": "mid"},
    # crypto
    "BTC/USD":    {"sector": "Crypto", "market_cap": "mega"},
    "ETH/USD":    {"sector": "Crypto", "market_cap": "large"},
    "SOL/USD":    {"sector": "Crypto", "market_cap": "mid"},
    "BNB/USD":    {"sector": "Crypto", "market_cap": "large"},
    "XRP/USD":    {"sector": "Crypto", "market_cap": "large"},
    "ADA/USD":    {"sector": "Crypto", "market_cap": "mid"},
    "AVAX/USD":   {"sector": "Crypto", "market_cap": "mid"},
    "DOGE/USD":   {"sector": "Crypto", "market_cap": "mid"},
    "MATIC/USD":  {"sector": "Crypto", "market_cap": "small"},
    "DOT/USD":    {"sector": "Crypto", "market_cap": "small"},
    # ETFs
    "SPY":  {"sector": "ETF", "market_cap": "mega"},
    "QQQ":  {"sector": "ETF", "market_cap": "mega"},
    "DIA":  {"sector": "ETF", "market_cap": "large"},
    "IWM":  {"sector": "ETF", "market_cap": "large"},
    "GLD":  {"sector": "ETF", "market_cap": "large"},
    "TLT":  {"sector": "ETF", "market_cap": "large"},
    "ARKK": {"sector": "ETF", "market_cap": "mid"},
    "SMH":  {"sector": "ETF", "market_cap": "large"},
}


def _classify_condition(trend_score: float, volatility_ann: float) -> str:
    """Classify market condition from trend and volatility stats."""
    if volatility_ann > 0.60:
        return "volatile"
    if trend_score > 0.03:
        return "trending_up"
    if trend_score < -0.03:
        return "trending_down"
    return "ranging"


def _compute_rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    recent = deltas[-period:]
    gains  = [d for d in recent if d > 0]
    losses = [-d for d in recent if d < 0]
    avg_gain = sum(gains) / period if gains else 0
    avg_loss = sum(losses) / period if losses else 1e-9
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def compute_price_stats(candles: list) -> dict:
    """
    Compute all statistics needed by both the screener and the research service.
    Input: list of Candle objects (must have .close, .volume, .timestamp).
    """
    if len(candles) < 5:
        return {}

    closes  = [c.close for c in candles]
    volumes = [c.volume for c in candles]

    current_price = closes[-1]
    returns = [
        (closes[i] - closes[i-1]) / closes[i-1]
        for i in range(1, len(closes))
        if closes[i-1] != 0
    ]

    # Volatility — annualised
    vol_ann = float(np.std(returns) * math.sqrt(252)) if len(returns) > 1 else 0.0

    # Trend score — % above 20-day MA
    ma20 = float(np.mean(closes[-20:])) if len(closes) >= 20 else current_price
    ma50 = float(np.mean(closes[-50:])) if len(closes) >= 50 else current_price
    trend_score  = (current_price - ma20) / ma20 if ma20 else 0.0
    pct_above_ma50 = (current_price - ma50) / ma50 if ma50 else 0.0

    # Momentum
    mom_30d = (closes[-1] - closes[-30]) / closes[-30] if len(closes) >= 30 else 0.0
    mom_90d = (closes[-1] - closes[-90]) / closes[-90] if len(closes) >= 90 else 0.0

    # Volume
    avg_vol = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else (volumes[-1] if volumes else 0)
    vol_rank = volumes[-1] / avg_vol if avg_vol > 0 else 1.0

    return {
        "current_price":    current_price,
        "return_30d":       mom_30d,
        "return_90d":       mom_90d,
        "volatility_ann":   vol_ann,
        "trend_score":      trend_score,
        "pct_above_ma20":   trend_score,
        "pct_above_ma50":   pct_above_ma50,
        "ma20":             ma20,
        "ma50":             ma50,
        "avg_volume":       avg_vol,
        "volume_rank":      vol_rank,
        "rsi_14":           _compute_rsi(closes),
        "market_condition": _classify_condition(trend_score, vol_ann),
        "candle_count":     len(candles),
    }


async def screen_symbol(symbol: str, broker_inst) -> Optional[dict]:
    """Fetch recent data for one symbol and return its screener row."""
    try:
        end   = datetime.now(timezone.utc)
        start = end - timedelta(days=120)
        series = await broker_inst.get_candles(symbol, Timeframe.D1, start, end, limit=120)
        if not series or len(series.candles) < 20:
            return None
        stats = compute_price_stats(series.candles)
        if not stats:
            return None
        meta = ASSET_META.get(symbol, {"sector": "Unknown", "market_cap": "unknown"})
        return {
            "symbol":          symbol,
            "current_price":   round(stats["current_price"], 4),
            "trend_score":     round(stats["trend_score"], 4),
            "volatility_ann":  round(stats["volatility_ann"], 4),
            "momentum_30d":    round(stats["return_30d"], 4),
            "momentum_90d":    round(stats["return_90d"], 4),
            "volume_rank":     round(stats["volume_rank"], 2),
            "rsi_14":          round(stats["rsi_14"], 1),
            "market_condition":stats["market_condition"],
            "sector":          meta["sector"],
            "market_cap":      meta["market_cap"],
        }
    except Exception:
        return None


async def run_screener(
    symbols: list[str],
    min_volatility:  Optional[float] = None,
    max_volatility:  Optional[float] = None,
    min_momentum:    Optional[float] = None,
    max_price:       Optional[float] = None,
    sectors:         Optional[list[str]] = None,
    market_caps:     Optional[list[str]] = None,
    market_condition:Optional[str] = None,
    concurrency:     int = 8,
) -> list[dict]:
    """
    Screen a list of symbols concurrently and return ranked results.
    Applies optional filters and sorts by absolute trend score descending.
    """
    broker = get_broker(Broker.ALPACA)
    sem    = asyncio.Semaphore(concurrency)

    async def bounded_screen(sym: str):
        async with sem:
            return await screen_symbol(sym, broker)

    tasks   = [bounded_screen(sym) for sym in symbols]
    results = await asyncio.gather(*tasks)
    rows    = [r for r in results if r is not None]

    # Apply filters
    if min_volatility is not None:
        rows = [r for r in rows if r["volatility_ann"] >= min_volatility]
    if max_volatility is not None:
        rows = [r for r in rows if r["volatility_ann"] <= max_volatility]
    if min_momentum is not None:
        rows = [r for r in rows if r["momentum_30d"] >= min_momentum]
    if sectors:
        rows = [r for r in rows if r["sector"] in sectors]
    if market_caps:
        rows = [r for r in rows if r["market_cap"] in market_caps]
    if max_price is not None:
        rows = [r for r in rows if r["current_price"] <= max_price]
    if market_condition:
        rows = [r for r in rows if r["market_condition"] == market_condition]

    # Sort by absolute trend score (strongest move up or down first)
    rows.sort(key=lambda r: abs(r["trend_score"]), reverse=True)
    return rows
