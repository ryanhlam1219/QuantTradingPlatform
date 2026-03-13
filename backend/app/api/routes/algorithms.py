import asyncio
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.strategies.registry import list_strategies, get_strategy, STRATEGY_REGISTRY
from app.models.candlestick import Timeframe, Broker
from app.models.backtest import BacktestConfig
from app.backtesting.engine import BacktestEngine
from app.brokers import get_broker
from datetime import datetime, timezone, timedelta
from typing import Optional

router = APIRouter(prefix="/algorithms", tags=["Algorithms"])
_rank_engine = BacktestEngine()


def _safe_metric(v: float) -> float:
    return 0.0 if (v != v or abs(v) == float("inf")) else v


class RankRequest(BaseModel):
    symbols:      list[str]
    lookback_days: int = 180
    top_n:         int = 5   # top strategies to show per symbol


@router.post("/rank")
async def rank_strategies(req: RankRequest):
    """
    Rank all strategies against the given symbols over lookback_days.
    Returns a leaderboard of (symbol, strategy) pairs sorted by Sharpe ratio
    and the single best strategy per symbol.
    """
    if not req.symbols:
        raise HTTPException(status_code=400, detail="Provide at least one symbol.")
    if len(req.symbols) > 15:
        raise HTTPException(status_code=400, detail="Maximum 15 symbols.")

    lookback = max(30, min(req.lookback_days, 730))
    end      = datetime.now(timezone.utc)
    start    = end - timedelta(days=lookback)
    broker   = get_broker(Broker.ALPACA)
    strategies = list(STRATEGY_REGISTRY.keys())

    async def fetch(sym: str):
        try:
            series = await broker.get_candles(sym.upper(), Timeframe.D1, start, end, limit=lookback)
            return sym.upper(), series
        except Exception:
            return sym.upper(), None

    fetched    = await asyncio.gather(*[fetch(s) for s in req.symbols])
    series_map = {sym: s for sym, s in fetched if s and s.candles}

    results: list[dict] = []
    for sym, series in series_map.items():
        for strat_name in strategies:
            try:
                cfg = BacktestConfig(
                    symbol=sym,
                    strategy=strat_name,
                    start_date=series.candles[0].timestamp,
                    end_date=series.candles[-1].timestamp,
                    initial_capital=10_000.0,
                    timeframe=Timeframe.D1,
                    broker=Broker.ALPACA,
                    commission=0.001,
                    slippage=0.001,
                )
                r = _rank_engine.run(cfg, series)
                results.append({
                    "symbol":       sym,
                    "strategy":     strat_name,
                    "sharpe_ratio": round(_safe_metric(r.sharpe_ratio), 4),
                    "total_return": round(_safe_metric(r.total_return), 4),
                    "max_drawdown": round(_safe_metric(r.max_drawdown), 4),
                    "win_rate":     round(_safe_metric(r.win_rate), 4),
                    "total_trades": r.total_trades,
                })
            except Exception:
                pass

    results.sort(key=lambda x: -x["sharpe_ratio"])

    # Best strategy per symbol (first occurrence in sorted list)
    best_per_symbol: dict[str, dict] = {}
    for r in results:
        if r["symbol"] not in best_per_symbol:
            best_per_symbol[r["symbol"]] = r

    return {
        "leaderboard":     results[: req.top_n * max(1, len(series_map))],
        "best_per_symbol": list(best_per_symbol.values()),
        "symbols_used":    list(series_map.keys()),
        "symbols_errored": [s.upper() for s in req.symbols if s.upper() not in series_map],
        "lookback_days":   lookback,
    }



@router.get("/")
async def list_algorithms():
    """List all available trading strategies with descriptions."""
    return {"strategies": list_strategies()}


@router.get("/{strategy_name}")
async def get_algorithm(strategy_name: str):
    """Get details of a specific strategy."""
    if strategy_name not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_name}' not found")
    return get_strategy(strategy_name, {}).describe()


@router.post("/{strategy_name}/signals")
async def generate_signals(
    strategy_name: str,
    symbol: str = Query(..., description="Ticker symbol e.g. AAPL"),
    timeframe: Timeframe = Query(default=Timeframe.D1),
    broker: Broker = Query(default=Broker.ALPACA),
    lookback_days: int = Query(default=365, ge=1, le=3650),
    params: dict = None,  # strategy params in request body
):
    """Run a strategy on live market data and return the latest signal.
    
    Strategy-specific parameters can be passed in the JSON body, e.g.:
      {"period": 14, "oversold": 25, "overbought": 75}
    """
    if strategy_name not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_name}' not found")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=lookback_days)

    try:
        series = await get_broker(broker).get_candles(symbol.upper(), timeframe, start, end)
        if not series.candles:
            raise HTTPException(
                status_code=404,
                detail=f"No market data returned for {symbol} ({timeframe}). "
                       f"Check the symbol is valid and try a longer lookback_days."
            )
        strategy = get_strategy(strategy_name, params or {})
        signals = strategy.generate_signals(series)
        return {
            "symbol": symbol.upper(),
            "strategy": strategy_name,
            "timeframe": timeframe,
            "candle_count": len(series.candles),
            "signal_count": len(signals),
            "signals": [s.dict() for s in signals],
            "latest_signal": signals[-1].dict() if signals else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Signal generation failed: {str(e)}")
