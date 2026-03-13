"""
AutoTrader Cycle API routes.

GET    /autotrader/cycles                       — list all cycles
POST   /autotrader/cycles                       — create a cycle
GET    /autotrader/cycles/{id}                  — get cycle detail
PATCH  /autotrader/cycles/{id}                  — update mutable fields
DELETE /autotrader/cycles/{id}                  — delete cycle
POST   /autotrader/cycles/{id}/start            — start (or resume) a cycle
POST   /autotrader/cycles/{id}/stop             — stop a running cycle
POST   /autotrader/cycles/{id}/run-now          — trigger an immediate run
GET    /autotrader/cycles/{id}/runs             — run history (last 20)
GET    /autotrader/cycles/{id}/performance      — aggregate performance stats + live P&L
"""
import logging
from collections import Counter
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.execution.alpaca_executor import AlpacaExecutor

from app.core.cycle_manager import cycle_manager

log = logging.getLogger(__name__)
router = APIRouter(prefix="/autotrader/cycles", tags=["AutoTrader Cycles"])


# ── Request / Response models ────────────────────────────────────────────────

class CreateCycleRequest(BaseModel):
    name: str = "AutoTrader Cycle"
    symbols: list[str]
    total_capital: float
    interval_minutes: int = 60
    lookback_days: int = 365
    auto_execute: bool = False
    dry_run: bool = True
    max_cycles: Optional[int] = None
    stop_loss_pct: Optional[float] = None
    stop_at: Optional[str] = None
    daily_loss_limit_pct: Optional[float] = None


class UpdateCycleRequest(BaseModel):
    name: Optional[str] = None
    symbols: Optional[list[str]] = None
    total_capital: Optional[float] = None
    interval_minutes: Optional[int] = None
    lookback_days: Optional[int] = None
    auto_execute: Optional[bool] = None
    dry_run: Optional[bool] = None
    max_cycles: Optional[int] = None
    stop_loss_pct: Optional[float] = None
    stop_at: Optional[str] = None
    daily_loss_limit_pct: Optional[float] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_cycles():
    """Return all cycles with their current runtime state."""
    cycles = cycle_manager.list_cycles()
    # Strip large last_result.items to keep list payload small
    out = []
    for c in cycles:
        summary = {k: v for k, v in c.items() if k not in ("last_result", "logs", "run_history")}
        lr = c.get("last_result")
        if lr:
            summary["last_result_summary"] = {
                "ran_at":            lr.get("ran_at"),
                "allocation_method": lr.get("allocation_method"),
                "portfolio_thesis":  lr.get("portfolio_thesis"),
                "item_count":        len(lr.get("items", [])),
            }
        out.append(summary)
    return {"cycles": out}


@router.post("")
async def create_cycle(req: CreateCycleRequest):
    """Create (but do not start) a new AutoTrader cycle."""
    if not req.symbols:
        raise HTTPException(status_code=400, detail="Provide at least one symbol.")
    if len(req.symbols) > 15:
        raise HTTPException(status_code=400, detail="Maximum 15 symbols per cycle.")
    if req.total_capital <= 0:
        raise HTTPException(status_code=400, detail="total_capital must be positive.")
    if req.interval_minutes < 1:
        raise HTTPException(status_code=400, detail="interval_minutes must be >= 1.")

    cycle = cycle_manager.create_cycle(
        name=req.name,
        symbols=req.symbols,
        total_capital=req.total_capital,
        interval_minutes=req.interval_minutes,
        lookback_days=req.lookback_days,
        auto_execute=req.auto_execute,
        dry_run=req.dry_run,
        max_cycles=req.max_cycles,
        stop_loss_pct=req.stop_loss_pct,
        stop_at=req.stop_at,
        daily_loss_limit_pct=req.daily_loss_limit_pct,
    )
    return cycle


@router.get("/{cycle_id}")
async def get_cycle(cycle_id: str):
    """Return full cycle detail including logs and last_result."""
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    return cycle


@router.patch("/{cycle_id}")
async def update_cycle(cycle_id: str, req: UpdateCycleRequest):
    """Update mutable cycle fields. Cycle must not be running."""
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    if cycle["status"] == "running":
        raise HTTPException(status_code=409, detail="Stop the cycle before editing it.")

    updates = req.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided.")

    updated = cycle_manager.update_cycle(cycle_id, updates)
    return updated


