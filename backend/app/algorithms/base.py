"""Abstract base class for all trading strategies."""
from abc import ABC, abstractmethod
from app.models.candlestick import CandleSeries
from app.models.signal import Signal


class BaseStrategy(ABC):
    name: str = "base"
    description: str = ""
    default_params: dict = {}

    def __init__(self, params: dict = None):
        self.params = {**self.default_params, **(params or {})}

    @abstractmethod
    def generate_signals(self, series: CandleSeries) -> list[Signal]:
        """Analyze candle data and return buy/sell/hold signals."""
        ...

    @abstractmethod
    def describe(self) -> dict:
        """Return human-readable description of the strategy."""
        ...
