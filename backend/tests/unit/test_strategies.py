"""
Unit tests for all trading strategies.

These tests are fully offline — no broker calls, no network.
"""
import pytest
from datetime import datetime, timezone, timedelta

from app.models.trade import OrderSide
from app.strategies.moving_average import MovingAverageCrossoverStrategy
from app.strategies.rsi import RSIStrategy, _rsi
from app.strategies.bollinger_bands import BollingerBandsStrategy
from app.strategies.macd import MACDStrategy
from app.strategies.grid_trading import GridTradingStrategy
from tests.conftest import make_series


# ================================================================== #
# Moving Average Crossover
# ================================================================== #

class TestMovingAverageCrossover:

    def test_golden_cross_generates_buy(self, trending_up_series):
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        signals = strategy.generate_signals(trending_up_series)
        buys = [s for s in signals if s.side == OrderSide.BUY]
        assert len(buys) >= 1, "Expected at least one BUY on uptrend"

    def test_death_cross_generates_sell(self, trending_down_series):
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        signals = strategy.generate_signals(trending_down_series)
        sells = [s for s in signals if s.side == OrderSide.SELL]
        assert len(sells) >= 1, "Expected at least one SELL on downtrend"

    def test_insufficient_data_returns_empty(self):
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 30})
        tiny = make_series([100.0, 101.0, 102.0])  # only 3 candles
        assert strategy.generate_signals(tiny) == []

    def test_signals_have_correct_symbol(self, trending_up_series):
        strategy = MovingAverageCrossoverStrategy()
        signals = strategy.generate_signals(trending_up_series)
        for sig in signals:
            assert sig.symbol == trending_up_series.symbol

    def test_sma_variant_works(self, trending_up_series):
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10, "ma_type": "sma"})
        signals = strategy.generate_signals(trending_up_series)
        assert isinstance(signals, list)

    def test_confidence_between_0_and_1(self, trending_up_series):
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        for sig in strategy.generate_signals(trending_up_series):
            assert 0.0 <= sig.confidence <= 1.0

    def test_strategy_name(self):
        assert MovingAverageCrossoverStrategy().name == "moving_average_crossover"

    def test_default_params_applied(self):
        s = MovingAverageCrossoverStrategy()
        assert s.params["fast_period"] == 10
        assert s.params["slow_period"] == 30

    def test_custom_params_override_defaults(self):
        s = MovingAverageCrossoverStrategy({"fast_period": 3})
        assert s.params["fast_period"] == 3
        assert s.params["slow_period"] == 30  # default still applied


# ================================================================== #
# RSI
# ================================================================== #

class TestRSI:

    def test_rsi_calculation_length(self):
        closes = [float(i) for i in range(1, 51)]
        result = _rsi(closes, 14)
        assert len(result) == 50

    def test_rsi_range(self):
        closes = [100 + i % 5 for i in range(50)]
        values = [v for v in _rsi(closes, 14) if v is not None]
        for v in values:
            assert 0 <= v <= 100, f"RSI out of range: {v}"

    def test_buy_signal_on_oversold_recovery(self, rsi_oversold_series):
        strategy = RSIStrategy({"period": 14, "oversold": 30, "overbought": 70})
        signals = strategy.generate_signals(rsi_oversold_series)
        buys = [s for s in signals if s.side == OrderSide.BUY]
        assert len(buys) >= 1, "Expected BUY after RSI crosses back above 30"

    def test_no_signals_on_short_series(self):
        strategy = RSIStrategy()
        assert strategy.generate_signals(make_series([100.0] * 5)) == []

    def test_strategy_name(self):
        assert RSIStrategy().name == "rsi"

    def test_signal_metadata_contains_rsi(self, rsi_oversold_series):
        strategy = RSIStrategy()
        signals = strategy.generate_signals(rsi_oversold_series)
        for sig in signals:
            assert "rsi" in sig.metadata


# ================================================================== #
# Bollinger Bands
# ================================================================== #

