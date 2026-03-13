"""
MACD (Moving Average Convergence Divergence) Strategy.
BUY when MACD line crosses above signal line.
SELL when MACD line crosses below signal line.
"""
import numpy as np
from app.algorithms.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.signal import Signal, SignalType


class MACDStrategy(BaseStrategy):
    name = "macd"
    description = "Trend-following momentum using MACD"
    default_params = {
        "fast_period": 12,
        "slow_period": 26,
        "signal_period": 9,
    }

    def _ema(self, arr: np.ndarray, period: int) -> np.ndarray:
        result = np.full_like(arr, np.nan)
        k = 2 / (period + 1)
        start = period - 1
        if len(arr) < period:
            return result
        result[start] = arr[:period].mean()
        for i in range(start + 1, len(arr)):
            result[i] = arr[i] * k + result[i - 1] * (1 - k)
        return result

    def _calc_macd(self, closes: list[float]):
        arr = np.array(closes, dtype=float)
        fast = self.params["fast_period"]
        slow = self.params["slow_period"]
        signal_p = self.params["signal_period"]

        ema_fast = self._ema(arr, fast)
        ema_slow = self._ema(arr, slow)
        macd_line = ema_fast - ema_slow

        # Signal line = EMA of MACD (ignoring NaNs)
        signal_line = np.full_like(macd_line, np.nan)
        first_valid = slow - 1
        if len(macd_line) > first_valid + signal_p:
            valid_macd = macd_line[first_valid:]
            valid_signal = self._ema(valid_macd, signal_p)
            signal_line[first_valid:] = valid_signal

        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram

    def generate_signals(self, series: CandleSeries) -> list[Signal]:
        closes = series.closes
        timestamps = series.timestamps
        macd, signal, histogram = self._calc_macd(closes)
        signals = []

        for i in range(1, len(closes)):
            if np.isnan(macd[i]) or np.isnan(signal[i]):
                continue
            if np.isnan(macd[i - 1]) or np.isnan(signal[i - 1]):
                continue

            # Bullish crossover
            if macd[i - 1] <= signal[i - 1] and macd[i] > signal[i]:
                conf = min(1.0, abs(histogram[i]) / (abs(closes[i]) * 0.01 + 1e-9))
                signals.append(Signal(
                    symbol=series.symbol, signal_type=SignalType.BUY,
                    price=closes[i], timestamp=timestamps[i],
                    strategy=self.name, confidence=conf,
                    metadata={"macd": round(macd[i], 4), "signal": round(signal[i], 4),
                               "histogram": round(histogram[i], 4)},
                ))
            # Bearish crossover
            elif macd[i - 1] >= signal[i - 1] and macd[i] < signal[i]:
                conf = min(1.0, abs(histogram[i]) / (abs(closes[i]) * 0.01 + 1e-9))
                signals.append(Signal(
                    symbol=series.symbol, signal_type=SignalType.SELL,
                    price=closes[i], timestamp=timestamps[i],
                    strategy=self.name, confidence=conf,
                    metadata={"macd": round(macd[i], 4), "signal": round(signal[i], 4),
                               "histogram": round(histogram[i], 4)},
                ))
        return signals

    def describe(self) -> dict:
        return {
            "name": self.name,
            "display_name": "MACD",
            "description": (
                "Tracks the relationship between two EMAs. The MACD line is the "
                "difference between a 12-period and 26-period EMA. A 9-period signal "
                "line smooths it. Crossovers between MACD and signal identify momentum shifts."
            ),
            "params": self.params,
            "signals": ["BUY on MACD cross above signal", "SELL on MACD cross below signal"],
            "best_for": "Trending markets with clear momentum",
            "weaknesses": "Lags price, poor in choppy/sideways markets",
        }
