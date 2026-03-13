"""
Backtesting Engine.
Simulates strategy execution against historical candlestick data.
"""
import numpy as np
from datetime import datetime, timezone
from typing import Optional

from app.models.candlestick import CandleSeries
from app.models.backtest import BacktestConfig, BacktestResult, Trade
from app.models.signal import Signal, SignalType
from app.strategies.registry import get_strategy
from app.backtesting.metrics import (
    calc_sharpe_ratio, calc_sortino_ratio, calc_max_drawdown,
    calc_annualized_return, calc_calmar_ratio, calc_profit_factor,
)


def _to_utc(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware in UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _safe_float(value: float) -> float:
    """Replace inf/nan with a large sentinel so JSON serialization never breaks."""
    if value != value or value == float("inf"):   # nan or +inf
        return 9999.0
    if value == float("-inf"):
        return -9999.0
    return value


class BacktestEngine:
    def run(self, config: BacktestConfig, series: CandleSeries) -> BacktestResult:
        strategy = get_strategy(config.strategy, config.strategy_params)
        signals = strategy.generate_signals(series)

        # Normalise config dates to UTC so comparisons never throw TypeError
        start_utc = _to_utc(config.start_date)
        end_utc   = _to_utc(config.end_date)

        signals = [s for s in signals if start_utc <= _to_utc(s.timestamp) <= end_utc]

        trades = self._simulate_trades(signals, series, config)
        equity_curve = self._build_equity_curve(trades, series, config)
        metrics = self._calculate_metrics(trades, equity_curve, config)

        return BacktestResult(
            config=config,
            trades=trades,
            signals=signals,
            equity_curve=equity_curve,
            **metrics,
        )

    def _simulate_trades(self, signals: list[Signal], series: CandleSeries, config: BacktestConfig) -> list[Trade]:
        trades = []
        open_trade: Optional[Trade] = None
        capital = config.initial_capital

        for signal in signals:
            if signal.signal_type == SignalType.BUY:
                price = signal.price * (1 + config.slippage)
            else:
                price = signal.price * (1 - config.slippage)

            if signal.signal_type == SignalType.BUY and open_trade is None:
                quantity = (capital * 0.95) / price  # Use 95% of capital per trade
                commission = price * quantity * config.commission
                open_trade = Trade(
                    symbol=signal.symbol,
                    entry_price=price,
                    entry_time=signal.timestamp,
                    quantity=quantity,
                    direction="long",
                    commission=commission,
                )
                capital -= price * quantity + commission

            elif signal.signal_type == SignalType.SELL and open_trade is not None:
                commission = price * open_trade.quantity * config.commission
                pnl = (price - open_trade.entry_price) * open_trade.quantity - commission - open_trade.commission
                pnl_pct = pnl / (open_trade.entry_price * open_trade.quantity)
                open_trade.exit_price = price
                open_trade.exit_time = signal.timestamp
                open_trade.pnl = pnl
                open_trade.pnl_pct = pnl_pct
                open_trade.commission += commission
                capital += price * open_trade.quantity - commission
                trades.append(open_trade)
                open_trade = None

        # Close any open trade at end of data using last candle's close
        if open_trade is not None and series.candles:
            last = series.candles[-1]
            commission = last.close * open_trade.quantity * config.commission
            pnl = (last.close - open_trade.entry_price) * open_trade.quantity - commission - open_trade.commission
            pnl_pct = pnl / (open_trade.entry_price * open_trade.quantity)
            open_trade.exit_price = last.close
            open_trade.exit_time = last.timestamp
            open_trade.pnl = pnl
            open_trade.pnl_pct = pnl_pct
            open_trade.commission += commission
            trades.append(open_trade)

        return trades

    def _build_equity_curve(self, trades: list[Trade], series: CandleSeries, config: BacktestConfig) -> list[dict]:
        equity = config.initial_capital
        curve = [{"timestamp": series.candles[0].timestamp.isoformat(), "equity": equity}]

        # Key by normalised UTC date string (YYYY-MM-DD) so timezone representation
        # differences between signal timestamps and candle timestamps never break lookup
        trade_pnl_by_date: dict[str, float] = {}
        for t in trades:
            if t.exit_time and t.pnl is not None:
                date_key = _to_utc(t.exit_time).strftime("%Y-%m-%d")
                trade_pnl_by_date[date_key] = trade_pnl_by_date.get(date_key, 0.0) + t.pnl

        for candle in series.candles[1:]:
            date_key = _to_utc(candle.timestamp).strftime("%Y-%m-%d")
            if date_key in trade_pnl_by_date:
                equity += trade_pnl_by_date[date_key]
            curve.append({"timestamp": candle.timestamp.isoformat(), "equity": round(equity, 2)})

        return curve

    def _calculate_metrics(self, trades: list[Trade], equity_curve: list[dict], config: BacktestConfig) -> dict:
        equities = [e["equity"] for e in equity_curve]
        returns = list(np.diff(equities) / np.array(equities[:-1])) if len(equities) > 1 else []

        completed = [t for t in trades if t.pnl is not None]
        winners   = [t for t in completed if t.pnl > 0]
        losers    = [t for t in completed if t.pnl <= 0]

        gross_profit = sum(t.pnl for t in winners) if winners else 0.0
        gross_loss   = sum(t.pnl for t in losers)  if losers  else 0.0

        total_return = (equities[-1] - equities[0]) / equities[0] if equities else 0.0
        trading_days = (config.end_date - config.start_date).days

        ann_return = calc_annualized_return(total_return, trading_days)
        max_dd     = calc_max_drawdown(equities)

        # avg_holding_days — only count trades that are fully closed
        closed_with_times = [t for t in completed if t.exit_time and t.entry_time]
        avg_holding = (
            float(np.mean([(t.exit_time - t.entry_time).days for t in closed_with_times]))
            if closed_with_times else 0.0
        )

        return {
            "total_return":      round(total_return, 6),
            "annualized_return": round(ann_return, 6),
            "sharpe_ratio":      round(_safe_float(calc_sharpe_ratio(returns)), 4),
            "sortino_ratio":     round(_safe_float(calc_sortino_ratio(returns)), 4),
            "max_drawdown":      round(max_dd, 6),
            "calmar_ratio":      round(_safe_float(calc_calmar_ratio(ann_return, max_dd)), 4),
            "win_rate":          round(len(winners) / len(completed), 4) if completed else 0.0,
            "profit_factor":     round(_safe_float(calc_profit_factor(gross_profit, gross_loss)), 4),
            "total_trades":      len(completed),
            "winning_trades":    len(winners),
            "losing_trades":     len(losers),
            "avg_win":           round(float(np.mean([t.pnl for t in winners])), 2) if winners else 0.0,
            "avg_loss":          round(float(np.mean([t.pnl for t in losers])), 2)  if losers  else 0.0,
            "best_trade":        round(max((t.pnl for t in completed), default=0.0), 2),
            "worst_trade":       round(min((t.pnl for t in completed), default=0.0), 2),
            "avg_holding_days":  round(avg_holding, 2),
            "volatility":        round(_safe_float(float(np.std(returns) * np.sqrt(252))), 6) if len(returns) > 1 else 0.0,
        }
