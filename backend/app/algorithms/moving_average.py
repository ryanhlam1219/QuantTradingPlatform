"""
Moving Average Crossover Strategy.
Generates a BUY when fast MA crosses above slow MA,
and a SELL when fast MA crosses below slow MA.
"""
import numpy as np
from datetime import datetime
from app.algorithms.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.signal import Signal, SignalType


class MovingAverageCrossover(BaseStrategy):
    name = "moving_average_crossover"
    description = "Golden/Death Cross using two moving averages"
    default_params = {
        "fast_period": 20,
        "slow_period": 50,
        "ma_type": "ema",  # "sma" or "ema"
    }

    def _calc_sma(self, prices: list[float], period: int) -> np.ndarray:
        arr = np.array(prices, dtype=float)
        result = np.full_like(arr, np.nan)
        for i in range(period - 1, len(arr)):
            result[i] = arr[i - period + 1 : i + 1].mean()
        return result

    def _calc_ema(self, prices: list[float], period: int) -> np.ndarray:
        arr = np.array(prices, dtype=float)
        result = np.full_like(arr, np.nan)
        k = 2 / (period + 1)
        # Seed with SMA
        if len(arr) >= period:
            result[period - 1] = arr[:period].mean()
            for i in range(period, len(arr)):
                result[i] = arr[i] * k + result[i - 1] * (1 - k)
        return result

    def generate_signals(self, series: CandleSeries) -> list[Signal]:
        closes = series.closes
        timestamps = series.timestamps
        fast = self.params["fast_period"]
        slow = self.params["slow_period"]
        ma_fn = self._calc_ema if self.params["ma_type"] == "ema" else self._calc_sma

        fast_ma = ma_fn(closes, fast)
        slow_ma = ma_fn(closes, slow)

        signals = []
        for i in range(1, len(closes)):
            if np.isnan(fast_ma[i]) or np.isnan(slow_ma[i]):
                continue
            if np.isnan(fast_ma[i - 1]) or np.isnan(slow_ma[i - 1]):
                continue

            # Golden cross: fast crosses above slow
            if fast_ma[i - 1] <= slow_ma[i - 1] and fast_ma[i] > slow_ma[i]:
                signals.append(Signal(
                    symbol=series.symbol,
                    signal_type=SignalType.BUY,
                    price=closes[i],
                    timestamp=timestamps[i],
                    strategy=self.name,
                    confidence=min(1.0, (fast_ma[i] - slow_ma[i]) / slow_ma[i] * 10),
                    metadata={"fast_ma": fast_ma[i], "slow_ma": slow_ma[i]},
                ))
            # Death cross: fast crosses below slow
            elif fast_ma[i - 1] >= slow_ma[i - 1] and fast_ma[i] < slow_ma[i]:
                signals.append(Signal(
                    symbol=series.symbol,
                    signal_type=SignalType.SELL,
                    price=closes[i],
                    timestamp=timestamps[i],
                    strategy=self.name,
                    confidence=min(1.0, (slow_ma[i] - fast_ma[i]) / slow_ma[i] * 10),
                    metadata={"fast_ma": fast_ma[i], "slow_ma": slow_ma[i]},
                ))
        return signals

    def describe(self) -> dict:
        return {
            "name": self.name,
            "display_name": "Moving Average Crossover",
            "description": (
                "Identifies trend reversals by tracking when a faster moving average "
                "crosses a slower one. A 'golden cross' (fast above slow) signals a "
                "bullish trend; a 'death cross' (fast below slow) signals bearish."
            ),
            "params": self.params,
            "signals": ["BUY on golden cross", "SELL on death cross"],
            "best_for": "Trending markets",
            "weaknesses": "Lagging indicator; whipsaws in sideways markets",
        }
