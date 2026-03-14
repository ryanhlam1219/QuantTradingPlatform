from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging
from app.execution.alpaca_executor import AlpacaExecutor
from app.brokers.alpaca import AlpacaBroker
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trades", tags=["Trades"])
executor = AlpacaExecutor()
broker = AlpacaBroker()


class OrderRequest(BaseModel):
    symbol: str
    qty: float
    side: str   # "buy" or "sell"
    order_type: str = "market"
    time_in_force: str = "day"
    limit_price: Optional[float] = None


@router.get("/account")
async def get_account():
    """Get current Alpaca account info."""
    try:
        return await executor.get_account()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/positions")
async def get_positions():
    """Get all current open positions."""
    try:
        return await executor.get_positions()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/orders")
async def get_orders(status: str = "open"):
    """List orders by status: open, closed, all."""
    try:
        return await executor.get_orders(status)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/order")
async def place_order(order: OrderRequest):
    """Place a buy or sell order. Paper trading mode is controlled by config."""
    if order.side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be 'buy' or 'sell'")
    
    # Validate symbol exists before placing order
    symbol = order.symbol.upper()
    logger.info(f"Placing order: {order.side.upper()} {order.qty} {symbol} (type: {order.order_type})")
    
    validation = await broker.validate_symbol(symbol)
    if not validation["valid"]:
        logger.warning(f"Symbol validation failed for {symbol}: {validation.get('reason')}")
        raise HTTPException(status_code=400, detail=f"Invalid symbol: {validation.get('reason', symbol)}")
    
    try:
        logger.debug(f"Executing order through executor for {symbol}")
        result = await executor.place_order(
            symbol=symbol,
            qty=order.qty, side=order.side,
            order_type=order.order_type,
            time_in_force=order.time_in_force,
            limit_price=order.limit_price,
        )
        logger.info(f"Order successful: {order.side.upper()} {order.qty} {symbol} | ID: {result.get('id')}")
        return {"order": result, "paper_trading": settings.paper_trading}
    except Exception as e:
        logger.error(f"Order failed for {symbol}: {str(e)}")
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/order/{order_id}")
async def cancel_order(order_id: str):
    """Cancel an open order."""
    try:
        ok = await executor.cancel_order(order_id)
        return {"cancelled": ok, "order_id": order_id}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/positions/{symbol}")
async def close_position(symbol: str):
    """Close an open position."""
    try:
        return await executor.close_position(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/validate-symbol/{symbol}")
async def validate_symbol(symbol: str):
    """Validate if a symbol is valid and tradeable."""
    try:
        validation = await broker.validate_symbol(symbol.upper())
        if not validation["valid"]:
            return {"valid": False, "symbol": symbol.upper(), "reason": validation.get("reason")}
        return {
            "valid": True,
            "symbol": validation.get("symbol"),
            "exchange": validation.get("exchange"),
            "asset_class": validation.get("class"),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
