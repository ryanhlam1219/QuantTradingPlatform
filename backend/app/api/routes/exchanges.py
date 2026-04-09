"""
SSE endpoints for live exchange data streamed through the backend proxy.
"""
import asyncio
import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.binance_ws_proxy import stream_klines

log = logging.getLogger(__name__)
router = APIRouter(prefix="/exchanges", tags=["exchanges"])


@router.get("/binance/klines/{symbol}")
async def binance_klines_sse(symbol: str):
    """
    SSE endpoint: streams closed 1m kline candles from Binance US.

    Connect with:
        const es = new EventSource('http://localhost:8000/exchanges/binance/klines/BTCUSDT')
        es.onmessage = e => console.log(JSON.parse(e.data))

    Events:
        data: {"symbol":"BTCUSDT","open":...,"high":...,"low":...,"close":...,...}
        data: {"error":"..."}  — on error (stream ends after this)
    """
    sym = symbol.upper()
    log.info("[exchanges] SSE client connected for Binance/%s", sym)

    async def generator():
        yield "data: {\"status\": \"connected\"}\n\n"
        try:
            async for candle in stream_klines(sym):
                yield f"data: {json.dumps(candle)}\n\n"
        except asyncio.CancelledError:
            log.info("[exchanges] SSE client disconnected for Binance/%s", sym)
        except Exception as exc:
            log.error("[exchanges] SSE generator error: %s", exc)
            yield f"data: {{\"error\": \"{exc}\"}}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
