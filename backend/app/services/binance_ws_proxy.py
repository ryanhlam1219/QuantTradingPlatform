"""
Proxy service that connects to Binance US WebSocket API,
authenticates with backend credentials, and yields kline candles.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import time
from collections.abc import AsyncGenerator
from typing import Any

import websockets

from app.config import settings

log = logging.getLogger(__name__)

BINANCE_WS_URL = "wss://ws-api.binance.us:443/ws-api/v3"


def _sign(payload: str, secret: str) -> str:
    """HMAC-SHA256 hex signature."""
    return hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()


async def stream_klines(symbol: str) -> AsyncGenerator[dict[str, Any], None]:
    """
    Async generator that connects to Binance US, subscribes to 1m klines for
    *symbol*, and yields normalized candle dicts when each candle closes.

    Yields dicts with keys: symbol, open, high, low, close, volume, timestamp, timeframe, broker, assetClass
    Yields {"error": "..."} on unrecoverable errors.
    """
    api_key = settings.binance_api_key or ""
    secret = settings.binance_secret_key or ""

    if not api_key or not secret:
        log.error("[BinanceProxy] Missing BINANCE_API_KEY / BINANCE_SECRET_KEY in backend/.env")
        yield {"error": "Binance credentials not configured on backend"}
        return

    stream = f"{symbol.lower()}@kline_1m"
    timestamp = int(time.time() * 1000)
    sig_payload = f"apiKey={api_key}&streams=[\"{stream}\"]&timestamp={timestamp}"
    signature = _sign(sig_payload, secret)

    subscribe_msg = json.dumps({
        "id": 1,
        "method": "stream.subscribe",
        "params": {
            "apiKey": api_key,
            "streams": [stream],
            "signature": signature,
            "timestamp": timestamp,
        },
    })

    try:
        async with websockets.connect(BINANCE_WS_URL) as ws:
            log.info("[BinanceProxy] Connected to %s, subscribing to %s", BINANCE_WS_URL, stream)
            await ws.send(subscribe_msg)

            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                # Subscription confirmation
                if msg.get("result") is None and msg.get("id"):
                    log.info("[BinanceProxy] Subscription confirmed for %s", stream)
                    continue

                # Error response
                if "error" in msg:
                    log.error("[BinanceProxy] Binance error: %s", msg["error"])
                    yield {"error": str(msg["error"])}
                    return

                # Kline data
                k = msg.get("data", {}).get("k")
                if k and k.get("x"):  # x=True means candle closed
                    yield {
                        "symbol": symbol,
                        "open": float(k["o"]),
                        "high": float(k["h"]),
                        "low": float(k["l"]),
                        "close": float(k["c"]),
                        "volume": float(k["v"]),
                        "timestamp": k["T"],  # close time ms
                        "timeframe": "1m",
                        "broker": "binance",
                        "assetClass": "crypto",
                    }

    except websockets.exceptions.ConnectionClosedError as exc:
        log.warning("[BinanceProxy] Connection closed: %s", exc)
        yield {"error": f"Connection closed: {exc}"}
    except Exception as exc:
        log.error("[BinanceProxy] Unexpected error: %s", exc, exc_info=True)
        yield {"error": str(exc)}
