from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from app.models.candlestick import Timeframe, Broker
from app.models.signal import Signal


class BacktestConfig(BaseModel):
    symbol: str
    strategy: str
    start_date: datetime
    end_date: datetime
    initial_capital: float = 10_000.0
    timeframe: Timeframe = Timeframe.D1
    broker: Broker = Broker.ALPACA
    strategy_params: dict = {}
    commission: float = 0.0          # Per-trade commission
    slippage: float = 0.001          # 0.1% slippage


class Trade(BaseModel):
    symbol: str
    entry_price: float
    exit_price: Optional[float] = None
    entry_time: datetime
    exit_time: Optional[datetime] = None
    quantity: float
    direction: str  # "long" or "short"
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    commission: float = 0.0


class BacktestResult(BaseModel):
    config: BacktestConfig
    trades: list[Trade]
    signals: list[Signal]
    equity_curve: list[dict]          # [{timestamp, equity}]

    # Performance metrics
    total_return: float               # e.g. 0.25 = 25%
    annualized_return: float
    sharpe_ratio: float
    max_drawdown: float               # e.g. -0.15 = -15%
    win_rate: float                   # e.g. 0.6 = 60%
    profit_factor: float              # gross profit / gross loss
    total_trades: int
    winning_trades: int
    losing_trades: int
    avg_win: float
    avg_loss: float
    best_trade: float
    worst_trade: float
    avg_holding_days: float
    volatility: float                 # Annualized std of returns
    calmar_ratio: float               # annualized return / max drawdown
    sortino_ratio: float
    benchmark_return: Optional[float] = None  # e.g. SPY return same period
    alpha: Optional[float] = None
    beta: Optional[float] = None
