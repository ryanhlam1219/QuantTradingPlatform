#!/usr/bin/env python3
"""Test script to verify close_position works."""
import asyncio
import sys
sys.path.insert(0, '/Users/ryalam/Desktop/trading-platform/backend')

from app.execution.alpaca_executor import AlpacaExecutor

async def test_close_position():
    executor = AlpacaExecutor()
    
    # Get current positions
    print("Getting current positions...")
    try:
        positions = await executor.get_positions()
        print(f"✓ Found {len(positions)} open positions")
        for pos in positions:
            print(f"  - {pos['symbol']}: {pos['qty']} @ ${pos['current_price']}")
        
        if positions:
            # Try to close the first position
            symbol = positions[0]['symbol']
            print(f"\nClosing position for {symbol}...")
            result = await executor.close_position(symbol)
            print(f"✓ Position closed: {result}")
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_close_position())
