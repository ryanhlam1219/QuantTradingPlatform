from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class OrderSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class OrderStatus(str, Enum):
    PENDING = "pending"
    FILLED = "filled"
    PARTIALLY_FILLED = "partially_filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    EXPIRED = "expired"


class TimeInForce(str, Enum):
    DAY = "day"
    GTC = "gtc"       # Good Till Cancelled
    IOC = "ioc"       # Immediate or Cancel
    FOK = "fok"       # Fill or Kill


class TradeSignal(BaseModel):
    """Signal emitted by a strategy — not yet an order."""
    symbol: str
    side: OrderSide
    strategy_name: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict = Field(default_factory=dict)


class Order(BaseModel):
    """A trade order submitted to a broker."""
    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: float = Field(..., gt=0)
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    time_in_force: TimeInForce = TimeInForce.DAY
    strategy_name: str = ""
    paper: bool = True


class OrderResult(BaseModel):
    """Broker response after submitting an order."""
    broker_order_id: str
    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: float
    filled_quantity: float = 0.0
    fill_price: Optional[float] = None
    status: OrderStatus
    submitted_at: datetime
    filled_at: Optional[datetime] = None
    paper: bool = True


class Position(BaseModel):
    """Current open position in an asset."""
    symbol: str
    quantity: float
    avg_entry_price: float
    current_price: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    market_value: float
    paper: bool = True
