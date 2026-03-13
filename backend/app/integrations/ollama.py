"""
Ollama service — wraps the local Ollama API (localhost:11434).

Auto-start: on first request, if Ollama is unreachable, attempts to launch
`ollama serve` as a background process and waits up to 10s for it to come up.

Auto-pull: if the configured model is missing, attempts `ollama pull <model>`.

All analysis methods return graceful fallback dicts with is_fallback=True
if Ollama is still unavailable after recovery attempts.
"""
import asyncio
import json
import logging
import subprocess
import time
from typing import Optional
import httpx
from app.config import settings

log = logging.getLogger(__name__)

SYSTEM_MARKET_ANALYST = (
    "You are a quantitative market analyst assistant built into an algorithmic trading platform. "
    "You have deep expertise in technical analysis, trading strategy selection, and portfolio construction. "
    "You always respond with valid JSON only — no markdown, no prose outside the JSON object. "
    "Be concise, data-driven, and specific. Do not hallucinate statistics; work only from the data provided."
)

# ── Ollama process management ─────────────────────────────────────────────────

_serve_attempted = False   # only try once per process lifetime


async def _try_start_ollama() -> bool:
    """
    Attempt to launch `ollama serve` as a detached background process.
    Returns True if Ollama becomes reachable within 12 seconds, False otherwise.
    """
    global _serve_attempted
    if _serve_attempted:
        return False
    _serve_attempted = True

    log.info("Ollama unreachable — attempting to start 'ollama serve'…")
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except FileNotFoundError:
        log.warning("'ollama' binary not found. Install Ollama: https://ollama.com")
        return False
    except Exception as e:
        log.warning("Could not start Ollama: %s", e)
        return False

    # Poll until responsive (max 12s)
    base_url = settings.ollama_url.rstrip("/")
    async with httpx.AsyncClient(timeout=2) as client:
        for _ in range(12):
            await asyncio.sleep(1)
            try:
                r = await client.get(f"{base_url}/api/tags")
                if r.status_code == 200:
                    log.info("Ollama started successfully.")
                    return True
            except Exception:
                pass
    log.warning("Ollama did not respond within 12s after launch attempt.")
    return False


async def _ensure_model_pulled(base_url: str, model: str) -> bool:
    """
    If the model isn't already downloaded, attempt `ollama pull <model>`.
    Returns True if model is available afterward.
    """
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{base_url}/api/tags")
            if r.status_code == 200:
                models = [m["name"] for m in r.json().get("models", [])]
                if any(model in m for m in models):
                    return True
    except Exception:
        return False

    log.info("Model '%s' not found — attempting 'ollama pull %s'…", model, model)
    try:
        proc = await asyncio.create_subprocess_exec(
            "ollama", "pull", model,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=300)  # up to 5 min for first pull
        log.info("Model '%s' pulled successfully.", model)
        return True
    except asyncio.TimeoutError:
        log.warning("ollama pull timed out for model '%s'", model)
        return False
    except Exception as e:
        log.warning("ollama pull failed: %s", e)
        return False


# ── OllamaClient ─────────────────────────────────────────────────────────────

