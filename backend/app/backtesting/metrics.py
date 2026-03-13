"""Performance metrics calculations for backtesting."""
import numpy as np
from typing import Optional


def calc_sharpe_ratio(returns: list[float], risk_free_rate: float = 0.04) -> float:
    if len(returns) < 2:
        return 0.0
    arr = np.array(returns)
    daily_rf = risk_free_rate / 252
    excess = arr - daily_rf
    if excess.std() == 0:
        return 0.0
    return float(np.sqrt(252) * excess.mean() / excess.std())


def calc_sortino_ratio(returns: list[float], risk_free_rate: float = 0.04) -> float:
    if len(returns) < 2:
        return 0.0
    arr = np.array(returns)
    daily_rf = risk_free_rate / 252
    excess = arr - daily_rf
    downside = arr[arr < 0]
    if len(downside) == 0 or downside.std() == 0:
        return float("inf") if excess.mean() > 0 else 0.0
    return float(np.sqrt(252) * excess.mean() / downside.std())


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
    if max_drawdown == 0:
        return float("inf") if annualized_return > 0 else 0.0
    return float(annualized_return / abs(max_drawdown))


def calc_profit_factor(gross_profit: float, gross_loss: float) -> float:
    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0
    return float(gross_profit / abs(gross_loss))
