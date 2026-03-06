from fastapi import APIRouter, HTTPException, Query
from app.algorithms import list_strategies, get_strategy, STRATEGY_REGISTRY
from app.models.candlestick import Timeframe, Broker
from app.brokers import get_broker
from datetime import datetime, timezone, timedelta

router = APIRouter(prefix="/algorithms", tags=["Algorithms"])


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
