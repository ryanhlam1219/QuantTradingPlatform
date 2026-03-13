"""
Ollama client — wraps the local Ollama REST API at localhost:11434.

All methods return plain Python dicts/strings so they can be freely
JSON-serialised by FastAPI. The `research` helper is the main entry
point: it accepts structured market context and returns a parsed
recommendation object.
"""
import json
import logging
from typing import Any
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

OLLAMA_BASE = getattr(settings, "ollama_base_url", "http://localhost:11434")
OLLAMA_MODEL = getattr(settings, "ollama_model", "llama3")
TIMEOUT = 120.0   # Ollama can be slow on first load


async def _chat(messages: list[dict], model: str = OLLAMA_MODEL, json_mode: bool = False) -> str:
    """Send a chat completion request and return the assistant content string."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    if json_mode:
        payload["format"] = "json"

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(f"{OLLAMA_BASE}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["message"]["content"]
    except httpx.ConnectError:
        raise RuntimeError(
            f"Cannot connect to Ollama at {OLLAMA_BASE}. "
            "Make sure Ollama is running: `ollama serve`"
        )
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Ollama HTTP error {e.response.status_code}: {e.response.text}")


async def list_models() -> list[str]:
    """Return the names of locally available Ollama models."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{OLLAMA_BASE}/api/tags")
            resp.raise_for_status()
            return [m["name"] for m in resp.json().get("models", [])]
    except Exception:
        return []


async def health_check() -> dict:
    """Check whether Ollama is reachable and which models are available."""
    try:
        models = await list_models()
        return {"status": "ok", "models": models, "base_url": OLLAMA_BASE}
    except Exception as e:
        return {"status": "error", "error": str(e), "base_url": OLLAMA_BASE}


async def research_asset(
    symbol: str,
    price_summary: dict,
    recent_news: list[str],
    backtest_scores: list[dict],
    existing_portfolio: list[str] = None,
) -> dict:
    """
    Core research prompt. Given structured market data, asks Ollama to:
      1. Summarise what it sees in the price data
      2. Interpret the news sentiment
      3. Explain which strategy best fits this asset and why
      4. Give a BUY / SELL / HOLD recommendation with confidence 0-1
      5. If the asset should not be in the portfolio, say so

    Returns a parsed dict with keys:
      price_summary, news_sentiment, strategy_fit, recommendation,
      confidence, reasoning, should_include
    """
    portfolio_context = (
        f"Currently held in portfolio: {', '.join(existing_portfolio)}" 
        if existing_portfolio else "No existing portfolio positions."
    )

    scores_text = "\n".join(
        f"  - {s['strategy']}: Sharpe={s['sharpe']:.2f}, Return={s['total_return']*100:.1f}%, "
        f"MaxDD={s['max_drawdown']*100:.1f}%, WinRate={s['win_rate']*100:.0f}%"
        for s in backtest_scores
    )

    news_text = "\n".join(f"  • {n}" for n in recent_news[:8]) if recent_news else "  No recent news found."

    system = (
        "You are a quantitative trading analyst. You receive structured market data "
        "and return ONLY a valid JSON object — no markdown, no explanation outside the JSON. "
        "Be concise, analytical, and honest about uncertainty."
    )

    user = f"""Analyse {symbol} and return a JSON object with these exact keys:

{{
  "price_summary": "2-3 sentence summary of the price action and trend",
  "news_sentiment": "positive | neutral | negative",
  "news_summary": "1-2 sentence summary of recent news",
  "best_strategy": "name of the best-fit strategy from the backtest scores",
  "strategy_reasoning": "why this strategy fits this asset right now (2-3 sentences)",
  "recommendation": "BUY | SELL | HOLD",
  "confidence": 0.0,
  "reasoning": "overall reasoning for the recommendation (3-4 sentences)",
  "should_include": true,
  "risk_factors": "key risks to watch (1-2 sentences)"
}}

PRICE DATA for {symbol}:
  Current price:     ${price_summary.get('current_price', 'N/A')}
  30-day return:     {price_summary.get('return_30d', 0)*100:.1f}%
  90-day return:     {price_summary.get('return_90d', 0)*100:.1f}%
  1-year return:     {price_summary.get('return_1y', 0)*100:.1f}%
  30-day volatility: {price_summary.get('volatility_30d', 0)*100:.1f}% annualised
  RSI (14):          {price_summary.get('rsi', 'N/A')}
  Above 50-day MA:   {price_summary.get('above_ma50', 'N/A')}
  Above 200-day MA:  {price_summary.get('above_ma200', 'N/A')}
  Avg daily volume:  {price_summary.get('avg_volume', 'N/A')}

RECENT NEWS:
{news_text}

BACKTEST SCORES (last 1 year, each strategy):
{scores_text}

{portfolio_context}

Respond with ONLY the JSON object, no other text."""

    raw = await _chat(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        json_mode=True,
    )

    try:
        result = json.loads(raw)
        # Ensure confidence is float
        result["confidence"] = float(result.get("confidence", 0.5))
        result["should_include"] = bool(result.get("should_include", True))
        return result
    except json.JSONDecodeError:
        logger.warning("Ollama returned non-JSON, using fallback: %s", raw[:200])
        return {
            "price_summary": f"Analysis for {symbol}",
            "news_sentiment": "neutral",
            "news_summary": "Could not parse structured response",
            "best_strategy": backtest_scores[0]["strategy"] if backtest_scores else "rsi",
            "strategy_reasoning": "Based on backtest scores",
            "recommendation": "HOLD",
            "confidence": 0.3,
            "reasoning": raw[:500],
            "should_include": True,
            "risk_factors": "Review manually",
        }


async def suggest_new_assets(
    existing_portfolio: list[str],
    market_context: str,
    asset_universe: list[str],
) -> dict:
    """
    Ask Ollama to suggest new assets to add to a portfolio based on
    what's already held and current market conditions.

    Returns: {suggestions: [{symbol, reason, category}], reasoning: str}
    """
    system = (
        "You are a portfolio manager. Return ONLY valid JSON. "
        "Suggest diversifying additions to the portfolio."
    )
    held = ", ".join(existing_portfolio) if existing_portfolio else "none"
    universe = ", ".join(asset_universe[:50])

    user = f"""Current portfolio holdings: {held}

Market context: {market_context}

Available assets to consider: {universe}

Return a JSON object:
{{
  "suggestions": [
    {{"symbol": "TICKER", "reason": "why this adds value", "category": "stock|etf|crypto"}}
  ],
  "reasoning": "overall diversification rationale"
}}

Suggest 3-6 assets that would diversify the portfolio. Prefer uncorrelated assets.
Return ONLY the JSON."""

    raw = await _chat(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        json_mode=True,
    )

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"suggestions": [], "reasoning": "Could not parse Ollama response"}


async def free_chat(messages: list[dict]) -> str:
    """Pass-through for the research chat interface — returns plain text."""
    system_msg = {
        "role": "system",
        "content": (
            "You are an expert quantitative trading assistant embedded in QuantEdge, "
            "an algorithmic trading platform. You help users understand markets, "
            "trading strategies, risk management, and how to interpret backtesting results. "
            "Be concise, accurate, and always remind users that nothing is financial advice."
        )
    }
    full = [system_msg] + messages
    return await _chat(full)
