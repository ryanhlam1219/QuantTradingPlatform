"""
Unified candlestick (OHLCV) model.
All brokers normalize their data into this schema.
"""
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum
from typing import Optional


class AssetClass(str, Enum):
    STOCK = "stock"
    CRYPTO = "crypto"
    ETF = "etf"
    FOREX = "forex"


class Timeframe(str, Enum):
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"
    W1 = "1w"


class Broker(str, Enum):
    ALPACA = "alpaca"
    KRAKEN = "kraken"
    BINANCE_US = "binance_us"
    FIDELITY = "fidelity"
    MOCK = "mock"


class Candle(BaseModel):
    """Unified OHLCV candle — broker-agnostic."""
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    timestamp: datetime
    timeframe: Timeframe
    broker: Broker
    asset_class: AssetClass
    vwap: Optional[float] = None         # Volume-weighted average price
    trade_count: Optional[int] = None    # Number of trades in period

    class Config:
        use_enum_values = True

    @property
    def is_bullish(self) -> bool:
        return self.close >= self.open

    @property
    def body_size(self) -> float:
        return abs(self.close - self.open)

    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low

    @property
    def range(self) -> float:
        return self.high - self.low


class CandleSeries(BaseModel):
    """A time-ordered list of candles for a given symbol."""
    symbol: str
    timeframe: Timeframe
    broker: Broker
    candles: list[Candle]

    @property
    def closes(self) -> list[float]:
        return [c.close for c in self.candles]

    @property
    def opens(self) -> list[float]:
        return [c.open for c in self.candles]

    @property
    def highs(self) -> list[float]:
        return [c.high for c in self.candles]

    @property
    def lows(self) -> list[float]:
        return [c.low for c in self.candles]

    @property
    def volumes(self) -> list[float]:
        return [c.volume for c in self.candles]

    @property
    def timestamps(self) -> list[datetime]:
        return [c.timestamp for c in self.candles]
