"""
AutoTrader Service.

Full automated trading funnel for a list of symbols + total capital:
  1. Research each symbol concurrently (price stats, backtests, news, LLM analysis)
  2. Let the LLM decide capital allocation weights based on all research
  3. Compute shares per symbol from allocated capital / current price
  4. Return a structured plan ready for user review and one-click execution

Fallback: if the LLM allocation fails, falls back to Sharpe-weighted allocation
(same logic used in portfolio_builder.py).
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from app.core.research import research_asset
from app.integrations.ollama import ollama

log = logging.getLogger(__name__)

MIN_WEIGHT = 0.01   # 1% minimum allocation per symbol
MAX_WEIGHT = 0.40   # 40% maximum allocation per symbol


def _sharpe_fallback_allocation(items: list[dict], total_capital: float) -> list[dict]:
    """
    Fallback when the LLM is unavailable: Sharpe-weighted allocation with
    floor/ceiling, identical logic to portfolio_builder._sharpe_weighted_allocation.
    """
    sharpes = [max(item.get("best_sharpe", 0.01), 0.01) for item in items]
    total_sharpe = sum(sharpes)
    weights = [s / total_sharpe for s in sharpes]
    clipped = [max(MIN_WEIGHT, min(MAX_WEIGHT, w)) for w in weights]
    clip_total = sum(clipped)
    normalised = [w / clip_total for w in clipped]
    for i, item in enumerate(items):
        item["weight"] = round(normalised[i], 4)
        item["weight_reasoning"] = "Sharpe-weighted fallback (LLM unavailable)"
    return items


def _composite_score(r: dict) -> float:
    """
    Compute a ranking score for a research result. Higher is better.

    Components (weights):
      50% — Best Sharpe ratio across backtested strategies (primary quantitative signal)
      30% — AI recommendation × confidence                 (qualitative directional signal)
      20% — 90-day price momentum                          (trend confirmation)
    """
    scores = [
        s for s in r.get("strategy_scores", [])
        if not s.get("error") and s.get("total_trades", 0) > 0
    ]
    best_sharpe = max((s.get("sharpe_ratio", 0.0) for s in scores), default=0.0)
    # Sharpe 3.0 → normalised 1.0; negative Sharpes clamp at -0.5
    sharpe_norm = min(max(best_sharpe / 3.0, -0.5), 1.0)

    ai       = r.get("ai_analysis", {})
    rec_mult = {"BUY": 1.0, "HOLD": 0.5, "SELL": 0.0}.get(ai.get("recommendation", "HOLD"), 0.5)
    ai_score = rec_mult * float(ai.get("confidence", 0.5))  # 0.0–1.0

    ps       = r.get("price_stats", {})
    momentum = float(ps.get("return_90d", 0.0))
    # ±50% move → ±1.0
    mom_norm = min(max(momentum / 0.5, -1.0), 1.0)

    return 0.50 * sharpe_norm + 0.30 * ai_score + 0.20 * mom_norm


def _select_top_assets(
    valid_results: list[dict],
) -> tuple[list[dict], list[tuple[dict, float]]]:
    """
    Rank assets by composite score and keep only the top tier.
    Keeps the top 60% of assets, minimum 2, maximum 10.

    Returns:
      (selected, excluded_pairs) where excluded_pairs is [(result, score), ...].
    """
    if len(valid_results) <= 2:
        return valid_results, []

    scored = [(r, _composite_score(r)) for r in valid_results]
    scored.sort(key=lambda x: x[1], reverse=True)

    n = len(scored)
    k = max(2, min(10, round(n * 0.60)))

    selected      = [r          for r, _ in scored[:k]]
    excluded_pairs = [(r, score) for r, score in scored[k:]]
    return selected, excluded_pairs


def _enrich_with_allocation(
    research_results: list[dict],
    allocations: list[dict],
    total_capital: float,
) -> list[dict]:
    """
    Merge allocation weights into research results and compute capital + shares.
    Matches allocations to research by symbol (case-insensitive).
    """
    alloc_map = {a["symbol"].upper(): a for a in allocations}
    enriched = []
    for r in research_results:
        sym = r.get("symbol", "").upper()
        alloc = alloc_map.get(sym, {})
        weight = alloc.get("weight", 0.0)
        capital = round(total_capital * weight, 2)
        price = r.get("price_stats", {}).get("current_price", 0)
        shares = max(1, int(capital / price)) if price > 0 else 1
        enriched.append({
            "symbol":           sym,
            "best_strategy":    r.get("best_strategy"),
            "current_price":    price,
            "weight":           weight,
            "weight_pct":       round(weight * 100, 2),
            "capital":          capital,
            "shares":           shares,
            "weight_reasoning": alloc.get("reasoning", ""),
            "price_stats":      r.get("price_stats", {}),
            "ai_analysis":      r.get("ai_analysis", {}),
            "strategy_scores":  r.get("strategy_scores", []),
            "news_headlines":   r.get("news_headlines", []),
            "analysed_at":      r.get("analysed_at"),
            "error":            r.get("error"),
        })
    return enriched


async def run_autotrader(
    symbols: list[str],
    total_capital: float,
    lookback_days: int = 365,
) -> dict:
    """
    Run the full AutoTrader funnel.

    Returns:
    {
      items: [{symbol, best_strategy, current_price, weight, weight_pct,
               capital, shares, weight_reasoning, price_stats, ai_analysis,
               strategy_scores, news_headlines, error}, ...],
      total_capital,
      portfolio_thesis,
      risk_notes,
      allocation_method: "ai" | "sharpe_fallback",
      ran_at
    }
    """
    if not symbols:
        return {"error": "No symbols provided", "items": []}

    syms = [s.upper().strip() for s in symbols if s.strip()]

    # 1. Research all symbols concurrently (max 3 parallel to avoid rate limits)
    sem = asyncio.Semaphore(3)

    async def bounded_research(sym: str) -> dict:
        async with sem:
                return await research_asset(sym, lookback_days=lookback_days)
    raw_results = await asyncio.gather(*[bounded_research(s) for s in syms])
    # Keep all results (errors included) but only pass valid ones to the LLM
    valid_results = [r for r in raw_results if "error" not in r or "price_stats" in r]

    if not valid_results:
        return {
            "error": "Could not fetch data for any of the provided symbols.",
            "items": [],
        }

    # 1b. Rank and select the top-quality assets; the rest are excluded from allocation
    selected_results, excluded_pairs = _select_top_assets(valid_results)
    log.info(
        "Asset selection: %d/%d kept (%s)  |  excluded: %s",
        len(selected_results), len(valid_results),
        [r["symbol"] for r in selected_results],
        [r["symbol"] for r, _ in excluded_pairs],
    )

    # 2. LLM capital allocation
    allocation_method = "ai"
    portfolio_thesis = ""
    risk_notes = ""
    allocations: list[dict] = []

    ai_alloc = await ollama.allocate_capital_with_ai(selected_results, total_capital)

    if ai_alloc.get("is_fallback") or "allocations" not in ai_alloc:
        log.warning("LLM allocation failed (%s) — using Sharpe fallback", ai_alloc.get("error"))
        allocation_method = "sharpe_fallback"
        # Build a flat list with best sharpe per symbol for the fallback
        temp = []
        for r in selected_results:
            scores = [s for s in r.get("strategy_scores", []) if not s.get("error") and s.get("total_trades", 0) > 0]
            best_sharpe = max((s.get("sharpe_ratio", 0) for s in scores), default=0.01)
            temp.append({"symbol": r.get("symbol", ""), "best_sharpe": best_sharpe})
        temp = _sharpe_fallback_allocation(temp, total_capital)
        allocations = [{"symbol": t["symbol"], "weight": t["weight"], "reasoning": t["weight_reasoning"]} for t in temp]
    else:
        allocations = ai_alloc.get("allocations", [])
        portfolio_thesis = ai_alloc.get("portfolio_thesis", "")
        risk_notes = ai_alloc.get("risk_notes", "")

    # 3. Enrich and compute shares
    items = _enrich_with_allocation(selected_results, allocations, total_capital)

    # Add error-only results with zero allocation so the frontend can show them
    error_syms = {r.get("symbol", "").upper() for r in raw_results if "error" in r and "price_stats" not in r}
    for r in raw_results:
        sym = r.get("symbol", "").upper()
        if sym in error_syms:
            items.append({
                "symbol":           sym,
                "best_strategy":    None,
                "current_price":    0,
                "weight":           0,
                "weight_pct":       0,
                "capital":          0,
                "shares":           0,
                "weight_reasoning": "",
                "price_stats":      {},
                "ai_analysis":      {},
                "strategy_scores":  [],
                "news_headlines":   [],
                "analysed_at":      None,
                "error":            r.get("error"),
            })

    # Add below-threshold assets that were ranked out — visible but not allocated
    for r, score in excluded_pairs:
        sym = r.get("symbol", "").upper()
        ps  = r.get("price_stats", {})
        ai  = r.get("ai_analysis", {})
        rec = ai.get("recommendation", "HOLD")
        items.append({
            "symbol":           sym,
            "best_strategy":    r.get("best_strategy"),
            "current_price":    ps.get("current_price", 0),
            "weight":           0,
            "weight_pct":       0,
            "capital":          0,
            "shares":           0,
            "weight_reasoning": f"Ranked out (composite score {score:.2f} — below selection threshold)",
            "price_stats":      ps,
            "ai_analysis":      ai,
            "strategy_scores":  r.get("strategy_scores", []),
            "news_headlines":   r.get("news_headlines", []),
            "analysed_at":      r.get("analysed_at"),
            "error":            None,
            "excluded":         True,
            "exclusion_reason": f"Ranked out — composite score {score:.2f} (Sharpe/AI/momentum below threshold). Recommendation: {rec}.",
        })

    return {
        "items":             items,
        "total_capital":     total_capital,
        "portfolio_thesis":  portfolio_thesis,
        "risk_notes":        risk_notes,
        "allocation_method": allocation_method,
        "ran_at":            datetime.now(timezone.utc).isoformat(),
    }
