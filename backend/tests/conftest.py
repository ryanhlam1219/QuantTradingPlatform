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


def make_series(closes: list[float] = None, symbol: str = "AAPL", timeframe=Timeframe.D1) -> CandleSeries:
    """Helper to create a CandleSeries from a list of close prices or default data."""
    if closes is None:
        closes = [100 + i * 0.5 for i in range(200)]
    
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    candles = [make_candle(close, base + timedelta(days=i), symbol) for i, close in enumerate(closes)]
    return CandleSeries(symbol=symbol, timeframe=timeframe, broker=Broker.MOCK, candles=candles)


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


@pytest.fixture
def rsi_oversold_series():
    """Candle series with RSI dropping below oversold threshold then recovering."""
    import math
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    # Create a sharp drop followed by recovery
    prices = [100] * 20 + [100 - i * 2 for i in range(1, 21)] + [20 + i * 2 for i in range(1, 21)]
    candles = [make_candle(price, base + timedelta(days=i)) for i, price in enumerate(prices)]
    return CandleSeries(symbol="AAPL", timeframe=Timeframe.D1, broker=Broker.MOCK, candles=candles)
