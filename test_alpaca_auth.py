#!/usr/bin/env python3
"""Test script to verify Alpaca API credentials and access."""
import asyncio
import httpx
import os
from dotenv import load_dotenv

# Load env
load_dotenv("backend/.env")

API_KEY = os.getenv("ALPACA_API_KEY")
SECRET_KEY = os.getenv("ALPACA_SECRET_KEY")
BASE_URL = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")

async def test_api():
    headers = {
        "APCA-API-KEY-ID": API_KEY,
        "APCA-API-SECRET-KEY": SECRET_KEY,
    }
    
    async with httpx.AsyncClient() as client:
        # Test 1: Get account (READ)
        print("1. Testing GET /account...")
        try:
            resp = await client.get(f"{BASE_URL}/v2/account", headers=headers, timeout=10)
            print(f"   Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"   ✓ Account accessible")
                print(f"   - Portfolio: ${data.get('portfolio_value')}")
                print(f"   - Buying Power: ${data.get('buying_power')}")
                print(f"   - Trading Blocked: {data.get('trading_blocked')}")
                if data.get('trading_blocked'):
                    print(f"   - Reason: {data.get('trading_blocked_reason')}")
            else:
                print(f"   ✗ Error: {resp.text}")
        except Exception as e:
            print(f"   ✗ Exception: {e}")

        # Test 2: Get positions (READ)
        print("\n2. Testing GET /positions...")
        try:
            resp = await client.get(f"{BASE_URL}/v2/positions", headers=headers, timeout=10)
            print(f"   Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"   ✓ Positions accessible ({len(data)} positions)")
            else:
                print(f"   ✗ Error: {resp.text}")
        except Exception as e:
            print(f"   ✗ Exception: {e}")

        # Test 3: Try to place a test order (WRITE)
        print("\n3. Testing POST /orders (test order)...")
        payload = {
            "symbol": "AAPL",
            "qty": 1,
            "side": "buy",
            "type": "market",
            "time_in_force": "day",
        }
        try:
            resp = await client.post(
                f"{BASE_URL}/v2/orders",
                headers=headers,
                json=payload,
                timeout=10
            )
            print(f"   Status: {resp.status_code}")
            if resp.status_code == 200 or resp.status_code == 201:
                data = resp.json()
                order_id = data.get("id")
                print(f"   ✓ Order placed: {order_id}")
                
                # Cancel it immediately
                print(f"\n4. Testing DELETE /orders/{order_id} (cleanup)...")
                resp = await client.delete(
                    f"{BASE_URL}/v2/orders/{order_id}",
                    headers=headers,
                    timeout=10
                )
                print(f"   Status: {resp.status_code}")
                if resp.status_code == 204 or resp.status_code == 200:
                    print(f"   ✓ Order cancelled")
                else:
                    print(f"   ✗ Error cancelling: {resp.text}")
            else:
                error_detail = resp.json() if resp.headers.get("content-type") == "application/json" else resp.text
                print(f"   ✗ Error: {error_detail}")
        except Exception as e:
            print(f"   ✗ Exception: {e}")

if __name__ == "__main__":
    print(f"Testing Alpaca API\n")
    print(f"Base URL: {BASE_URL}")
    print(f"API Key: {API_KEY[:10]}...")
    print("-" * 60)
    asyncio.run(test_api())
