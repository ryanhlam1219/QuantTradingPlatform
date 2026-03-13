"""
Screener API routes.

POST /screener/scan     — screen a watchlist with optional filters
GET  /screener/watchlists — list available watchlists and their symbols
GET  /screener/suggest  — ask Ollama for AI-suggested assets
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.core.screener import run_screener, WATCHLISTS, ASSET_META
from app.integrations.ollama import ollama

router = APIRouter(prefix="/screener", tags=["Screener"])


class ScanRequest(BaseModel):
    watchlist:        str = "sp100_top"
    custom_symbols:   list[str] = []
    custom_only:      bool = False             # if True, skip the watchlist entirely
    min_volatility:   Optional[float] = None   # e.g. 0.20 = 20% annualised
    max_volatility:   Optional[float] = None
    min_momentum_30d: Optional[float] = None   # e.g. 0.05 = up 5%+ in 30d
    max_price:        Optional[float] = None   # e.g. 50.0 = only assets under $50
    sectors:          Optional[list[str]] = None
    market_caps:      Optional[list[str]] = None  # "mega","large","mid","small"
    market_condition: Optional[str] = None    # "trending_up|trending_down|ranging|volatile"
    limit:            int = 30
    sort_by:          str = "momentum_30d"     # momentum_30d | trend_score | volatility_ann | volume_rank
    top_n:            Optional[int] = None     # if set, return only the top N after sorting


@router.post("/scan")
async def scan(req: ScanRequest):
    """Screen a watchlist and return ranked assets with technical metrics."""
    # Build symbol list: custom_only skips the watchlist entirely
    if req.custom_only and req.custom_symbols:
        symbols = [s.upper().strip() for s in req.custom_symbols if s.strip()]
    else:
        symbols = list(WATCHLISTS.get(req.watchlist, []))
        # Merge custom symbols into watchlist
        for sym in req.custom_symbols:
            s = sym.upper().strip()
            if s and s not in symbols:
                symbols.append(s)

    if not symbols:
        raise HTTPException(status_code=400, detail="No symbols to scan. Pick a watchlist or add custom symbols.")

    VALID_SORT_FIELDS = {"momentum_30d", "trend_score", "volatility_ann", "volume_rank"}
    sort_by = req.sort_by if req.sort_by in VALID_SORT_FIELDS else "momentum_30d"

    try:
        results = await run_screener(
            symbols=symbols,
            min_volatility=req.min_volatility,
            max_volatility=req.max_volatility,
            min_momentum=req.min_momentum_30d,
            max_price=req.max_price,
            sectors=req.sectors,
            market_caps=req.market_caps,
            market_condition=req.market_condition,
        )

        # Sort by chosen field (descending for momentum/trend/volume; ascending for volatility)
        reverse = sort_by != "volatility_ann"
        results.sort(key=lambda r: r.get(sort_by, 0) or 0, reverse=reverse)

        # Apply top_n universe narrowing before the per-page limit
        if req.top_n and req.top_n > 0:
            results = results[: req.top_n]

        return {
            "watchlist":     req.watchlist,
            "scanned":       len(symbols),
            "results_count": len(results),
            "sort_by":       sort_by,
            "results":       results[: req.limit],
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Screener error: {e}")


@router.get("/watchlists")
async def list_watchlists():
    """Return available watchlist names and their symbol counts."""
    return {
        name: {"count": len(syms), "symbols": syms}
        for name, syms in WATCHLISTS.items()
    }


@router.get("/sectors")
async def list_sectors():
    """Return available sectors and market caps for filter dropdowns."""
    sectors    = sorted(set(m["sector"]     for m in ASSET_META.values()))
    market_caps= sorted(set(m["market_cap"] for m in ASSET_META.values()))
    return {"sectors": sectors, "market_caps": market_caps}


class SuggestRequest(BaseModel):
    existing_symbols: list[str] = []
    market_context:   str = "current market conditions"
    risk_tolerance:   str = "medium"
    # Active filter context passed to LLM for grounded suggestions
    watchlist:        Optional[str] = None      # e.g. "sp100_top"
    custom_symbols:   list[str] = []
    max_price:        Optional[float] = None    # affordability cap
    min_momentum_30d: Optional[float] = None
    market_condition: Optional[str] = None
    market_caps:      Optional[list[str]] = None


@router.post("/suggest")
async def ai_suggest(req: SuggestRequest):
    """Ask Ollama to suggest new assets based on active screen filters."""
    result = await ollama.suggest_new_assets(
        existing_symbols=req.existing_symbols,
        market_context=req.market_context,
        risk_tolerance=req.risk_tolerance,
        watchlist=req.watchlist,
        custom_symbols=req.custom_symbols,
        max_price=req.max_price,
        min_momentum_30d=req.min_momentum_30d,
        market_condition=req.market_condition,
        market_caps=req.market_caps,
    )
    return result


@router.get("/health")
async def ollama_health():
    """Check if Ollama is running and which models are available."""
    return await ollama.check_health()