class OllamaClient:
    def __init__(self):
        self.base_url = settings.ollama_url.rstrip("/")
        self.model    = settings.ollama_model
        self.timeout  = 120

    async def _ensure_running(self) -> bool:
        """Check if Ollama is up; try to start it if not."""
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{self.base_url}/api/tags")
                return r.status_code == 200
        except Exception:
            return await _try_start_ollama()

    async def _chat(self, system: str, user: str) -> str:
        """
        Call /api/chat. On 404 (model not loaded) attempt a pull then retry.
        Falls back to /api/generate if /api/chat is truly unavailable.
        """
        if not await self._ensure_running():
            raise RuntimeError(
                f"Ollama is not running at {self.base_url}. "
                "Install it from https://ollama.com and run: ollama serve"
            )

        payload_chat = {
            "model": self.model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload_chat)
                if resp.status_code == 404:
                    # Model not pulled yet — try to pull it
                    log.info("Got 404 from /api/chat — pulling model '%s'", self.model)
                    await _ensure_model_pulled(self.base_url, self.model)
                    # Retry once
                    resp = await client.post(f"{self.base_url}/api/chat", json=payload_chat)

                resp.raise_for_status()
                return resp.json()["message"]["content"]

            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    # Last resort: /api/generate (older Ollama versions)
                    log.warning("Falling back to /api/generate for model '%s'", self.model)
                    gen_payload = {
                        "model": self.model,
                        "prompt": f"{system}\n\n{user}",
                        "stream": False,
                    }
                    r2 = await client.post(f"{self.base_url}/api/generate", json=gen_payload)
                    r2.raise_for_status()
                    return r2.json()["response"]
                raise

    async def _chat_json(self, system: str, user: str) -> dict:
        """Call Ollama and parse the response as JSON. Catches all errors gracefully."""
        try:
            raw = await self._chat(system, user)
            # Strip markdown code fences if the model adds them
            clean = raw.strip()
            if clean.startswith("```"):
                lines = clean.split("\n")
                clean = "\n".join(lines[1:] if lines[0].startswith("```") else lines)
            if clean.endswith("```"):
                clean = "\n".join(clean.split("\n")[:-1])
            return json.loads(clean.strip())
        except httpx.ConnectError:
            return {"is_fallback": True, "error": f"Ollama not reachable at {self.base_url}. Run: ollama serve"}
        except httpx.TimeoutException:
            return {"is_fallback": True, "error": f"Ollama timed out after {self.timeout}s. Try a smaller model (e.g. mistral)."}
        except json.JSONDecodeError as e:
            return {"is_fallback": True, "error": f"Ollama returned non-JSON output: {e}"}
        except RuntimeError as e:
            return {"is_fallback": True, "error": str(e)}
        except Exception as e:
            log.error("Ollama error: %s", e)
            return {"is_fallback": True, "error": str(e)}

    # ── Public analysis methods ───────────────────────────────────────────────

    async def analyse_asset(self, symbol: str, price_stats: dict,
                            strategy_scores: list[dict], news_headlines: list[str]) -> dict:
        headlines_text = "\n".join(f"- {h}" for h in news_headlines[:10]) if news_headlines else "No recent news available."
        strategy_text  = "\n".join(
            f"  {s['strategy']}: Sharpe={s['sharpe_ratio']:.2f}, Return={s['total_return']*100:.1f}%, "
            f"MaxDD={s['max_drawdown']*100:.1f}%, WinRate={s['win_rate']*100:.0f}%, Trades={s['total_trades']}"
            for s in strategy_scores
        )
        user_prompt = f"""Analyse {symbol} and provide a trading recommendation.

PRICE STATISTICS:
- Current price: ${price_stats.get('current_price', 0):.2f}
- 90-day return: {price_stats.get('return_90d', 0)*100:.1f}%
- 30-day return: {price_stats.get('return_30d', 0)*100:.1f}%
- Annualised volatility: {price_stats.get('volatility_ann', 0)*100:.1f}%
- RSI (14): {price_stats.get('rsi_14', 50):.1f}
- Price vs 20-day MA: {price_stats.get('pct_above_ma20', 0)*100:+.1f}%
- Price vs 50-day MA: {price_stats.get('pct_above_ma50', 0)*100:+.1f}%

RECENT NEWS:
{headlines_text}

BACKTEST SCORES (last 365 days):
{strategy_text}

Respond with ONLY this JSON:
{{
  "market_condition": "trending_up|trending_down|ranging|volatile",
  "trend_direction": "bullish|bearish|neutral",
  "volatility_regime": "low|medium|high",
  "best_strategy": "<strategy_name from the list above>",
  "strategy_reasoning": "<one sentence why this strategy fits>",
  "recommendation": "BUY|SELL|HOLD",
  "confidence": <0.0-1.0>,
  "reasoning": "<2-3 sentences>",
  "risks": "<main risk in one sentence>",
  "suggested_holding_period": "<e.g. 2-4 weeks>",
  "key_levels": {{"support": <price>, "resistance": <price>}}
}}"""
        result = await self._chat_json(SYSTEM_MARKET_ANALYST, user_prompt)
        result["symbol"] = symbol
        return result

    async def suggest_new_assets(
        self,
        existing_symbols: list[str],
        market_context: str,
        risk_tolerance: str = "medium",
        watchlist: Optional[str] = None,
        custom_symbols: Optional[list[str]] = None,
        max_price: Optional[float] = None,
        min_momentum_30d: Optional[float] = None,
        market_condition: Optional[str] = None,
        market_caps: Optional[list[str]] = None,
    ) -> dict:
        # Build a rich filter context string so the LLM gives grounded suggestions
        filter_lines = []
        if watchlist:
            watchlist_labels = {
                "sp100_top": "S&P 100 large-caps",
                "top_crypto": "top cryptocurrencies",
                "growth_tech": "growth / small-mid tech",
                "etfs": "ETFs",
            }
            filter_lines.append(f"User is screening the {watchlist_labels.get(watchlist, watchlist)} watchlist.")
        if custom_symbols:
            filter_lines.append(f"User added these custom symbols to the screen: {', '.join(custom_symbols)}.")
        if max_price is not None:
            filter_lines.append(f"IMPORTANT: User wants assets priced UNDER ${max_price:.2f}. Only suggest affordable assets below this price.")
        if min_momentum_30d is not None:
            filter_lines.append(f"User wants assets with at least {min_momentum_30d*100:.0f}% 30-day momentum.")
        if market_condition:
            filter_lines.append(f"User is filtering for assets in '{market_condition.replace('_', ' ')}' condition.")
        if market_caps:
            filter_lines.append(f"User prefers {', '.join(market_caps)} market-cap assets.")

        filter_context = ("\n".join(filter_lines) + "\n") if filter_lines else ""

        user_prompt = f"""{filter_context}Screened symbols already visible to user: {', '.join(existing_symbols[:20]) if existing_symbols else 'None (screen not run yet)'}
Market context: {market_context}
Risk tolerance: {risk_tolerance}

Suggest 5 assets NOT already visible that would complement the user's screen and match their filters.
Only suggest assets tradeable on Alpaca (US stocks, ETFs, or crypto pairs like BTC/USD).
{"Prices must be under $" + str(max_price) + " per share." if max_price else ""}

Respond with ONLY this JSON:
{{
  "suggestions": [
    {{
      "symbol": "<TICKER>",
      "asset_class": "stock|crypto|etf",
      "rationale": "<one sentence explaining why this fits the user's filters>",
      "complementary_strategy": "<strategy name>"
    }}
  ],
  "market_summary": "<one sentence on current market regime>"
}}"""
        return await self._chat_json(SYSTEM_MARKET_ANALYST, user_prompt)

    async def rate_portfolio(self, portfolio_items: list[dict], total_capital: float) -> dict:
        items_text = "\n".join(
            f"  {p['symbol']} → {p['strategy']} | ${p['capital']:.0f} ({p['weight_pct']:.1f}%) | Sharpe={p['sharpe_ratio']:.2f}"
            for p in portfolio_items
        )
        user_prompt = f"""Review this portfolio (total: ${total_capital:,.0f}):
{items_text}

Respond with ONLY this JSON:
{{
  "overall_score": <0-10>,
  "go_no_go": "GO|NO_GO|CAUTION",
  "diversification_comment": "<one sentence>",
  "concentration_risk": "<one sentence>",
  "strongest_position": "<symbol>",
  "weakest_position": "<symbol>",
  "suggestions": ["<improvement 1>", "<improvement 2>"]
}}"""
        return await self._chat_json(SYSTEM_MARKET_ANALYST, user_prompt)

    async def allocate_capital_with_ai(
        self,
        research_results: list[dict],
        total_capital: float,
    ) -> dict:
        """
        Given research results for N symbols, ask the LLM to decide how to split
        total_capital across them based on fundamentals, backtest quality, and risk.

        Returns:
        {
          "allocations": [{"symbol", "weight", "reasoning"}, ...],
          "portfolio_thesis": str,
          "risk_notes": str,
          "is_fallback": bool   (only present on error)
        }
        """
        items_text = ""
        for r in research_results:
            sym   = r.get("symbol", "?")
            ps    = r.get("price_stats", {})
            ai    = r.get("ai_analysis", {})
            bests = r.get("best_strategy", "unknown")
            scores = r.get("strategy_scores", [])
            best_score = next((s for s in scores if s.get("strategy") == bests), {})
            items_text += (
                f"\n{sym}:\n"
                f"  Strategy: {bests}\n"
                f"  Price: ${ps.get('current_price', 0):.2f} | "
                f"30d return: {ps.get('return_30d', 0)*100:.1f}% | "
                f"90d return: {ps.get('return_90d', 0)*100:.1f}% | "
                f"Vol: {ps.get('volatility_ann', 0)*100:.1f}% | "
                f"RSI: {ps.get('rsi_14', 50):.1f}\n"
                f"  Backtest → Sharpe: {best_score.get('sharpe_ratio', 0):.2f} | "
                f"Return: {best_score.get('total_return', 0)*100:.1f}% | "
                f"MaxDD: {best_score.get('max_drawdown', 0)*100:.1f}% | "
                f"WinRate: {best_score.get('win_rate', 0)*100:.0f}% | "
                f"Trades: {best_score.get('total_trades', 0)}\n"
                f"  AI: {ai.get('recommendation', 'N/A')} | "
                f"Confidence: {ai.get('confidence', 0):.0%} | "
                f"Trend: {ai.get('trend_direction', 'N/A')} | "
                f"Risk: {ai.get('risks', 'N/A')}\n"
            )

        symbols = [r.get("symbol", "") for r in research_results]
        user_prompt = f"""You are allocating ${total_capital:,.0f} total capital across {len(symbols)} pre-screened assets.

These assets have already been ranked and filtered — they represent the TOP-QUALITY tier from the full research set.
Your job is to size each position based on relative strength. Do NOT spread evenly; concentrate capital in the best opportunities.

Sizing rules:
- Strongest asset (best Sharpe + BUY + momentum): target 25–40%
- Good assets: 10–25%
- Weaker but still selected: 5–10%
- Minimum weight per asset: 5%  |  Maximum: 40%
- All weights must sum to exactly 1.0

ASSET DATA:
{items_text}

Respond with ONLY this JSON (one entry per symbol in the same order):
{{
  "allocations": [
    {{
      "symbol": "<SYMBOL>",
      "weight": <0.05-0.40, decimal>,
      "reasoning": "<one sentence: why this weight>"
    }}
  ],
  "portfolio_thesis": "<2 sentences on overall portfolio rationale>",
  "risk_notes": "<one sentence on the main portfolio-level risk>"
}}\
"""
        result = await self._chat_json(SYSTEM_MARKET_ANALYST, user_prompt)

        # Normalise weights so they always sum to 1.0 even if the LLM drifts
        if not result.get("is_fallback") and "allocations" in result:
            allocs = result["allocations"]
            total_w = sum(a.get("weight", 0) for a in allocs)
            if total_w > 0:
                for a in allocs:
                    a["weight"] = round(a.get("weight", 0) / total_w, 4)

        return result

    async def check_health(self) -> dict:
        """Ping Ollama, attempt auto-start if offline, return detailed status."""
        base = self.base_url
        try:
            async with httpx.AsyncClient(timeout=4) as client:
                r = await client.get(f"{base}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
                model_loaded = any(self.model in m for m in models)
                return {
                    "status":           "online",
                    "url":              base,
                    "active_model":     self.model,
                    "model_loaded":     model_loaded,
                    "available_models": models,
                    "auto_start":       False,
                }
        except Exception:
            # Try to start it
            started = await _try_start_ollama()
            if started:
                # Check model availability
                try:
                    async with httpx.AsyncClient(timeout=4) as client:
                        r = await client.get(f"{base}/api/tags")
                        models = [m["name"] for m in r.json().get("models", [])]
                        return {
                            "status":           "online",
                            "url":              base,
                            "active_model":     self.model,
                            "model_loaded":     any(self.model in m for m in models),
                            "available_models": models,
                            "auto_start":       True,
                        }
                except Exception as e2:
                    return {"status": "error", "url": base, "error": str(e2), "auto_start": True}

            return {
                "status":    "offline",
                "url":       base,
                "error":     "Ollama not running and could not be auto-started.",
                "fix":       "Install Ollama from https://ollama.com then run: ollama serve",
                "auto_start": False,
            }


# Module-level singleton
ollama = OllamaClient()
