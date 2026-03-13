from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum
from typing import Optional


class SignalType(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


class Signal(BaseModel):
    symbol: str
    signal_type: SignalType
    price: float
    timestamp: datetime
    strategy: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metadata: dict = {}

    class Config:
        use_enum_values = True
