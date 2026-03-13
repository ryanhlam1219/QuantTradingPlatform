"""
AutoTrader API routes.

POST /autotrader/analyze         — run full research + LLM allocation pipeline
POST /autotrader/execute         — execute an approved autotrader plan
POST /autotrader/backtest        — walk-forward cycle backtest
"""
import asyncio
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.autotrader import run_autotrader
from app.services.cycle_backtest import run_cycle_backtest
from app.executor.alpaca_executor import AlpacaExecutor
from app.config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/autotrader", tags=["AutoTrader"])
_executor = AlpacaExecutor()


class AnalyzeRequest(BaseModel):
    symbols: list[str]
    total_capital: float


class ExecuteItem(BaseModel):
    symbol: str
    strategy: Optional[str] = None
    shares: int
    side: str = "buy"
    notional: Optional[float] = None   # pre-computed capital for buying power check


class ExecuteRequest(BaseModel):
    items: list[ExecuteItem]
    dry_run: bool = False


@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    """
    Run the full AutoTrader funnel:
      research → LLM capital allocation → backtest metrics → execution plan.
    """
    if not req.symbols:
        raise HTTPException(status_code=400, detail="Provide at least one symbol.")
    if len(req.symbols) > 15:
        raise HTTPException(status_code=400, detail="Maximum 15 symbols per AutoTrader run.")
    if req.total_capital <= 0:
        raise HTTPException(status_code=400, detail="total_capital must be positive.")

    result = await run_autotrader(
        symbols=[s.strip().upper() for s in req.symbols if s.strip()],
        total_capital=req.total_capital,
    )
    if result.get("error") and not result.get("items"):
        raise HTTPException(status_code=502, detail=result["error"])
    return result


@router.post("/execute")
async def execute(req: ExecuteRequest):
    """
    Execute an approved AutoTrader plan.
    Pass dry_run=true to simulate without placing real orders.
    """
    if not req.items:
        raise HTTPException(status_code=400, detail="No items to execute.")

    # ── Buying power pre-flight check ────────────────────────────────────────
    if not req.dry_run:
        buy_notional = sum(
            item.notional for item in req.items
            if item.side == "buy" and item.notional is not None
        )
        if buy_notional > 0:
            try:
                account = await _executor.get_account()
                buying_power = float(account.get("buying_power", 0))
                if buy_notional > buying_power:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Insufficient buying power. Required: ${buy_notional:,.2f} — "
                            f"Available: ${buying_power:,.2f}. "
                            f"Reduce your capital budget or deselect some positions."
                        ),
                    )
            except HTTPException:
                raise
            except Exception as e:
                log.warning("Could not fetch buying power for pre-check: %s", e)

    sem = asyncio.Semaphore(5)

    async def place(item: ExecuteItem) -> dict:
        async with sem:
            out = {"symbol": item.symbol, "shares": item.shares, "side": item.side, "strategy": item.strategy}
            if req.dry_run:
                out.update({"success": True, "dry_run": True, "order_result": {"status": "simulated"}})
                return out
            try:
                order = await _executor.place_order(
                    symbol=item.symbol.upper(),
                    qty=item.shares,
                    side=item.side,
                    order_type="market",
                    time_in_force="day",
                )
                out.update({"success": True, "order_result": order})
            except Exception as e:
                err_str = str(e)
                if "403" in err_str:
                    err_str = "Insufficient buying power for this order (Alpaca 403)."
                log.error("AutoTrader order failed %s: %s", item.symbol, e)
                out.update({"success": False, "error": err_str, "order_result": None})
            return out

    results = await asyncio.gather(*[place(item) for item in req.items])
    return {
        "results":       list(results),
        "paper_trading": settings.paper_trading,
        "dry_run":       req.dry_run,
    }


class CycleBacktestRequest(BaseModel):
    symbols: list[str]
    total_capital: float
    rebalance_every_days: int = 7
    total_days: int = 365
    lookback_days: int = 90


@router.post("/backtest")
async def cycle_backtest(req: CycleBacktestRequest):
    """
    Walk-forward cycle backtest.
    Simulates a periodic-rebalancing portfolio over historical data using
    Sharpe-weighted allocation, with no look-ahead bias.
    Returns an equity curve, per-rebalance events, and aggregate metrics
    compared to an equal-weight buy-and-hold benchmark.
    """
    if not req.symbols:
        raise HTTPException(status_code=400, detail="Provide at least one symbol.")
    if len(req.symbols) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 symbols for backtest.")
    if req.total_capital <= 0:
        raise HTTPException(status_code=400, detail="total_capital must be positive.")
    if req.total_days < 30:
        raise HTTPException(status_code=400, detail="total_days must be >= 30.")
    if req.lookback_days < 10:
        raise HTTPException(status_code=400, detail="lookback_days must be >= 10.")

    result = await run_cycle_backtest(
        symbols=[s.strip().upper() for s in req.symbols if s.strip()],
        total_capital=req.total_capital,
        rebalance_every_days=req.rebalance_every_days,
        total_days=req.total_days,
        lookback_days=req.lookback_days,
    )
    if result.get("error") and not result.get("equity_curve"):
        raise HTTPException(status_code=502, detail=result["error"])
    return result
