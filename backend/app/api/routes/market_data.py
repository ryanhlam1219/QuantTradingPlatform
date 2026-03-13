from fastapi import APIRouter, Query, HTTPException
from datetime import datetime, timezone, timedelta
from app.brokers import get_broker
from app.models.candlestick import Timeframe, Broker

router = APIRouter(prefix="/market-data", tags=["Market Data"])

# Maximum lookback per timeframe (IEX free tier limits intraday to ~30 days)
TIMEFRAME_MAX_DAYS = {
    "1m": 30, "5m": 30,
    "15m": 60, "30m": 60,
    "1h": 730, "4h": 730,
    "1d": 3650,   # ~10 years — Alpaca IEX goes back to 2016
    "1w": 3650,
}

@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    timeframe: Timeframe = Timeframe.D1,
    broker: Broker = Broker.ALPACA,
    start: datetime = None,
    end: datetime = None,
    limit: int = Query(default=10000, le=10000),
):
    """Fetch OHLCV candles. Defaults to maximum available history for each timeframe."""
    if end is None:
        end = datetime.now(timezone.utc)
    if start is None:
        days = TIMEFRAME_MAX_DAYS.get(timeframe.value, 3650)
        start = end - timedelta(days=days)

    try:
        data = await get_broker(broker).get_candles(symbol.upper(), timeframe, start, end, limit)
        return {
            "symbol": data.symbol,
            "timeframe": data.timeframe,
            "broker": data.broker,
            "count": len(data.candles),
            "candles": [c.dict() for c in data.candles],
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Broker error: {str(e)}")


@router.get("/symbols")
async def get_symbols(broker: Broker = Broker.ALPACA):
    """List all tradeable symbols for a broker."""
    try:
        symbols = await get_broker(broker).get_symbols()
        return {"broker": broker, "count": len(symbols), "symbols": symbols[:500]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
