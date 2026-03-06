"""Binance.US broker integration (crypto)."""
from datetime import datetime, timezone
import httpx

from app.brokers.base import BaseBroker
from app.models.candlestick import Candle, CandleSeries, Timeframe, Broker, AssetClass

BINANCE_BASE = "https://api.binance.us/api/v3"

TIMEFRAME_MAP = {
    Timeframe.M1: "1m", Timeframe.M5: "5m", Timeframe.M15: "15m",
    Timeframe.M30: "30m", Timeframe.H1: "1h", Timeframe.H4: "4h",
    Timeframe.D1: "1d", Timeframe.W1: "1w",
}


class BinanceUSBroker(BaseBroker):
    async def get_candles(self, symbol, timeframe, start, end, limit=1000) -> CandleSeries:
        params = {
            "symbol": symbol,
            "interval": TIMEFRAME_MAP.get(timeframe, "1d"),
            "startTime": int(start.timestamp() * 1000),
            "endTime": int(end.timestamp() * 1000),
            "limit": min(limit, 1000),
        }
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BINANCE_BASE}/klines", params=params, timeout=15.0)
            resp.raise_for_status()
            raw = resp.json()

        candles = [
            Candle(
                symbol=symbol,
                open=float(bar[1]), high=float(bar[2]),
                low=float(bar[3]), close=float(bar[4]),
                volume=float(bar[5]),
                timestamp=datetime.fromtimestamp(bar[0] / 1000, tz=timezone.utc),
                timeframe=timeframe, broker=Broker.BINANCE_US,
                asset_class=AssetClass.CRYPTO,
                trade_count=bar[8],
            )
            for bar in raw
        ]
        return CandleSeries(symbol=symbol, timeframe=timeframe, broker=Broker.BINANCE_US, candles=candles)

    async def get_latest_candle(self, symbol, timeframe) -> CandleSeries:
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        return await self.get_candles(symbol, timeframe, now - timedelta(days=2), now, limit=1)

    async def get_symbols(self) -> list[str]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BINANCE_BASE}/exchangeInfo", timeout=10.0)
            resp.raise_for_status()
        return [s["symbol"] for s in resp.json()["symbols"] if s["status"] == "TRADING"]

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(f"{BINANCE_BASE}/ping", timeout=5.0)
                return resp.status_code == 200
        except Exception:
            return False
