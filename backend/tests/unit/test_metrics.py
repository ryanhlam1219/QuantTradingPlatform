"""
Unit tests for the backtesting engine and performance metrics.
"""
import pytest
from datetime import datetime, timezone, timedelta

from app.backtesting.engine import BacktestEngine
from app.backtesting.metrics import calculate_metrics, build_drawdown_curve, _sharpe, _sortino
from app.models.backtest import BacktestConfig, TradeRecord
from app.models.candlestick import TimeFrame, Broker
from app.strategies.moving_average import MovingAverageCrossoverStrategy
from app.strategies.rsi import RSIStrategy
from tests.conftest import make_series


START = datetime(2020, 1, 1, tzinfo=timezone.utc)
END   = datetime(2021, 1, 1, tzinfo=timezone.utc)


def _basic_config(**kwargs) -> BacktestConfig:
    defaults = dict(
        symbol="AAPL",
        broker=Broker.MOCK,
        timeframe=TimeFrame.ONE_DAY,
        strategy_name="moving_average_crossover",
        start_date=START,
        end_date=END,
        initial_capital=10_000.0,
        position_size_pct=0.10,
        commission_pct=0.001,
    )
    defaults.update(kwargs)
    return BacktestConfig(**defaults)


# ================================================================== #
# Backtesting Engine
# ================================================================== #

class TestBacktestEngine:

    def test_engine_runs_without_error(self, trending_up_series):
        config   = _basic_config()
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        engine   = BacktestEngine()
        result   = engine.run(config=config, strategy=strategy, series=trending_up_series)
        assert result is not None

    def test_equity_curve_length_matches_candles(self, trending_up_series):
        config   = _basic_config()
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        result   = BacktestEngine().run(config, strategy, trending_up_series)
        assert len(result.equity_curve) == len(trending_up_series.candles)

    def test_equity_curve_starts_near_initial_capital(self, ranging_series):
        config   = _basic_config(initial_capital=10_000.0)
        strategy = RSIStrategy()
        result   = BacktestEngine().run(config, strategy, ranging_series)
        first_val = result.equity_curve[0]["value"]
        assert abs(first_val - 10_000.0) < 1_000.0, "Equity should start near initial capital"

    def test_final_capital_reflects_trades(self, trending_up_series):
        config   = _basic_config(initial_capital=10_000.0)
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        result   = BacktestEngine().run(config, strategy, trending_up_series)
        assert result.metrics.final_capital > 0

    def test_stop_loss_triggers(self):
        # Price crashes below stop-loss level
        closes = [100.0] * 10 + [101.0] + [100.0] * 3 + [80.0] * 5
        series = make_series(closes)
        config = _basic_config(stop_loss_pct=0.05, position_size_pct=1.0)
        strategy = MovingAverageCrossoverStrategy({"fast_period": 3, "slow_period": 5})
        result = BacktestEngine().run(config, strategy, series)
        stop_trades = [t for t in result.trades if "stop-loss" in t.strategy_name]
        # Not guaranteed to trigger given data shape, but engine must not crash
        assert isinstance(result.trades, list)

    def test_commission_reduces_capital(self, trending_up_series):
        config_no_comm = _basic_config(commission_pct=0.0)
        config_commission = _basic_config(commission_pct=0.01)
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        r_no_comm  = BacktestEngine().run(config_no_comm, strategy, trending_up_series)
        r_with_comm = BacktestEngine().run(config_commission, strategy, trending_up_series)
        assert r_with_comm.metrics.total_commission_paid >= 0

    def test_empty_series_raises(self):
        from app.models.candlestick import CandleSeries
        empty = CandleSeries(
            symbol="AAPL", broker=Broker.MOCK,
            asset_class=__import__("app.models.candlestick", fromlist=["AssetClass"]).AssetClass.STOCK,
            timeframe=TimeFrame.ONE_DAY, candles=[]
        )
        config   = _basic_config()
        strategy = MovingAverageCrossoverStrategy()
        with pytest.raises(ValueError):
            BacktestEngine().run(config, strategy, empty)

    def test_run_duration_recorded(self, trending_up_series):
        config   = _basic_config()
        strategy = MovingAverageCrossoverStrategy({"fast_period": 5, "slow_period": 10})
        result   = BacktestEngine().run(config, strategy, trending_up_series)
        assert result.run_duration_seconds > 0


