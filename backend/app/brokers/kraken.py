"""Kraken broker integration (crypto)."""
from datetime import datetime, timezone
import httpx

from app.brokers.base import BaseBroker
from app.models.candlestick import Candle, CandleSeries, Timeframe, Broker, AssetClass

KRAKEN_BASE = "https://api.kraken.com/0/public"

TIMEFRAME_MAP = {
    Timeframe.M1: 1, Timeframe.M5: 5, Timeframe.M15: 15,
    Timeframe.M30: 30, Timeframe.H1: 60, Timeframe.H4: 240,
    Timeframe.D1: 1440, Timeframe.W1: 10080,
}


class KrakenBroker(BaseBroker):
    async def get_candles(self, symbol, timeframe, start, end, limit=1000) -> CandleSeries:
        params = {
            "pair": symbol,
            "interval": TIMEFRAME_MAP.get(timeframe, 1440),
            "since": int(start.timestamp()),
        }
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{KRAKEN_BASE}/OHLC", params=params, timeout=15.0)
            resp.raise_for_status()
            data = resp.json()

        pair_key = [k for k in data["result"].keys() if k != "last"][0]
        raw = data["result"][pair_key]

        candles = [
            Candle(
                symbol=symbol,
                open=float(bar[1]), high=float(bar[2]),
                low=float(bar[3]), close=float(bar[4]),
                volume=float(bar[6]),
                timestamp=datetime.fromtimestamp(bar[0], tz=timezone.utc),
                timeframe=timeframe, broker=Broker.KRAKEN,
                asset_class=AssetClass.CRYPTO,
                vwap=float(bar[5]),
            )
            for bar in raw
            if datetime.fromtimestamp(bar[0], tz=timezone.utc) <= end
        ]
        return CandleSeries(symbol=symbol, timeframe=timeframe, broker=Broker.KRAKEN, candles=candles)

    async def get_latest_candle(self, symbol, timeframe) -> CandleSeries:
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        return await self.get_candles(symbol, timeframe, now - timedelta(days=2), now, limit=1)

    async def get_symbols(self) -> list[str]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{KRAKEN_BASE}/AssetPairs", timeout=10.0)
            resp.raise_for_status()
        return list(resp.json()["result"].keys())

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(f"{KRAKEN_BASE}/Time", timeout=5.0)
                return resp.status_code == 200
        except Exception:
            return False