@router.delete("/{cycle_id}")
async def delete_cycle(cycle_id: str):
    """Stop and permanently delete a cycle."""
    ok = cycle_manager.delete_cycle(cycle_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    return {"deleted": cycle_id}


@router.post("/{cycle_id}/start")
async def start_cycle(cycle_id: str):
    """Start (or resume) a cycle. Runs the funnel immediately, then on schedule."""
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    ok = cycle_manager.start_cycle(cycle_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Could not start cycle.")
    return {"status": "started", "cycle_id": cycle_id}


@router.post("/{cycle_id}/stop")
async def stop_cycle(cycle_id: str):
    """Stop a running cycle."""
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    cycle_manager.stop_cycle(cycle_id, reason="manual stop via API")
    return {"status": "stopped", "cycle_id": cycle_id}


@router.post("/{cycle_id}/run-now")
async def run_now(cycle_id: str):
    """Trigger an immediate run of the cycle (skips the sleep timer)."""
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    ok = cycle_manager.trigger_now(cycle_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Could not trigger cycle.")
    return {"status": "triggered", "cycle_id": cycle_id}


@router.get("/{cycle_id}/logs")
async def get_logs(cycle_id: str):
    """Return the log buffer for a cycle."""
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    return {"cycle_id": cycle_id, "logs": cycle.get("logs", [])}


@router.get("/{cycle_id}/runs")
async def get_cycle_runs(cycle_id: str):
    """Return the run history (last 20 runs) for a cycle."""
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    return {"cycle_id": cycle_id, "runs": cycle.get("run_history", [])}


@router.get("/{cycle_id}/performance")
async def get_cycle_performance(cycle_id: str):
    """
    Aggregate performance stats across all stored runs, plus live P&L from Alpaca.

    Returns:
      - run_stats: total runs, AI vs sharpe split, capital deployed, avg sharpe, top symbols/strategies
      - live_account: equity, buying_power, portfolio_value from Alpaca
      - live_positions: unrealized P&L per symbol (filtered to this cycle's symbols)
    """
    cycle = cycle_manager.get_cycle(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found.")

    run_history: list[dict] = cycle.get("run_history", [])
    cycle_symbols: set[str] = {s.upper() for s in cycle.get("symbols", [])}

    # ── Aggregate run stats ──────────────────────────────────────────────────
    total_runs        = len(run_history)
    ai_runs           = sum(1 for r in run_history if r.get("allocation_method") == "ai")
    sharpe_runs       = total_runs - ai_runs
    total_capital_deployed = 0.0
    all_sharpes: list[float] = []
    symbol_counter: Counter = Counter()
    strategy_counter: Counter = Counter()

    for run in run_history:
        run_sharpes: list[float] = []
        for item in run.get("items", []):
            cap = item.get("capital")
            if cap is not None:
                total_capital_deployed += float(cap)
            sh = item.get("sharpe_ratio")
            if sh is not None:
                run_sharpes.append(float(sh))
            sym = item.get("symbol")
            if sym:
                symbol_counter[sym] += 1
            strat = item.get("best_strategy")
            if strat:
                strategy_counter[strat] += 1
        if run_sharpes:
            all_sharpes.append(sum(run_sharpes) / len(run_sharpes))

    avg_sharpe   = round(sum(all_sharpes) / len(all_sharpes), 3) if all_sharpes else None
    top_symbols  = [s for s, _ in symbol_counter.most_common(10)]
    top_strategies = [s for s, _ in strategy_counter.most_common(5)]
    symbol_freq    = dict(symbol_counter.most_common(10))
    strategy_freq  = dict(strategy_counter.most_common(10))

    run_stats = {
        "total_runs":             total_runs,
        "ai_runs":                ai_runs,
        "sharpe_runs":            sharpe_runs,
        "ai_pct":                 round(ai_runs / total_runs * 100, 1) if total_runs else 0,
        "total_capital_deployed": round(total_capital_deployed, 2),
        "avg_sharpe_per_run":     avg_sharpe,
        "top_symbols":            top_symbols,
        "top_strategies":         top_strategies,
        "symbol_frequency":       symbol_freq,
        "strategy_frequency":     strategy_freq,
        "runs_completed":         cycle.get("runs_completed", 0),
        "auto_execute":           cycle.get("auto_execute", False),
        "dry_run":                cycle.get("dry_run", True),
        "total_capital":          cycle.get("total_capital", 0),
    }

    # ── Live Alpaca data ─────────────────────────────────────────────────────
    live_account   = None
    live_positions = []
    executor = AlpacaExecutor()
    try:
        acct = await executor.get_account()
        live_account = {
            "equity":          float(acct.get("equity", 0)),
            "last_equity":     float(acct.get("last_equity", 0)),
            "portfolio_value": float(acct.get("portfolio_value", 0)),
            "buying_power":    float(acct.get("buying_power", 0)),
            "cash":            float(acct.get("cash", 0)),
            "day_pnl":         round(float(acct.get("equity", 0)) - float(acct.get("last_equity", 0)), 2),
        }
    except Exception as exc:
        log.warning("performance: could not fetch account: %s", exc)

    try:
        positions = await executor.get_positions()
        for pos in positions:
            sym = (pos.get("symbol") or "").upper()
            live_positions.append({
                "symbol":          sym,
                "qty":             float(pos.get("qty", 0)),
                "side":            pos.get("side", "long"),
                "avg_entry_price": float(pos.get("avg_entry_price", 0)),
                "current_price":   float(pos.get("current_price", 0)),
                "market_value":    float(pos.get("market_value", 0)),
                "cost_basis":      float(pos.get("cost_basis", 0)),
                "unrealized_pl":   float(pos.get("unrealized_pl", 0)),
                "unrealized_plpc": float(pos.get("unrealized_plpc", 0)),
                "in_cycle":        sym in cycle_symbols,
            })
    except Exception as exc:
        log.warning("performance: could not fetch positions: %s", exc)

    total_unrealized_pl = round(sum(p["unrealized_pl"] for p in live_positions), 2)

    return {
        "cycle_id":           cycle_id,
        "cycle_name":         cycle.get("name", ""),
        "run_stats":          run_stats,
        "live_account":       live_account,
        "live_positions":     live_positions,
        "total_unrealized_pl":total_unrealized_pl,
    }
