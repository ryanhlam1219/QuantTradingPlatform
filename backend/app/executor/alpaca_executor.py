"""
Alpaca Trade Executor.
Translates strategy signals into real (or paper) orders via Alpaca API.
"""
import httpx
from datetime import datetime, timezone
from app.models.signal import Signal, SignalType
from app.config import settings


class AlpacaExecutor:
    def __init__(self):
        self.base_url = settings.alpaca_base_url
        self.headers = {
            "APCA-API-KEY-ID": settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": settings.alpaca_secret_key,
            "Content-Type": "application/json",
        }
        self.paper = settings.paper_trading

    async def get_account(self) -> dict:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{self.base_url}/v2/account", headers=self.headers, timeout=10.0)
            resp.raise_for_status()
            return resp.json()

    async def get_positions(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{self.base_url}/v2/positions", headers=self.headers, timeout=10.0)
            resp.raise_for_status()
            return resp.json()

    async def get_orders(self, status: str = "open") -> list[dict]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/v2/orders",
                headers=self.headers,
                params={"status": status, "limit": 50},
                timeout=10.0,
            )
            resp.raise_for_status()
            return resp.json()

    async def place_order(
        self,
        symbol: str,
        qty: float,
        side: str,          # "buy" or "sell"
        order_type: str = "market",
        time_in_force: str = "day",
        limit_price: float = None,
    ) -> dict:
        payload = {
            "symbol": symbol,
            "qty": str(qty),
            "side": side,
            "type": order_type,
            "time_in_force": time_in_force,
        }
        if limit_price:
            payload["limit_price"] = str(limit_price)

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v2/orders",
                headers=self.headers,
                json=payload,
                timeout=10.0,
            )
            resp.raise_for_status()
            return resp.json()

    async def cancel_order(self, order_id: str) -> bool:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{self.base_url}/v2/orders/{order_id}",
                headers=self.headers,
                timeout=10.0,
            )
            return resp.status_code == 204

    async def execute_signal(self, signal: Signal, qty: float) -> dict:
        """Execute a strategy signal as a market order."""
        side = "buy" if signal.signal_type == SignalType.BUY else "sell"
        result = await self.place_order(
            symbol=signal.symbol,
            qty=qty,
            side=side,
        )
        return {
            "order": result,
            "signal": signal.dict(),
            "paper_trading": self.paper,
            "executed_at": datetime.now(timezone.utc).isoformat(),
        }

    async def close_position(self, symbol: str) -> dict:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{self.base_url}/v2/positions/{symbol}",
                headers=self.headers,
                timeout=10.0,
            )
            resp.raise_for_status()
            return resp.json()