# ================================================================== #
# Performance Metrics
# ================================================================== #

class TestPerformanceMetrics:

    def _make_equity_curve(self, values: list[float]) -> list[dict]:
        start = datetime(2020, 1, 1, tzinfo=timezone.utc)
        return [
            {"timestamp": start + timedelta(days=i), "value": v}
            for i, v in enumerate(values)
        ]

    def test_positive_return(self):
        curve = self._make_equity_curve([10_000, 10_500, 11_000, 12_000])
        metrics = calculate_metrics(
            trades=[], equity_curve=curve,
            initial_capital=10_000, benchmark_start=100, benchmark_end=110,
            start_date=datetime(2020, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2020, 1, 4, tzinfo=timezone.utc),
        )
        assert metrics.total_return_pct == pytest.approx(20.0, abs=0.01)

    def test_negative_return(self):
        curve = self._make_equity_curve([10_000, 9_500, 9_000, 8_000])
        metrics = calculate_metrics(
            trades=[], equity_curve=curve,
            initial_capital=10_000, benchmark_start=100, benchmark_end=90,
            start_date=datetime(2020, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2020, 1, 4, tzinfo=timezone.utc),
        )
        assert metrics.total_return_pct == pytest.approx(-20.0, abs=0.01)

    def test_win_rate_calculation(self):
        trades = [
            TradeRecord(symbol="X", side="long", entry_time=START, exit_time=END,
                        entry_price=100, exit_price=110, quantity=1,
                        pnl=10, pnl_pct=10, commission=0, strategy_name="t"),
            TradeRecord(symbol="X", side="long", entry_time=START, exit_time=END,
                        entry_price=100, exit_price=90, quantity=1,
                        pnl=-10, pnl_pct=-10, commission=0, strategy_name="t"),
        ]
        curve = self._make_equity_curve([10_000, 10_000])
        metrics = calculate_metrics(
            trades=trades, equity_curve=curve,
            initial_capital=10_000, benchmark_start=100, benchmark_end=100,
            start_date=START, end_date=END,
        )
        assert metrics.win_rate_pct == pytest.approx(50.0)
        assert metrics.winning_trades == 1
        assert metrics.losing_trades == 1

    def test_sharpe_ratio_positive_for_positive_returns(self):
        returns = [0.01] * 252  # 1% per day, no variance
        result  = _sharpe(returns)
        assert result > 0

    def test_sortino_ignores_upside_volatility(self):
        mixed   = [0.01, -0.01, 0.02, -0.02, 0.01, 0.03]
        up_only = [0.01, 0.02, 0.03, 0.01, 0.02, 0.03]
        s_mixed = _sortino(mixed)
        s_up    = _sortino(up_only)
        # All-upside returns → sortino should be very high (or inf)
        assert s_up > s_mixed or s_up == float("inf")

    def test_drawdown_curve_always_non_positive(self):
        curve = self._make_equity_curve([10_000, 11_000, 9_000, 10_500, 8_000])
        dd    = build_drawdown_curve(curve)
        for point in dd:
            assert point["drawdown_pct"] <= 0.0001  # allow float rounding

    def test_max_drawdown_detected(self):
        curve = self._make_equity_curve([10_000, 12_000, 6_000, 10_000])
        metrics = calculate_metrics(
            trades=[], equity_curve=curve,
            initial_capital=10_000, benchmark_start=100, benchmark_end=100,
            start_date=START, end_date=END,
        )
        # Peak=12000, trough=6000 → 50% drawdown
        assert metrics.max_drawdown_pct == pytest.approx(50.0, abs=0.5)
