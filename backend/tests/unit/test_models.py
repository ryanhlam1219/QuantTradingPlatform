"""Unit tests for Pydantic models."""
import pytest
from datetime import datetime, timezone
from app.models.candlestick import Candle, CandleSeries, Timeframe, Broker, AssetClass
from app.models.signal import Signal, SignalType
from app.models.backtest import BacktestConfig, Trade


class TestCandle:
    def make_candle(self, open_, high, low, close):
        return Candle(
            symbol="AAPL", open=open_, high=high, low=low, close=close,
            volume=1000, timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
            timeframe=Timeframe.D1, broker=Broker.ALPACA, asset_class=AssetClass.STOCK,
        )

    def test_is_bullish_when_close_above_open(self):
        c = self.make_candle(100, 110, 95, 105)
        assert c.is_bullish is True

    def test_is_bearish_when_close_below_open(self):
        c = self.make_candle(105, 110, 95, 100)
        assert c.is_bullish is False

    def test_body_size(self):
        c = self.make_candle(100, 110, 90, 107)
        assert c.body_size == pytest.approx(7.0)

    def test_upper_wick(self):
        c = self.make_candle(100, 110, 90, 107)
        assert c.upper_wick == pytest.approx(3.0)  # 110 - 107

    def test_lower_wick(self):
        c = self.make_candle(100, 110, 90, 107)
        assert c.lower_wick == pytest.approx(10.0)  # 100 - 90

    def test_range(self):
        c = self.make_candle(100, 110, 90, 105)
        assert c.range == pytest.approx(20.0)


class TestCandleSeries:
    def test_closes_property(self, trending_up_series):
        closes = trending_up_series.closes
        assert len(closes) == len(trending_up_series.candles)
        assert all(isinstance(c, float) for c in closes)

    def test_series_is_chronological(self, trending_up_series):
        timestamps = trending_up_series.timestamps
        assert timestamps == sorted(timestamps)


class TestBacktestConfig:
    def test_default_initial_capital(self):
        config = BacktestConfig(
            symbol="AAPL", strategy="rsi",
            start_date=datetime(2023, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert config.initial_capital == 10_000.0

    def test_commission_defaults_to_zero(self):
        config = BacktestConfig(
            symbol="AAPL", strategy="macd",
            start_date=datetime(2023, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert config.commission == 0.0
