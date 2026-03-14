#!/usr/bin/env python3
"""Test script to verify backend can place orders."""
import asyncio
import sys
sys.path.insert(0, '/Users/ryalam/Desktop/trading-platform/backend')

from app.execution.alpaca_executor import AlpacaExecutor
from app.models.trade import Order, OrderSide, OrderType

async def test_order():
    executor = AlpacaExecutor()
    
    # Test: Place and cancel an order
    print("Testing executor.place_order()...")
    try:
        result = await executor.place_order(
            symbol="AAPL",
            qty=1,
            side="buy",
            order_type="market",
        )
        print(f"✓ Order placed: {result}")
        
        if result.get("id"):
            print(f"\nTesting executor.cancel_order()...")
            ok = await executor.cancel_order(result["id"])
            print(f"✓ Order cancelled: {ok}")
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_order())
