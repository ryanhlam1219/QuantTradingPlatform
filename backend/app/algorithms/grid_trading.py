"""
Grid Trading Strategy.
Places buy and sell orders at fixed price intervals (grid levels)
above and below a reference price, profiting from oscillation.
"""
import numpy as np
from app.algorithms.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.signal import Signal, SignalType


class GridTradingStrategy(BaseStrategy):
    name = "grid_trading"
    description = "Range-bound strategy that profits from price oscillation within a grid"
    default_params = {
        "grid_levels": 10,        # Number of grid lines above/below center
        "grid_spacing_pct": 0.02, # 2% between each grid level
        "lookback": 50,           # Candles used to determine grid center
    }

    def _build_grid(self, center: float, levels: int, spacing_pct: float) -> list[float]:
        grid = []
        for i in range(-levels, levels + 1):
            grid.append(center * (1 + i * spacing_pct))
        return sorted(grid)

    def generate_signals(self, series: CandleSeries) -> list[Signal]:
        closes = series.closes
        timestamps = series.timestamps
        lookback = self.params["lookback"]
        levels = self.params["grid_levels"]
        spacing = self.params["grid_spacing_pct"]
        signals = []

        if len(closes) < lookback + 1:
            return signals

        # Recalculate grid center every `lookback` candles
        for i in range(lookback, len(closes)):
            window = closes[i - lookback : i]
            center = np.mean(window)
            grid = self._build_grid(center, levels, spacing)

            prev_price = closes[i - 1]
            curr_price = closes[i]

            for level in grid:
                # Price crossed DOWN through a grid level → BUY (limit order)
                if prev_price >= level > curr_price:
                    distance_from_center = abs(level - center) / center
                    confidence = max(0.3, 1.0 - distance_from_center / (levels * spacing))
                    signals.append(Signal(
                        symbol=series.symbol, signal_type=SignalType.BUY,
                        price=curr_price, timestamp=timestamps[i],
                        strategy=self.name, confidence=confidence,
                        metadata={"grid_level": round(level, 4), "center": round(center, 4),
                                   "grid_spacing_pct": spacing},
                    ))
                    break
                # Price crossed UP through a grid level → SELL (take profit)
                elif prev_price <= level < curr_price:
                    distance_from_center = abs(level - center) / center
                    confidence = max(0.3, 1.0 - distance_from_center / (levels * spacing))
                    signals.append(Signal(
                        symbol=series.symbol, signal_type=SignalType.SELL,
                        price=curr_price, timestamp=timestamps[i],
                        strategy=self.name, confidence=confidence,
                        metadata={"grid_level": round(level, 4), "center": round(center, 4),
                                   "grid_spacing_pct": spacing},
                    ))
                    break
        return signals

    def describe(self) -> dict:
        return {
            "name": self.name,
            "display_name": "Grid Trading",
            "description": (
                "Divides a price range into a grid of evenly spaced levels. "
                "A BUY order fires when price drops through a grid line, "
                "and a SELL fires when it rises through the next line above. "
                "Ideal for sideways/oscillating markets."
            ),
            "params": self.params,
            "signals": ["BUY when price crosses down through a grid level",
                        "SELL when price crosses up through a grid level"],
            "best_for": "Sideways / oscillating markets",
            "weaknesses": "Can accumulate large losing positions in strong trends",
        }
