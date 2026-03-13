from datetime import datetime
from fastapi import APIRouter, Query, HTTPException
from app.models.candlestick import CandleSeries, TimeFrame, AssetClass, Broker

router = APIRouter(prefix="/candles", tags=["candlesticks"])


def _get_broker(broker: Broker):
    if broker == Broker.ALPACA:
        from app.brokers.alpaca import AlpacaBroker
        return AlpacaBroker()
    elif broker == Broker.KRAKEN:
        from app.brokers.kraken import KrakenBroker
        return KrakenBroker()
    elif broker == Broker.BINANCE_US:
        from app.brokers.binance_us import BinanceUSBroker
        return BinanceUSBroker()
    raise HTTPException(status_code=400, detail=f"Broker '{broker}' not supported")


@router.get("/{symbol}", response_model=CandleSeries)
async def get_candles(
    symbol: str,
    broker: Broker = Query(Broker.ALPACA),
    timeframe: TimeFrame = Query(TimeFrame.ONE_DAY),
    asset_class: AssetClass = Query(AssetClass.STOCK),
    start: datetime = Query(..., description="Start datetime in UTC ISO 8601"),
    end: datetime = Query(..., description="End datetime in UTC ISO 8601"),
):
    """Fetch historical OHLCV candles for a symbol via the specified broker."""
    b = _get_broker(broker)
    try:
        return await b.get_candles(
            symbol=symbol.upper(),
            timeframe=timeframe,
            start=start,
            end=end,
            asset_class=asset_class,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/{symbol}/latest", response_model=CandleSeries)
async def get_latest_candles(
    symbol: str,
    broker: Broker = Query(Broker.ALPACA),
    timeframe: TimeFrame = Query(TimeFrame.ONE_DAY),
    asset_class: AssetClass = Query(AssetClass.STOCK),
):
    """Fetch the most recent candles for a symbol (lookback window auto-determined)."""
    b = _get_broker(broker)
    try:
        return await b.get_latest_candle(
            symbol=symbol.upper(),
            timeframe=timeframe,
            asset_class=asset_class,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
