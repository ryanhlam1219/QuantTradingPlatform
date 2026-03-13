"""
Portfolio Builder API routes.

POST /portfolio/build    — build allocation plan from (symbol, strategy) pairs
POST /portfolio/execute  — execute an approved portfolio plan
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.core.portfolio import build_portfolio, execute_portfolio, validate_portfolio

router = APIRouter(prefix="/portfolio", tags=["Portfolio"])


class PortfolioPair(BaseModel):
    symbol:        str
    strategy:      str
    current_price: float = 0.0


class BuildRequest(BaseModel):
    pairs:         list[PortfolioPair]
    total_capital: float = 10_000.0
    review_with_ai:bool  = True


class ExecuteRequest(BaseModel):
    items:   list[dict]   # enriched items from /portfolio/build response
    dry_run: bool = False


@router.post("/build")
async def build(req: BuildRequest):
    """
    Build a Sharpe-weighted portfolio plan.

    Runs 1-year backtests for every (symbol, strategy) pair,
    computes capital allocation, and requests an AI review.
    Returns the full plan for user approval — nothing is executed yet.
    """
    if not req.pairs:
        raise HTTPException(status_code=400, detail="Provide at least one asset-strategy pair.")
    if req.total_capital < 100:
        raise HTTPException(status_code=400, detail="Total capital must be at least $100.")

    pairs_dicts = [p.dict() for p in req.pairs]
    try:
        result = await build_portfolio(
            pairs=pairs_dicts,
            total_capital=req.total_capital,
            review_with_ai=req.review_with_ai,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Portfolio build failed: {e}")


@router.post("/execute")
async def execute(req: ExecuteRequest):
    """
    Execute an approved portfolio plan.

    Fires all market orders simultaneously.
    Each item must have: symbol, shares, side (default "buy").
    Set dry_run=true to simulate without placing real orders.
    """
    if not req.items:
        raise HTTPException(status_code=400, detail="No items to execute.")

    try:
        results = await execute_portfolio(req.items, dry_run=req.dry_run)
        succeeded = [r for r in results if r.get("success")]
        failed    = [r for r in results if not r.get("success")]
        return {
            "executed":  len(succeeded),
            "failed":    len(failed),
            "dry_run":   req.dry_run,
            "results":   results,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Execution failed: {e}")



# ── Walk-forward validation endpoint ─────────────────────────────────────────

class ValidateRequest(BaseModel):
    pairs:    list[PortfolioPair]
    oos_days: int = 90   # hold-out window: 30, 60, or 90 days


@router.post("/validate")
async def validate(req: ValidateRequest):
    """
    Walk-forward validation for a portfolio plan.

    Splits history into:
      - In-sample  (IS):  ~365 days before the hold-out window
      - Out-of-sample (OOS): most recent `oos_days` days

    Returns per-pair IS vs OOS metrics, OOS equity curves,
    and an overall VALIDATED / CAUTION / REJECTED verdict with confidence score.
    """
    if not req.pairs:
        raise HTTPException(status_code=400, detail="Provide at least one asset-strategy pair.")
    if req.oos_days not in (30, 60, 90):
        raise HTTPException(status_code=400, detail="oos_days must be 30, 60, or 90.")

    pairs_dicts = [p.dict() for p in req.pairs]
    try:
        result = await validate_portfolio(pairs_dicts, oos_days=req.oos_days)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Validation failed: {e}")


# ── AI Chat endpoint ─────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]

@router.post("/chat")
async def chat(req: ChatRequest):
    """Free-form trading assistant chat via local Ollama."""
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages list is empty.")

    SYSTEM = (
        "You are an expert quantitative trading assistant embedded in QuantEdge, "
        "an algorithmic trading platform. Help users understand markets, strategies, "
        "risk management, and portfolio construction. Be concise and always clarify "
        "that nothing you say constitutes financial advice."
    )
    from app.config import settings
    import httpx

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    payload = {
        "model":    settings.ollama_model,
        "stream":   False,
        "messages": [{"role": "system", "content": SYSTEM}] + messages,
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{settings.ollama_url.rstrip('/')}/api/chat", json=payload)
            resp.raise_for_status()
            content = resp.json()["message"]["content"]
        return {"role": "assistant", "content": content}
    except httpx.ConnectError:
        return {
            "role": "assistant",
            "content": "⚠ Ollama is not running. Start it with `ollama serve`, then pull a model: `ollama pull llama3`",
        }
    except Exception as e:
        return {"role": "assistant", "content": f"⚠ AI error: {str(e)}"}


@router.get("/ollama")
async def ollama_status():
    """Check if Ollama is running and which models are loaded."""
    from app.integrations.ollama import ollama
    return await ollama.check_health()
