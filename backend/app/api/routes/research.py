"""
Research API routes.

POST /research/{symbol}   — full AI research pipeline for one asset
POST /research/batch      — research multiple assets concurrently
"""
import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.research import research_asset

router = APIRouter(prefix="/research", tags=["Research"])


@router.post("/{symbol}")
async def analyse(symbol: str):
    """
    Run the full research pipeline for a single asset:
      price stats → mini-backtests for all strategies → news → Ollama analysis.
    """
    result = await research_asset(symbol)
    if "error" in result and "price_stats" not in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result


class BatchRequest(BaseModel):
    symbols: list[str]


@router.post("/batch")
async def batch_analyse(req: BatchRequest):
    """
    Research up to 10 assets concurrently.
    Returns a list of results (errors are included inline, not raised).
    """
    if not req.symbols:
        raise HTTPException(status_code=400, detail="Provide at least one symbol.")
    if len(req.symbols) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 symbols per batch request.")

    sem = asyncio.Semaphore(3)  # 3 concurrent to avoid Alpaca rate limits

    async def bounded(sym: str):
        async with sem:
            return await research_asset(sym)

    results = await asyncio.gather(*[bounded(s) for s in req.symbols])
    return {"results": list(results), "count": len(results)}
