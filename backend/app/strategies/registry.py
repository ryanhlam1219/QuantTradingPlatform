"""
Strategy registry.

All strategies are registered here. The API and backtesting engine
look up strategies by name from this registry.
"""
from typing import Optional
from app.strategies.base import BaseStrategy
from app.strategies.moving_average import MovingAverageCrossoverStrategy
from app.strategies.rsi import RSIStrategy
from app.strategies.bollinger_bands import BollingerBandsStrategy
from app.strategies.macd import MACDStrategy
from app.strategies.grid_trading import GridTradingStrategy

_REGISTRY: dict[str, type[BaseStrategy]] = {
    "moving_average_crossover": MovingAverageCrossoverStrategy,
    "rsi":                      RSIStrategy,
    "bollinger_bands":          BollingerBandsStrategy,
    "macd":                     MACDStrategy,
    "grid_trading":             GridTradingStrategy,
}


def get_strategy(name: str, params: Optional[dict] = None) -> BaseStrategy:
    """Instantiate a strategy by name with optional params."""
    cls = _REGISTRY.get(name)
    if cls is None:
        raise ValueError(f"Unknown strategy '{name}'. Available: {list(_REGISTRY)}")
    return cls(params=params)


def list_strategies() -> list[dict]:
    """Return metadata for all registered strategies."""
    return [cls().to_info_dict() for cls in _REGISTRY.values()]
