"""Performance metrics calculations for backtesting."""
import numpy as np
from typing import Optional


def calc_sharpe_ratio(returns: list[float], risk_free_rate: float = 0.04) -> float:
    if len(returns) < 2:
        return 0.0
    arr = np.array(returns)
    daily_rf = risk_free_rate / 252
    excess = arr - daily_rf
    std_dev = excess.std()
    # Use tolerance instead of exact 0 check (floating point precision)
    if std_dev < 1e-10:
        return 0.0
    sharpe = float(np.sqrt(252) * excess.mean() / std_dev)
    # Cap to ±10 to prevent extreme outliers from near-zero volatility
    return max(-10.0, min(10.0, sharpe))


def calc_sortino_ratio(returns: list[float], risk_free_rate: float = 0.04) -> float:
    if len(returns) < 2:
        return 0.0
    arr = np.array(returns)
    daily_rf = risk_free_rate / 252
    excess = arr - daily_rf
    downside = arr[arr < daily_rf]
    if len(downside) == 0:
        # No negative returns — return 0 instead of inf
        return 0.0
    downside_std = downside.std()
    if downside_std < 1e-10:
        return 0.0
    sortino = float(np.sqrt(252) * excess.mean() / downside_std)
    # Cap to ±10
    return max(-10.0, min(10.0, sortino))


def calc_max_drawdown(equity_curve: list[float]) -> float:
    if not equity_curve:
        return 0.0
    arr = np.array(equity_curve)
    peak = np.maximum.accumulate(arr)
    drawdown = (arr - peak) / peak
    return float(drawdown.min())


def calc_annualized_return(total_return: float, trading_days: int) -> float:
    if trading_days <= 0:
        return 0.0
    years = trading_days / 252
    return float((1 + total_return) ** (1 / years) - 1) if years > 0 else 0.0


def calc_calmar_ratio(annualized_return: float, max_drawdown: float) -> float:
    if abs(max_drawdown) < 1e-10:
        return 0.0
    calmar = float(annualized_return / abs(max_drawdown))
    # Cap to ±10
    return max(-10.0, min(10.0, calmar))


def calc_profit_factor(gross_profit: float, gross_loss: float) -> float:
    if abs(gross_loss) < 1e-10:
        return 0.0
    pf = float(gross_profit / abs(gross_loss))
    # Cap to ±10
    return max(-10.0, min(10.0, pf))