class TestBollingerBands:

    def test_buy_below_lower_band(self):
        # Sharp spike down then recovery
        closes = [100.0] * 20 + [70.0] + [100.0] * 5
        series = make_series(closes)
        strategy = BollingerBandsStrategy({"period": 20, "std_dev": 2.0})
        signals = strategy.generate_signals(series)
        buys = [s for s in signals if s.side == OrderSide.BUY]
        assert len(buys) >= 1

    def test_sell_above_upper_band(self):
        closes = [100.0] * 20 + [140.0] + [100.0] * 5
        series = make_series(closes)
        strategy = BollingerBandsStrategy({"period": 20, "std_dev": 2.0})
        signals = strategy.generate_signals(series)
        sells = [s for s in signals if s.side == OrderSide.SELL]
        assert len(sells) >= 1

    def test_strategy_name(self):
        assert BollingerBandsStrategy().name == "bollinger_bands"

    def test_metadata_has_bands(self):
        closes = [100.0] * 20 + [70.0]
        series = make_series(closes)
        strategy = BollingerBandsStrategy({"period": 20, "std_dev": 2.0})
        signals = strategy.generate_signals(series)
        for sig in signals:
            assert "upper_band" in sig.metadata
            assert "lower_band" in sig.metadata


# ================================================================== #
# MACD
# ================================================================== #

class TestMACD:

    def test_bullish_crossover_generates_buy(self, trending_up_series):
        strategy = MACDStrategy({"fast_period": 5, "slow_period": 10, "signal_period": 3})
        signals = strategy.generate_signals(trending_up_series)
        buys = [s for s in signals if s.side == OrderSide.BUY]
        assert len(buys) >= 1

    def test_insufficient_data_empty(self):
        strategy = MACDStrategy()
        assert strategy.generate_signals(make_series([100.0] * 10)) == []

    def test_strategy_name(self):
        assert MACDStrategy().name == "macd"

    def test_metadata_has_macd_and_signal(self, trending_up_series):
        strategy = MACDStrategy({"fast_period": 5, "slow_period": 10, "signal_period": 3})
        signals = strategy.generate_signals(trending_up_series)
        for sig in signals:
            assert "macd" in sig.metadata
            assert "signal" in sig.metadata
            assert "histogram" in sig.metadata


# ================================================================== #
# Grid Trading
# ================================================================== #

class TestGridTrading:

    def test_generates_buy_on_price_drop(self):
        # Start at 100, dip to grid level
        closes = [100.0] * 5 + [98.0, 97.0, 96.0] + [100.0] * 5
        series = make_series(closes)
        strategy = GridTradingStrategy({"grid_levels": 5, "grid_spacing_pct": 1.0})
        signals = strategy.generate_signals(series)
        buys = [s for s in signals if s.side == OrderSide.BUY]
        assert len(buys) >= 1

    def test_generates_sell_on_price_rise(self):
        closes = [100.0] * 5 + [101.5, 102.5, 103.5] + [100.0] * 5
        series = make_series(closes)
        strategy = GridTradingStrategy({"grid_levels": 5, "grid_spacing_pct": 1.0})
        signals = strategy.generate_signals(series)
        sells = [s for s in signals if s.side == OrderSide.SELL]
        assert len(sells) >= 1

    def test_strategy_name(self):
        assert GridTradingStrategy().name == "grid_trading"

    def test_metadata_has_grid_info(self):
        closes = [100.0] * 5 + [97.0] * 3
        series = make_series(closes)
        strategy = GridTradingStrategy({"grid_levels": 5, "grid_spacing_pct": 1.0})
        signals = strategy.generate_signals(series)
        for sig in signals:
            assert "grid_level_index" in sig.metadata
            assert "grid_price" in sig.metadata

    def test_no_duplicate_level_triggers(self):
        # Price stays below same level — should only trigger once
        closes = [100.0] * 5 + [97.5] * 10
        series = make_series(closes)
        strategy = GridTradingStrategy({"grid_levels": 5, "grid_spacing_pct": 1.0})
        signals = strategy.generate_signals(series)
        # Count signals at grid level 0 (first buy level)
        level_0_buys = [s for s in signals if s.metadata.get("grid_level_index") == 0 and s.side == OrderSide.BUY]
        assert len(level_0_buys) == 1, "Same grid level should not trigger twice"


# ================================================================== #
# Strategy Registry
# ================================================================== #

class TestStrategyRegistry:

    def test_get_all_strategies(self):
        from app.strategies.registry import list_strategies
        strategies = list_strategies()
        names = {s["name"] for s in strategies}
        assert "moving_average_crossover" in names
        assert "rsi" in names
        assert "bollinger_bands" in names
        assert "macd" in names
        assert "grid_trading" in names

    def test_get_strategy_by_name(self):
        from app.strategies.registry import get_strategy
        s = get_strategy("rsi", {"period": 7})
        assert s.params["period"] == 7

    def test_unknown_strategy_raises(self):
        from app.strategies.registry import get_strategy
        with pytest.raises(ValueError):
            get_strategy("nonexistent_strategy")
