"""Unit tests for backtesting engine and metrics."""
import pytest
from datetime import datetime, timezone, timedelta
from app.backtesting.engine import BacktestEngine
from app.backtesting.metrics import (
    calc_sharpe_ratio, calc_max_drawdown, calc_annualized_return,
    calc_profit_factor, calc_calmar_ratio, calc_sortino_ratio,
)
from app.models.backtest import BacktestConfig
from app.models.candlestick import Timeframe, Broker
from app.algorithms import STRATEGY_REGISTRY


class TestMetrics:
    def test_sharpe_positive_returns(self):
        returns = [0.01, 0.02, 0.015, 0.01, 0.02] * 50
        sharpe = calc_sharpe_ratio(returns)
        assert sharpe > 0

    def test_sharpe_negative_returns(self):
        returns = [-0.01, -0.02] * 50
        sharpe = calc_sharpe_ratio(returns)
        assert sharpe < 0

    def test_sharpe_empty_returns(self):
        assert calc_sharpe_ratio([]) == 0.0

    def test_max_drawdown_is_negative(self):
        equity = [100, 110, 105, 95, 100, 115]
        dd = calc_max_drawdown(equity)
        assert dd < 0

    def test_max_drawdown_no_drawdown(self):
        equity = [100, 110, 120, 130]
        dd = calc_max_drawdown(equity)
        assert dd == pytest.approx(0.0, abs=1e-6)

    def test_annualized_return(self):
        ann = calc_annualized_return(0.10, 252)
        assert ann == pytest.approx(0.10, rel=0.01)

    def test_profit_factor_all_winners(self):
        pf = calc_profit_factor(1000, 0)
        assert pf == float("inf")

    def test_profit_factor_normal(self):
        pf = calc_profit_factor(1500, 500)
        assert pf == pytest.approx(3.0)

    def test_calmar_ratio(self):
        cr = calc_calmar_ratio(0.20, -0.10)
        assert cr == pytest.approx(2.0)


class TestBacktestEngine:
    def _make_config(self, strategy: str) -> BacktestConfig:
        return BacktestConfig(
            symbol="AAPL", strategy=strategy,
            start_date=datetime(2023, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
            initial_capital=10_000.0,
        )

    def _make_config_naive(self, strategy: str) -> BacktestConfig:
        """Config with timezone-naive dates — must not crash."""
        return BacktestConfig(
            symbol="AAPL", strategy=strategy,
            start_date=datetime(2023, 1, 1),   # no tzinfo
            end_date=datetime(2024, 1, 1),
            initial_capital=10_000.0,
        )

    def test_rsi_backtest_returns_result(self, oscillating_series):
        engine = BacktestEngine()
        config = self._make_config("rsi")
        result = engine.run(config, oscillating_series)
        assert result.total_trades >= 0
        assert result.config.initial_capital == 10_000.0

    def test_equity_curve_starts_at_initial_capital(self, trending_up_series):
        engine = BacktestEngine()
        config = self._make_config("moving_average_crossover")
        result = engine.run(config, trending_up_series)
        assert result.equity_curve[0]["equity"] == 10_000.0

    def test_equity_curve_length_matches_candles(self, oscillating_series):
        engine = BacktestEngine()
        config = self._make_config("rsi")
        result = engine.run(config, oscillating_series)
        assert len(result.equity_curve) == len(oscillating_series.candles)

    def test_win_rate_between_0_and_1(self, oscillating_series):
        engine = BacktestEngine()
        config = self._make_config("rsi")
        result = engine.run(config, oscillating_series)
        assert 0.0 <= result.win_rate <= 1.0

    def test_no_inf_or_nan_in_metrics(self, oscillating_series):
        """profit_factor, calmar_ratio, sortino_ratio must never be inf/nan (breaks JSON)."""
        engine = BacktestEngine()
        import math
        for strategy_name in STRATEGY_REGISTRY:
            config = self._make_config(strategy_name)
            result = engine.run(config, oscillating_series)
            for field in ["sharpe_ratio", "sortino_ratio", "calmar_ratio", "profit_factor", "volatility"]:
                val = getattr(result, field)
                assert not math.isinf(val), f"{field} is inf for {strategy_name}"
                assert not math.isnan(val), f"{field} is nan for {strategy_name}"

    def test_timezone_naive_dates_do_not_crash(self, oscillating_series):
        """Config with naive datetimes must not raise TypeError during comparison."""
        engine = BacktestEngine()
        config = self._make_config_naive("rsi")
        result = engine.run(config, oscillating_series)
        assert result is not None

    def test_equity_curve_updates_after_trades(self, oscillating_series):
        """Equity curve must actually change when trades close (date-key matching works)."""
        engine = BacktestEngine()
        config = self._make_config("rsi")
        result = engine.run(config, oscillating_series)
        if result.total_trades > 0:
            equities = [p["equity"] for p in result.equity_curve]
            assert max(equities) != min(equities), "Equity curve never changed despite completed trades"

    def test_backtest_all_strategies(self, oscillating_series):
        engine = BacktestEngine()
        for strategy_name in STRATEGY_REGISTRY:
            config = self._make_config(strategy_name)
            result = engine.run(config, oscillating_series)
            assert result is not None
            assert hasattr(result, "total_return")

    def test_sharpe_ratio_is_float(self, oscillating_series):
        engine = BacktestEngine()
        config = self._make_config("macd")
        result = engine.run(config, oscillating_series)
        assert isinstance(result.sharpe_ratio, float)

    def test_winning_plus_losing_equals_total(self, oscillating_series):
        engine = BacktestEngine()
        config = self._make_config("rsi")
        result = engine.run(config, oscillating_series)
        assert result.winning_trades + result.losing_trades == result.total_trades
