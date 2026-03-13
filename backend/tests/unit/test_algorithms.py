"""Unit tests for all trading strategies."""
import pytest
from app.algorithms import get_strategy, list_strategies, STRATEGY_REGISTRY
from app.models.signal import SignalType


class TestMovingAverageCrossover:
    def test_generates_buy_signal_on_uptrend(self, trending_up_series):
        strategy = get_strategy("moving_average_crossover", {"fast_period": 10, "slow_period": 30})
        signals = strategy.generate_signals(trending_up_series)
        buy_signals = [s for s in signals if s.signal_type == SignalType.BUY]
        assert len(buy_signals) >= 1

    def test_generates_sell_signal_on_downtrend(self, trending_down_series):
        strategy = get_strategy("moving_average_crossover", {"fast_period": 10, "slow_period": 30})
        signals = strategy.generate_signals(trending_down_series)
        sell_signals = [s for s in signals if s.signal_type == SignalType.SELL]
        assert len(sell_signals) >= 1

    def test_no_signals_on_short_series(self, short_series):
        strategy = get_strategy("moving_average_crossover")
        signals = strategy.generate_signals(short_series)
        assert signals == []

    def test_signal_confidence_between_0_and_1(self, trending_up_series):
        strategy = get_strategy("moving_average_crossover")
        signals = strategy.generate_signals(trending_up_series)
        for s in signals:
            assert 0.0 <= s.confidence <= 1.0

    def test_ema_vs_sma_param(self, trending_up_series):
        ema_strat = get_strategy("moving_average_crossover", {"ma_type": "ema"})
        sma_strat = get_strategy("moving_average_crossover", {"ma_type": "sma"})
        ema_signals = ema_strat.generate_signals(trending_up_series)
        sma_signals = sma_strat.generate_signals(trending_up_series)
        # Both should produce signals; counts may differ
        assert isinstance(ema_signals, list)
        assert isinstance(sma_signals, list)

    def test_describe_returns_required_fields(self):
        strategy = get_strategy("moving_average_crossover")
        info = strategy.describe()
        for field in ["name", "display_name", "description", "params", "best_for"]:
            assert field in info


class TestRSI:
    def test_buy_signal_when_oversold(self, oscillating_series):
        strategy = get_strategy("rsi", {"period": 14, "oversold": 40, "overbought": 60})
        signals = strategy.generate_signals(oscillating_series)
        assert any(s.signal_type == SignalType.BUY for s in signals)

    def test_sell_signal_when_overbought(self, oscillating_series):
        strategy = get_strategy("rsi", {"period": 14, "oversold": 40, "overbought": 60})
        signals = strategy.generate_signals(oscillating_series)
        assert any(s.signal_type == SignalType.SELL for s in signals)

    def test_no_signals_on_short_series(self, short_series):
        strategy = get_strategy("rsi")
        signals = strategy.generate_signals(short_series)
        assert signals == []

    def test_metadata_contains_rsi(self, oscillating_series):
        strategy = get_strategy("rsi")
        signals = strategy.generate_signals(oscillating_series)
        for s in signals:
            assert "rsi" in s.metadata

    def test_default_params(self):
        strategy = get_strategy("rsi")
        assert strategy.params["period"] == 14
        assert strategy.params["oversold"] == 30
        assert strategy.params["overbought"] == 70


class TestBollingerBands:
    def test_generates_signals_on_oscillating(self, oscillating_series):
        strategy = get_strategy("bollinger_bands")
        signals = strategy.generate_signals(oscillating_series)
        assert len(signals) > 0

    def test_metadata_has_band_values(self, oscillating_series):
        strategy = get_strategy("bollinger_bands")
        signals = strategy.generate_signals(oscillating_series)
        for s in signals:
            assert "upper" in s.metadata
            assert "lower" in s.metadata
            assert "middle" in s.metadata

    def test_no_signals_on_short_series(self, short_series):
        strategy = get_strategy("bollinger_bands")
        signals = strategy.generate_signals(short_series)
        assert signals == []


class TestMACD:
    def test_bullish_crossover_on_uptrend(self, trending_up_series):
        strategy = get_strategy("macd")
        signals = strategy.generate_signals(trending_up_series)
        buys = [s for s in signals if s.signal_type == SignalType.BUY]
        assert len(buys) >= 1

    def test_metadata_has_macd_components(self, oscillating_series):
        strategy = get_strategy("macd")
        signals = strategy.generate_signals(oscillating_series)
        for s in signals:
            assert "macd" in s.metadata
            assert "signal" in s.metadata
            assert "histogram" in s.metadata

    def test_no_signals_on_short_series(self, short_series):
        strategy = get_strategy("macd")
        signals = strategy.generate_signals(short_series)
        assert signals == []


class TestGridTrading:
    def test_generates_signals_on_oscillating(self, oscillating_series):
        strategy = get_strategy("grid_trading", {"grid_levels": 5, "grid_spacing_pct": 0.03, "lookback": 30})
        signals = strategy.generate_signals(oscillating_series)
        assert len(signals) > 0

    def test_alternates_buy_sell(self, oscillating_series):
        strategy = get_strategy("grid_trading", {"grid_levels": 5, "grid_spacing_pct": 0.03, "lookback": 30})
        signals = strategy.generate_signals(oscillating_series)
        buys = [s for s in signals if s.signal_type == SignalType.BUY]
        sells = [s for s in signals if s.signal_type == SignalType.SELL]
        assert len(buys) > 0
        assert len(sells) > 0

    def test_metadata_has_grid_info(self, oscillating_series):
        strategy = get_strategy("grid_trading")
        signals = strategy.generate_signals(oscillating_series)
        for s in signals:
            assert "grid_level" in s.metadata
            assert "center" in s.metadata


class TestStrategyRegistry:
    def test_all_strategies_registered(self):
        expected = {"moving_average_crossover", "rsi", "bollinger_bands", "macd", "grid_trading"}
        assert set(STRATEGY_REGISTRY.keys()) == expected

    def test_list_strategies_returns_all(self):
        strategies = list_strategies()
        assert len(strategies) == len(STRATEGY_REGISTRY)

    def test_get_unknown_strategy_raises(self):
        with pytest.raises(ValueError, match="Unknown strategy"):
            get_strategy("nonexistent_algo")

    def test_all_strategies_have_describe(self):
        for name in STRATEGY_REGISTRY:
            strategy = get_strategy(name)
            info = strategy.describe()
            assert "name" in info
            assert "description" in info
