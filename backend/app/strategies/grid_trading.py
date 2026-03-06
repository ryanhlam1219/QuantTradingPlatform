"""
Grid Trading Strategy.

Places buy orders at regular price intervals below current price and sell
orders above. Profits from price oscillation within a defined range.

This implementation generates the grid signal sequence from historical data
so the backtesting engine can evaluate it. In live trading the executor
maintains the grid state separately.

BUY  when price drops to a grid buy level.
SELL when price rises to a grid sell level.
"""
from datetime import timezone

from app.strategies.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.trade import TradeSignal, OrderSide


class GridTradingStrategy(BaseStrategy):

    @property
    def name(self) -> str:
        return "grid_trading"

    @property
    def description(self) -> str:
        return (
            "Grid Trading divides a price range into evenly spaced levels. "
            "Buy orders are placed at each level below a reference price; sell "
            "orders at each level above. The strategy profits from price "
            "oscillation within the grid — every round-trip between adjacent "
            "levels captures the grid spacing as profit. Works best in "
            "sideways/volatile markets. Underperforms in strong trends."
        )

    @property
    def default_params(self) -> dict:
        return {
            "grid_levels":    10,     # Number of grid lines above and below
            "grid_spacing_pct": 1.0,  # % between each grid level
            "reference": "auto",      # "auto" = first candle close, or a fixed price
        }

    @property
    def param_schema(self) -> dict:
        return {
            "grid_levels":      {"type": "int",   "min": 2,   "max": 50,   "default": 10},
            "grid_spacing_pct": {"type": "float", "min": 0.1, "max": 10.0, "default": 1.0},
            "reference":        {"type": "string", "default": "auto"},
        }

    def generate_signals(self, series: CandleSeries) -> list[TradeSignal]:
        if len(series.candles) < 2:
            return []

        levels = self.params["grid_levels"]
        spacing = self.params["grid_spacing_pct"] / 100.0

        # Reference price: first candle close or user-specified
        ref = self.params["reference"]
        if ref == "auto" or not isinstance(ref, (int, float)):
            ref_price = series.candles[0].close
        else:
            ref_price = float(ref)

        # Build grid: buy levels below ref, sell levels above
        buy_levels  = [ref_price * (1 - spacing * (i + 1)) for i in range(levels)]
        sell_levels = [ref_price * (1 + spacing * (i + 1)) for i in range(levels)]

        # Track which levels have been hit (avoid duplicate signals at same level)
        triggered_buys:  set[int] = set()
        triggered_sells: set[int] = set()

        signals: list[TradeSignal] = []

        for candle in series.candles[1:]:
            ts = candle.timestamp
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            low  = candle.low
            high = candle.high

            # Check buy grid levels
            for idx, level in enumerate(buy_levels):
                if low <= level and idx not in triggered_buys:
                    triggered_buys.add(idx)
                    # Reset sell trigger for this level so we can sell after buying
                    triggered_sells.discard(idx)
                    signals.append(TradeSignal(
                        symbol=series.symbol,
                        side=OrderSide.BUY,
                        strategy_name=self.name,
                        confidence=0.8,
                        reason=f"Price reached buy grid level {idx + 1} at {level:.4f}",
                        timestamp=ts,
                        metadata={
                            "grid_level_index": idx,
                            "grid_price": level,
                            "grid_type": "buy",
                            "spacing_pct": self.params["grid_spacing_pct"],
                        },
                    ))

            # Check sell grid levels
            for idx, level in enumerate(sell_levels):
                if high >= level and idx not in triggered_sells:
                    triggered_sells.add(idx)
                    triggered_buys.discard(idx)
                    signals.append(TradeSignal(
                        symbol=series.symbol,
                        side=OrderSide.SELL,
                        strategy_name=self.name,
                        confidence=0.8,
                        reason=f"Price reached sell grid level {idx + 1} at {level:.4f}",
                        timestamp=ts,
                        metadata={
                            "grid_level_index": idx,
                            "grid_price": level,
                            "grid_type": "sell",
                            "spacing_pct": self.params["grid_spacing_pct"],
                        },
                    ))

        return sorted(signals, key=lambda s: s.timestamp)
