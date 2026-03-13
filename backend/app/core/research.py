"""
Research Service.

Full analysis pipeline for a single asset:
  1. Fetch 365 days of daily candles
  2. Compute price statistics (via screener.compute_price_stats)
  3. Run a quick backtest for EVERY strategy (via BacktestEngine)
  4. Fetch recent news headlines (via Alpaca news API)
  5. Send everything to Ollama for reasoning
  6. Return structured result the frontend can render immediately

Falls back gracefully at each step: if news fails → skip news,
if Ollama fails → include is_fallback flag with error message.
"""
import logging
from datetime import datetime, timezone, timedelta

import httpx

from app.config import settings
from app.brokers import get_broker
from app.models.candlestick import Timeframe, Broker
from app.models.backtest import BacktestConfig
from app.backtesting.engine import BacktestEngine
from app.strategies.registry import STRATEGY_REGISTRY
from app.core.screener import compute_price_stats
from app.integrations.ollama import ollama

log = logging.getLogger(__name__)

_engine = BacktestEngine()

ALPACA_NEWS_URL = "https://data.alpaca.markets/v1beta1/news"


async def _fetch_news(symbol: str) -> list[str]:
    """Fetch up to 10 recent Alpaca news headlines for a symbol."""
    headers = {
        "APCA-API-KEY-ID":     settings.alpaca_api_key,
        "APCA-API-SECRET-KEY": settings.alpaca_secret_key,
    }
    params = {
        "symbols": symbol,
        "limit":   10,
        "sort":    "desc",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(ALPACA_NEWS_URL, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            news_items = data.get("news", [])
            return [item.get("headline", "") for item in news_items if item.get("headline")]
    except Exception as e:
        log.warning("News fetch failed for %s: %s", symbol, e)
        return []


def _run_strategy_backtest(symbol: str, strategy_name: str, series) -> dict:
    """Run a 1-year backtest for one strategy. Returns a metrics dict."""
    try:
        candles = series.candles
        if len(candles) < 50:
            raise ValueError(f"Only {len(candles)} candles — need at least 50")
        start = candles[0].timestamp
        end   = candles[-1].timestamp
        config = BacktestConfig(
            symbol=symbol,
            strategy=strategy_name,
            start_date=start,
            end_date=end,
            initial_capital=10_000.0,
        )
        result = _engine.run(config, series)
        return {
            "strategy":         strategy_name,
            "total_return":     result.total_return,
            "annualized_return":result.annualized_return,
            "sharpe_ratio":     result.sharpe_ratio,
            "max_drawdown":     result.max_drawdown,
            "win_rate":         result.win_rate,
            "profit_factor":    result.profit_factor,
            "total_trades":     result.total_trades,
            "error":            None,
        }
    except Exception as e:
        log.warning("Backtest failed for %s/%s: %s", symbol, strategy_name, e)
        return {
            "strategy":         strategy_name,
            "total_return":     0.0,
            "annualized_return":0.0,
            "sharpe_ratio":     0.0,
            "max_drawdown":     0.0,
            "win_rate":         0.0,
            "profit_factor":    0.0,
            "total_trades":     0,
            "error":            str(e),
        }


async def research_asset(symbol: str, lookback_days: int = 365) -> dict:
    """
    Full research pipeline for one asset.

    Returns:
    {
      symbol, price_stats, strategy_scores (list),
      best_strategy (from backtest), news_headlines,
      ai_analysis (Ollama response or fallback),
      analysed_at (ISO timestamp)
    }
    """
    sym = symbol.upper().strip()
    broker = get_broker(Broker.ALPACA)
    # Minimum 90 calendar days → ~63 trading days, safely above the 50-candle
    # strategy backtest floor. 30-day lookbacks only yield ~21 trading days which
    # is not enough for meaningful analysis.
    lookback_days = max(90, min(lookback_days, 1825))
    # Minimum expected trading candles for this lookback (~70% of calendar days)
    min_candles = max(14, int(lookback_days * 0.55))

    end   = datetime.now(timezone.utc)
    start = end - timedelta(days=lookback_days)

    # 1. Fetch price data
    try:
        series = await broker.get_candles(sym, Timeframe.D1, start, end, limit=lookback_days)
        got = len(series.candles) if series else 0
        if not series or got < min_candles:
            return {
                "symbol": sym,
                "error":  f"Not enough historical data for {sym} "
                          f"(got {got} trading days over {lookback_days} calendar days, need ~{min_candles}). "
                          "Check the symbol is valid and tradeable on Alpaca IEX feed."
            }
    except httpx.HTTPStatusError as e:
        body = ""
        try:
            body = e.response.text[:400]
        except Exception:
            pass
        log.warning("Market data HTTP %s for %s: %s", e.response.status_code, sym, body)
        return {"symbol": sym, "error": f"Market data HTTP {e.response.status_code} for {sym}: {body}"}
    except Exception as e:
        log.warning("Market data fetch failed for %s: %s", sym, e)
        return {"symbol": sym, "error": f"Failed to fetch market data: {e}"}

    # 2. Compute price stats
    price_stats = compute_price_stats(series.candles)

    # 3. Run backtests for all strategies
    strategy_scores = [
        _run_strategy_backtest(sym, name, series)
        for name in STRATEGY_REGISTRY.keys()
    ]

    # Sort by Sharpe to find the statistically best fit
    valid_scores = [s for s in strategy_scores if s["error"] is None and s["total_trades"] > 0]
    best_by_backtest = (
        max(valid_scores, key=lambda s: s["sharpe_ratio"])
        if valid_scores else None
    )

    # 4. Fetch news
    news_headlines = await _fetch_news(sym)

    # 5. Ollama reasoning
    ai_analysis = await ollama.analyse_asset(
        symbol=sym,
        price_stats=price_stats,
        strategy_scores=strategy_scores,
        news_headlines=news_headlines,
    )

    # If Ollama succeeds, its best_strategy takes precedence over raw backtest ranking.
    # If Ollama fails, fall back to the best backtest result.
    final_best_strategy = ai_analysis.get("best_strategy") if not ai_analysis.get("is_fallback") else None
    if not final_best_strategy and best_by_backtest:
        final_best_strategy = best_by_backtest["strategy"]

    return {
        "symbol":           sym,
        "price_stats":      price_stats,
        "strategy_scores":  strategy_scores,
        "best_strategy":    final_best_strategy,
        "news_headlines":   news_headlines,
        "ai_analysis":      ai_analysis,
        "analysed_at":      datetime.now(timezone.utc).isoformat(),
    }
