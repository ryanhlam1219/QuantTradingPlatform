"""
Abstract trading strategy interface.

All strategies must inherit from BaseStrategy and implement `generate_signals`.
Strategies are stateless — they receive a CandleSeries and return signals.
"""
from abc import ABC, abstractmethod
from typing import Any

from app.models.candlestick import CandleSeries
from app.models.trade import TradeSignal


class StrategyConfig(dict):
    """Typed wrapper around strategy parameter dict."""
    pass


class BaseStrategy(ABC):

    def __init__(self, params: dict[str, Any] | None = None):
        self.params = params or {}
        self._validate_params()

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique strategy identifier."""
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        """Plain-English explanation of the strategy logic."""
        ...

    @property
    @abstractmethod
    def default_params(self) -> dict[str, Any]:
        """Default parameter values — shown in the UI."""
        ...

    @property
    @abstractmethod
    def param_schema(self) -> dict[str, dict]:
        """
        JSON-schema-like metadata for each param.
        Used by the frontend to render config panels.
        Example:
          {
            "fast_period": {"type": "int", "min": 2, "max": 50, "default": 10},
            "slow_period": {"type": "int", "min": 5, "max": 200, "default": 30},
          }
        """
        ...

    def _validate_params(self):
        """Apply defaults for any missing params."""
        for key, val in self.default_params.items():
            self.params.setdefault(key, val)

    @abstractmethod
    def generate_signals(self, series: CandleSeries) -> list[TradeSignal]:
        """
        Analyse a CandleSeries and return buy/sell signals.

        Signals are ordered by timestamp ascending.
        Returns an empty list if there is insufficient data.
        """
        ...

    def to_info_dict(self) -> dict:
        """Serialise strategy metadata for the API."""
        return {
            "name": self.name,
            "description": self.description,
            "default_params": self.default_params,
            "param_schema": self.param_schema,
            "current_params": self.params,
        }
