"""
Abstract base class for all broker integrations.
Any new broker must implement this interface.
"""
from abc import ABC, abstractmethod
from datetime import datetime
from app.models.candlestick import CandleSeries, Timeframe


class BaseBroker(ABC):
    """Broker-agnostic interface for fetching market data."""

    @abstractmethod
    async def get_candles(
        self,
        symbol: str,
        timeframe: Timeframe,
        start: datetime,
        end: datetime,
        limit: int = 1000,
    ) -> CandleSeries:
        """Fetch OHLCV candles for a symbol."""
        ...

    @abstractmethod
    async def get_latest_candle(self, symbol: str, timeframe: Timeframe) -> CandleSeries:
        """Fetch the most recent candle."""
        ...

    @abstractmethod
    async def get_symbols(self) -> list[str]:
        """Return all tradeable symbols for this broker."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Ping the broker API. Returns True if reachable."""
        ...
