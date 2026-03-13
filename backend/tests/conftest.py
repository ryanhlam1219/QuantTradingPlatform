"""Shared test fixtures."""
import pytest
from datetime import datetime, timezone, timedelta
from app.models.candlestick import Candle, CandleSeries, Timeframe, Broker, AssetClass


def make_candle(close: float, ts: datetime, symbol="AAPL") -> Candle:
    return Candle(
        symbol=symbol, open=close * 0.99, high=close * 1.01,
        low=close * 0.98, close=close, volume=1_000_000.0,
        timestamp=ts, timeframe=Timeframe.D1, broker=Broker.MOCK,
        asset_class=AssetClass.STOCK,
    )


@pytest.fixture
def trending_up_series():
    """Candle series with a clear uptrend."""
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    candles = [make_candle(100 + i * 0.5, base + timedelta(days=i)) for i in range(200)]
    return CandleSeries(symbol="AAPL", timeframe=Timeframe.D1, broker=Broker.MOCK, candles=candles)


@pytest.fixture
def trending_down_series():
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    candles = [make_candle(200 - i * 0.5, base + timedelta(days=i)) for i in range(200)]
    return CandleSeries(symbol="AAPL", timeframe=Timeframe.D1, broker=Broker.MOCK, candles=candles)


@pytest.fixture
def oscillating_series():
    """Candle series that oscillates around a mean — good for grid/RSI."""
    import math
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    candles = [
        make_candle(100 + 15 * math.sin(i * 0.2), base + timedelta(days=i))
        for i in range(300)
    ]
    return CandleSeries(symbol="AAPL", timeframe=Timeframe.D1, broker=Broker.MOCK, candles=candles)


@pytest.fixture
def short_series():
    """Only 10 candles — for testing edge cases."""
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    candles = [make_candle(100 + i, base + timedelta(days=i)) for i in range(10)]
    return CandleSeries(symbol="AAPL", timeframe=Timeframe.D1, broker=Broker.MOCK, candles=candles)
