"""
AutoTrader Cycle Manager.

Manages one or more persistent AutoTrader "cycles" that run on a recurring schedule.
Each cycle handles its own symbol list, capital, stop conditions, and last-run state.

Architecture:
  - CycleManager is a singleton started with the FastAPI lifespan.
  - Each active cycle has an asyncio.Task that sleeps until the next interval,
    then runs the full AutoTrader funnel and executes approved orders automatically.
  - State is persisted to a JSON file so restarts survive.
  - SSE (Server-Sent Events) endpoint allows the frontend to stream live logs.

Stop conditions (any can be configured per cycle):
  - max_cycles: stop after N completed runs
  - stop_loss_pct: stop if portfolio unrealised P&L drops below -X%
  - stop_at:  ISO 8601 datetime after which the cycle will not execute
  - daily_loss_limit_pct: stop if today's net P&L < -X% of capital
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from app.services.autotrader import run_autotrader
from app.executor.alpaca_executor import AlpacaExecutor

log = logging.getLogger(__name__)

STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "cycle_state.json")
STATE_FILE = os.path.normpath(STATE_FILE)

MAX_LOG_LINES = 200   # per cycle


# ── Data models (plain dicts, no pydantic dep inside the service) ─────────────

def _new_cycle(
    name: str,
    symbols: list[str],
    total_capital: float,
    interval_minutes: int,
    auto_execute: bool,
    dry_run: bool,
    max_cycles: Optional[int],
    stop_loss_pct: Optional[float],
    stop_at: Optional[str],
    daily_loss_limit_pct: Optional[float],
    lookback_days: int = 365,
) -> dict:
    return {
        "id":                    str(uuid4()),
        "name":                  name,
        "symbols":               [s.upper().strip() for s in symbols],
        "total_capital":         total_capital,
        "interval_minutes":      max(1, interval_minutes),
        "auto_execute":          auto_execute,
        "dry_run":               dry_run,
        "max_cycles":            max_cycles,
        "stop_loss_pct":         stop_loss_pct,
        "stop_at":               stop_at,
        "daily_loss_limit_pct":  daily_loss_limit_pct,
        "lookback_days":         max(90, min(lookback_days, 1825)),
        # runtime state
        "status":                "idle",   # idle | running | stopped | error
        "runs_completed":        0,
        "last_run_at":           None,
        "next_run_at":           None,
        "stop_reason":           None,
        "last_result":           None,
        "run_history":           [],
        "logs":                  [],
        "created_at":            datetime.now(timezone.utc).isoformat(),
    }


# ── Singleton ────────────────────────────────────────────────────────────────

class CycleManager:
    def __init__(self):
        self._cycles: dict[str, dict] = {}     # id → cycle dict
        self._tasks:  dict[str, asyncio.Task] = {}
        self._executor = AlpacaExecutor()
        self._load_state()

    # ── Persistence ──────────────────────────────────────────────────────────

    def _load_state(self):
        try:
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, "r") as f:
                    data = json.load(f)
                for cycle in data.get("cycles", []):
                    # Reset running cycles to idle on restart
                    if cycle["status"] == "running":
                        cycle["status"] = "idle"
                        cycle["next_run_at"] = None
                    self._cycles[cycle["id"]] = cycle
                log.info("CycleManager: loaded %d cycles from state", len(self._cycles))
        except Exception as e:
            log.warning("CycleManager: could not load state: %s", e)

    def _save_state(self):
        try:
            with open(STATE_FILE, "w") as f:
                json.dump({"cycles": list(self._cycles.values())}, f, indent=2, default=str)
        except Exception as e:
            log.warning("CycleManager: could not save state: %s", e)

    # ── Logging within a cycle ────────────────────────────────────────────────

    def _log(self, cycle_id: str, level: str, msg: str):
        ts = datetime.now(timezone.utc).isoformat()
        entry = {"ts": ts, "level": level, "msg": msg}
        cycle = self._cycles.get(cycle_id)
        if cycle is not None:
            cycle["logs"].append(entry)
            if len(cycle["logs"]) > MAX_LOG_LINES:
                cycle["logs"] = cycle["logs"][-MAX_LOG_LINES:]
        log.info("Cycle[%s] %s %s", cycle_id[:8], level.upper(), msg)

    # ── Public CRUD ───────────────────────────────────────────────────────────

    def list_cycles(self) -> list[dict]:
        return list(self._cycles.values())

    def get_cycle(self, cycle_id: str) -> Optional[dict]:
        return self._cycles.get(cycle_id)

    def create_cycle(self, **kwargs) -> dict:
        cycle = _new_cycle(**kwargs)
        self._cycles[cycle["id"]] = cycle
        self._save_state()
        log.info("CycleManager: created cycle %s (%s)", cycle["id"][:8], cycle["name"])
        return cycle

    def update_cycle(self, cycle_id: str, updates: dict) -> Optional[dict]:
        """Update mutable fields (symbols, capital, interval, stop conditions, name)."""
        cycle = self._cycles.get(cycle_id)
        if cycle is None:
            return None
        MUTABLE = {
            "name", "symbols", "total_capital", "interval_minutes",
            "auto_execute", "dry_run", "max_cycles", "stop_loss_pct",
            "stop_at", "daily_loss_limit_pct", "lookback_days",
        }
        for k, v in updates.items():
            if k in MUTABLE:
                if k == "symbols":
                    v = [s.upper().strip() for s in v]
                cycle[k] = v
        self._save_state()
        return cycle

    def delete_cycle(self, cycle_id: str) -> bool:
        if cycle_id not in self._cycles:
            return False
        self._stop_task(cycle_id)
        del self._cycles[cycle_id]
        self._save_state()
        return True

    # ── Start / Stop ─────────────────────────────────────────────────────────

    def start_cycle(self, cycle_id: str) -> bool:
        cycle = self._cycles.get(cycle_id)
        if cycle is None:
            return False
        if cycle["status"] == "running":
            return True  # Already running
        cycle["status"] = "running"
        cycle["stop_reason"] = None
        self._save_state()
        # Schedule: run immediately on first start, then repeat every interval
        task = asyncio.create_task(self._cycle_loop(cycle_id))
        self._tasks[cycle_id] = task
        task.add_done_callback(lambda t: self._on_task_done(cycle_id, t))
        return True

    def stop_cycle(self, cycle_id: str, reason: str = "manual stop") -> bool:
        cycle = self._cycles.get(cycle_id)
        if cycle is None:
            return False
        self._stop_task(cycle_id)
        cycle["status"] = "stopped"
        cycle["stop_reason"] = reason
        cycle["next_run_at"] = None
        self._log(cycle_id, "info", f"Cycle stopped: {reason}")
        self._save_state()
        return True

    def trigger_now(self, cycle_id: str) -> bool:
        """Immediately cancel the current sleep and run the funnel now."""
        cycle = self._cycles.get(cycle_id)
        if cycle is None:
            return False
        # If already running the cycle body, don't double-run; just reschedule
        if cycle["status"] != "running":
            # Start it (will run immediately)
            cycle["status"] = "running"
            cycle["stop_reason"] = None
        self._stop_task(cycle_id)  # cancel existing sleep task
        task = asyncio.create_task(self._cycle_loop(cycle_id, run_immediately=True))
        self._tasks[cycle_id] = task
        task.add_done_callback(lambda t: self._on_task_done(cycle_id, t))
        self._save_state()
        return True

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _stop_task(self, cycle_id: str):
        task = self._tasks.pop(cycle_id, None)
        if task and not task.done():
            task.cancel()

    def _on_task_done(self, cycle_id: str, task: asyncio.Task):
        """Callback for unexpected task termination (exceptions, external cancel)."""
        self._tasks.pop(cycle_id, None)
        try:
            exc = task.exception()
            if exc is not None:
                cycle = self._cycles.get(cycle_id)
                if cycle:
                    cycle["status"] = "error"
                    cycle["stop_reason"] = str(exc)
                    self._log(cycle_id, "error", f"Task crashed: {exc}")
                    self._save_state()
        except (asyncio.CancelledError, asyncio.InvalidStateError):
            pass

    async def _cycle_loop(self, cycle_id: str, run_immediately: bool = True):
        """
        Main loop for a single cycle.
        Runs immediately on first call, then sleeps `interval_minutes` between runs.
        """
        cycle = self._cycles.get(cycle_id)
        if cycle is None:
            return

        if not run_immediately:
            sleep_secs = cycle["interval_minutes"] * 60
            wake_at = datetime.now(timezone.utc).timestamp() + sleep_secs
            cycle["next_run_at"] = datetime.fromtimestamp(wake_at, tz=timezone.utc).isoformat()
            self._save_state()
            self._log(cycle_id, "info", f"Sleeping {cycle['interval_minutes']}m until next run…")
            try:
                await asyncio.sleep(sleep_secs)
            except asyncio.CancelledError:
                return

        while True:
            cycle = self._cycles.get(cycle_id)
            if cycle is None or cycle["status"] != "running":
                return

            # ── Check stop conditions before running ───────────────────────
            stop_reason = await self._check_stop_conditions(cycle)
            if stop_reason:
                self.stop_cycle(cycle_id, stop_reason)
                return

            # ── Run the funnel ─────────────────────────────────────────────
            cycle["next_run_at"] = None
            self._save_state()
            self._log(cycle_id, "info", f"Starting run #{cycle['runs_completed'] + 1} — {len(cycle['symbols'])} symbols")

            try:
                result = await run_autotrader(
                    symbols=cycle["symbols"],
                    total_capital=cycle["total_capital"],
                    lookback_days=cycle.get("lookback_days", 365),
                )

                # ── Top-level error (all symbols failed research) ──────────
                if result.get("error"):
                    self._log(cycle_id, "error", f"Research failed: {result['error']}")
                    # Still log per-symbol errors if any partial items came back
                    for i in result.get("items", []):
                        if i.get("error"):
                            self._log(cycle_id, "warn", f"  {i['symbol']}: {i['error']}")
                    raise RuntimeError(result["error"])

                # ── Log per-symbol errors for partially-failed runs ────────
                error_items = [i for i in result.get("items", []) if i.get("error")]
                ok_items    = [i for i in result.get("items", []) if not i.get("error")]
                for i in error_items:
                    self._log(cycle_id, "warn", f"  ⚠ {i['symbol']} skipped — {i['error']}")

                alloc_label = result.get("allocation_method", "unknown")
                self._log(cycle_id, "info",
                    f"Research complete — {len(ok_items)}/{len(cycle['symbols'])} symbols — allocation: {alloc_label}")
                if result.get("portfolio_thesis"):
                    self._log(cycle_id, "info", result["portfolio_thesis"])

                cycle["last_result"] = {
                    "ran_at":            result.get("ran_at"),
                    "allocation_method": result.get("allocation_method"),
                    "portfolio_thesis":  result.get("portfolio_thesis"),
                    "risk_notes":        result.get("risk_notes"),
                    "items": [
                        {
                            "symbol":        i["symbol"],
                            "weight_pct":    i.get("weight_pct"),
                            "capital":       i.get("capital"),
                            "shares":        i.get("shares"),
                            "current_price": i.get("current_price"),
                            "best_strategy": i.get("best_strategy"),
                        }
                        for i in ok_items
                    ],
                }

                # ── Build run history entry ────────────────────────────────
                history_items = []
                for i in ok_items:
                    best_sharpe = None
                    if i.get("best_strategy") and i.get("strategy_scores"):
                        for s in i["strategy_scores"]:
                            if s.get("strategy") == i.get("best_strategy"):
                                best_sharpe = s.get("sharpe_ratio")
                                break
                    history_items.append({
                        "symbol":        i["symbol"],
                        "weight_pct":    i.get("weight_pct"),
                        "capital":       i.get("capital"),
                        "shares":        i.get("shares"),
                        "current_price": i.get("current_price"),
                        "best_strategy": i.get("best_strategy"),
                        "sharpe_ratio":  best_sharpe,
                    })
                run_hist = cycle.setdefault("run_history", [])
                run_hist.append({
                    "run_number":        cycle["runs_completed"] + 1,
                    "ran_at":            result.get("ran_at"),
                    "allocation_method": result.get("allocation_method"),
                    "portfolio_thesis":  result.get("portfolio_thesis", ""),
                    "risk_notes":        result.get("risk_notes", ""),
                    "items":             history_items,
                })
                if len(run_hist) > 20:
                    cycle["run_history"] = run_hist[-20:]

                # ── Auto-execute if enabled ────────────────────────────────
                if cycle["auto_execute"]:
                    items_to_execute = [i for i in ok_items if i.get("shares", 0) > 0]
                    if items_to_execute:
                        await self._execute_items(cycle_id, cycle, items_to_execute)
                    elif ok_items:
                        self._log(cycle_id, "warn", "No items have shares > 0 — check capital vs prices")
                    else:
                        self._log(cycle_id, "warn", "No valid symbols produced allocations this run")
                else:
                    self._log(cycle_id, "info", "auto_execute=false — allocation ready for manual review")

            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._log(cycle_id, "error", f"Run failed: {e}")
                log.exception("CycleManager cycle %s run error", cycle_id[:8])

            cycle["runs_completed"] += 1
            cycle["last_run_at"] = datetime.now(timezone.utc).isoformat()

            # ── Check max_cycles after the run ─────────────────────────────
            if cycle["max_cycles"] is not None and cycle["runs_completed"] >= cycle["max_cycles"]:
                self.stop_cycle(cycle_id, f"Reached max_cycles={cycle['max_cycles']}")
                return

            # ── Sleep until next interval ──────────────────────────────────
            sleep_secs = cycle["interval_minutes"] * 60
            wake_at = datetime.now(timezone.utc).timestamp() + sleep_secs
            cycle["next_run_at"] = datetime.fromtimestamp(wake_at, tz=timezone.utc).isoformat()
            self._save_state()
            self._log(cycle_id, "info", f"Run complete. Next run in {cycle['interval_minutes']}m")

            try:
                await asyncio.sleep(sleep_secs)
            except asyncio.CancelledError:
                return

    async def _execute_items(self, cycle_id: str, cycle: dict, items: list[dict]):
        """Place orders for all valid items in the cycle run."""
        # ── Pre-flight buying power check ──────────────────────────────────
        if not cycle["dry_run"]:
            try:
                account = await self._executor.get_account()
                buying_power = float(account.get("buying_power", 0))
                total_notional = sum(i.get("capital", 0) for i in items)
                if total_notional > buying_power:
                    self._log(
                        cycle_id, "error",
                        f"Insufficient buying power — need ${total_notional:,.2f} but only "
                        f"${buying_power:,.2f} available. Orders skipped this run.",
                    )
                    return
            except Exception as e:
                self._log(cycle_id, "warn", f"Could not verify buying power: {e}")

        sem = asyncio.Semaphore(3)

        async def place(item: dict):
            async with sem:
                sym = item["symbol"]
                qty = item["shares"]
                if cycle["dry_run"]:
                    self._log(cycle_id, "info", f"DRY RUN: would BUY {qty} × {sym}")
                    return
                try:
                    result = await self._executor.place_order(
                        symbol=sym,
                        qty=qty,
                        side="buy",
                        order_type="market",
                        time_in_force="day",
                    )
                    order_id = result.get("id", "?")
                    self._log(cycle_id, "info", f"Order placed: BUY {qty} × {sym} — order #{order_id}")
                except Exception as e:
                    err_str = str(e)
                    if "403" in err_str:
                        err_str = "Insufficient buying power for this order (Alpaca 403)."
                    self._log(cycle_id, "error", f"Order failed for {sym}: {err_str}")

        await asyncio.gather(*[place(i) for i in items])

    async def _check_stop_conditions(self, cycle: dict) -> Optional[str]:
        """Returns a stop reason string if any stop condition is met, else None."""
        # stop_at datetime
        if cycle.get("stop_at"):
            try:
                stop_dt = datetime.fromisoformat(cycle["stop_at"])
                if datetime.now(timezone.utc) >= stop_dt.astimezone(timezone.utc):
                    return f"stop_at time reached ({cycle['stop_at']})"
            except ValueError:
                pass

        # P&L-based stops require live account data
        if cycle.get("stop_loss_pct") is not None or cycle.get("daily_loss_limit_pct") is not None:
            try:
                account = await self._executor.get_account()
                equity   = float(account.get("equity", 0))
                last_eq  = float(account.get("last_equity", equity))

                if cycle.get("stop_loss_pct") is not None and last_eq > 0:
                    drawdown_pct = (equity - last_eq) / last_eq * 100
                    if drawdown_pct <= -abs(cycle["stop_loss_pct"]):
                        return f"Stop-loss triggered: portfolio down {drawdown_pct:.1f}% (limit={-abs(cycle['stop_loss_pct'])}%)"

                # daily_loss_limit: compare today's change
                if cycle.get("daily_loss_limit_pct") is not None:
                    day_pl   = float(account.get("equity", 0)) - float(account.get("last_equity", account.get("equity", 0)))
                    cap      = cycle["total_capital"]
                    if cap > 0 and (day_pl / cap * 100) <= -abs(cycle["daily_loss_limit_pct"]):
                        return f"Daily loss limit hit: {day_pl:.2f} ({day_pl/cap*100:.1f}%)"

            except Exception as e:
                log.warning("CycleManager: could not check P&L conditions: %s", e)

        return None

    # ── Startup / shutdown ────────────────────────────────────────────────────

    async def startup(self):
        """Resume any cycles that were in 'running' state before restart."""
        for cycle_id, cycle in list(self._cycles.items()):
            if cycle.get("status") == "running":
                log.info("CycleManager: resuming cycle %s on startup", cycle_id[:8])
                self.start_cycle(cycle_id)

    async def shutdown(self):
        for cycle_id in list(self._tasks.keys()):
            self._stop_task(cycle_id)
        self._save_state()
        log.info("CycleManager: shut down %d cycles", len(self._cycles))


# Singleton instance
cycle_manager = CycleManager()
