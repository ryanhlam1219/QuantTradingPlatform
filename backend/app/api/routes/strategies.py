from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.models.candlestick import TimeFrame, AssetClass, Broker
from app.models.trade import TradeSignal
from app.strategies.registry import get_strategy, list_strategies

router = APIRouter(prefix="/strategies", tags=["strategies"])


class SignalRequest(BaseModel):
    symbol: str
    broker: Broker = Broker.ALPACA
    asset_class: AssetClass = AssetClass.STOCK
    timeframe: TimeFrame = TimeFrame.ONE_DAY
    start: datetime
    end: datetime
    strategy_params: dict = {}


@router.get("/")
async def list_all_strategies():
    """Return metadata and default params for all available strategies."""
    return list_strategies()


@router.get("/{strategy_name}")
async def get_strategy_info(strategy_name: str):
    """Return metadata for a single strategy."""
    try:
        return get_strategy(strategy_name).to_info_dict()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{strategy_name}/signals", response_model=list[TradeSignal])
async def generate_signals(strategy_name: str, req: SignalRequest):
    """
    Run a strategy on historical data and return the generated signals.
    Useful for previewing strategy behaviour before running a full backtest.
    """
    from app.api.routes.candlesticks import _get_broker
    try:
        strategy = get_strategy(strategy_name, params=req.strategy_params)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    broker = _get_broker(req.broker)
    try:
        series = await broker.get_candles(
            symbol=req.symbol.upper(),
            timeframe=req.timeframe,
            start=req.start,
            end=req.end,
            asset_class=req.asset_class,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return strategy.generate_signals(series)
