"""
Alpaca broker integration.
Normalizes Alpaca bar data into the unified Candle model.

Notes:
  - Free / paper-trading accounts use the IEX feed (feed=iex).
  - Paid accounts can use the SIP feed (feed=sip) for full market data.
  - The ALPACA_DATA_FEED env var controls this; defaults to "iex".
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx

from app.brokers.base import BaseBroker
from app.models.candlestick import Candle, CandleSeries, Timeframe, Broker, AssetClass
from app.config import settings

TIMEFRAME_MAP = {
    Timeframe.M1: "1Min",
    Timeframe.M5: "5Min",
    Timeframe.M15: "15Min",
    Timeframe.M30: "30Min",
    Timeframe.H1: "1Hour",
    Timeframe.H4: "4Hour",
    Timeframe.D1: "1Day",
    Timeframe.W1: "1Week",
}

ALPACA_DATA_URL = "https://data.alpaca.markets/v2"
ALPACA_CRYPTO_URL = "https://data.alpaca.markets/v1beta3/crypto/us"


class AlpacaBroker(BaseBroker):
    def __init__(self):
        self.headers = {
            "APCA-API-KEY-ID": settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": settings.alpaca_secret_key,
        }
        # "iex" works on free/paper accounts; "sip" requires a paid subscription
        self.data_feed = getattr(settings, "alpaca_data_feed", "iex")

    def _is_crypto(self, symbol: str) -> bool:
        return "/" in symbol or (symbol.endswith("USD") and len(symbol) > 5)

    def _map_timeframe(self, tf: Timeframe) -> str:
        return TIMEFRAME_MAP.get(tf, "1Day")

    async def get_candles(
        self,
        symbol: str,
        timeframe: Timeframe,
        start: datetime,
        end: datetime,
        limit: int = 1000,
    ) -> CandleSeries:
        is_crypto = self._is_crypto(symbol)
        asset_class = AssetClass.CRYPTO if is_crypto else AssetClass.STOCK

        # Clamp end to now — Alpaca rejects future end dates on some feeds
        now = datetime.now(timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = min(end, now - timedelta(minutes=15))  # 15-min delay on free feed

        params = {
            "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit": min(limit, 10000),
            "timeframe": self._map_timeframe(timeframe),
        }

        if is_crypto:
            url = f"{ALPACA_CRYPTO_URL}/bars"
            params["symbols"] = symbol
        else:
            url = f"{ALPACA_DATA_URL}/stocks/{symbol}/bars"
            params["adjustment"] = "all"
            params["feed"] = self.data_feed   # "iex" for free/paper accounts

        all_bars: list[dict] = []
        async with httpx.AsyncClient() as client:
            while True:
                resp = await client.get(url, headers=self.headers, params=params, timeout=15.0)

                # Give a clear error message if credentials are wrong / feed not permitted
                if resp.status_code == 403:
                    raise ValueError(
                        f"Alpaca 403 Forbidden — your API keys may be invalid, or the "
                        f"'{self.data_feed}' feed is not available on your plan. "
                        f"Set ALPACA_DATA_FEED=iex in backend/.env for free/paper accounts."
                    )
                resp.raise_for_status()
                data = resp.json()

                if is_crypto:
                    page_bars = data.get("bars", {}).get(symbol, [])
                else:
                    page_bars = data.get("bars", [])

                all_bars.extend(page_bars)

                # Follow next_page_token for pagination
                next_token = data.get("next_page_token")
                if not next_token or not page_bars:
                    break
                params["page_token"] = next_token

        candles = [
            Candle(
                symbol=symbol,
                open=bar["o"],
                high=bar["h"],
                low=bar["l"],
                close=bar["c"],
                volume=bar["v"],
                timestamp=datetime.fromisoformat(bar["t"].replace("Z", "+00:00")),
                timeframe=timeframe,
                broker=Broker.ALPACA,
                asset_class=asset_class,
                vwap=bar.get("vw"),
                trade_count=bar.get("n"),
            )
            for bar in all_bars
        ]

        return CandleSeries(
            symbol=symbol,
            timeframe=timeframe,
            broker=Broker.ALPACA,
            candles=candles,
        )

    async def get_latest_candle(self, symbol: str, timeframe: Timeframe) -> CandleSeries:
        now = datetime.now(timezone.utc)
        start = now - timedelta(days=7)
        series = await self.get_candles(symbol, timeframe, start, now, limit=1)
        if series.candles:
            series.candles = [series.candles[-1]]
        return series

    async def get_symbols(self) -> list[str]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.alpaca_base_url}/v2/assets",
                headers=self.headers,
                params={"status": "active", "asset_class": "us_equity"},
                timeout=15.0,
            )
            resp.raise_for_status()
            assets = resp.json()
        return [a["symbol"] for a in assets if a.get("tradable")]

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{settings.alpaca_base_url}/v2/account",
                    headers=self.headers,
                    timeout=5.0,
                )
                return resp.status_code == 200
        except Exception:
            return False
