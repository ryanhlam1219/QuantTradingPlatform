"""
Bollinger Bands Strategy.
BUY when price closes below lower band (oversold).
SELL when price closes above upper band (overbought).
"""
import numpy as np
from app.algorithms.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.signal import Signal, SignalType


class BollingerBandsStrategy(BaseStrategy):
    name = "bollinger_bands"
    description = "Volatility-based strategy using Bollinger Bands"
    default_params = {
        "period": 20,
        "std_dev": 2.0,
    }

    def _calc_bands(self, closes: list[float], period: int, num_std: float):
        arr = np.array(closes, dtype=float)
        n = len(arr)
        upper = np.full(n, np.nan)
        middle = np.full(n, np.nan)
        lower = np.full(n, np.nan)
        bandwidth = np.full(n, np.nan)

        for i in range(period - 1, n):
            window = arr[i - period + 1 : i + 1]
            sma = window.mean()
            std = window.std(ddof=1)
            middle[i] = sma
            upper[i] = sma + num_std * std
            lower[i] = sma - num_std * std
            bandwidth[i] = (upper[i] - lower[i]) / sma  # Bandwidth %

        return upper, middle, lower, bandwidth

    def generate_signals(self, series: CandleSeries) -> list[Signal]:
        closes = series.closes
        timestamps = series.timestamps
        upper, middle, lower, bandwidth = self._calc_bands(
            closes, self.params["period"], self.params["std_dev"]
        )
        signals = []

        for i in range(1, len(closes)):
            if np.isnan(lower[i]) or np.isnan(upper[i]):
                continue

            price = closes[i]
            prev_price = closes[i - 1]

            # Price re-enters from below lower band → BUY
            if prev_price <= lower[i - 1] and price > lower[i]:
                confidence = min(1.0, (lower[i] - price) / lower[i] + 0.5) if lower[i] > 0 else 0.5
                signals.append(Signal(
                    symbol=series.symbol, signal_type=SignalType.BUY,
                    price=price, timestamp=timestamps[i],
                    strategy=self.name, confidence=abs(confidence),
                    metadata={
                        "upper": round(upper[i], 4),
                        "middle": round(middle[i], 4),
                        "lower": round(lower[i], 4),
                        "bandwidth": round(bandwidth[i], 4),
                    },
                ))
            # Price re-enters from above upper band → SELL
            elif prev_price >= upper[i - 1] and price < upper[i]:
                confidence = min(1.0, (price - upper[i]) / upper[i] + 0.5) if upper[i] > 0 else 0.5
                signals.append(Signal(
                    symbol=series.symbol, signal_type=SignalType.SELL,
                    price=price, timestamp=timestamps[i],
                    strategy=self.name, confidence=abs(confidence),
                    metadata={
                        "upper": round(upper[i], 4),
                        "middle": round(middle[i], 4),
                        "lower": round(lower[i], 4),
                        "bandwidth": round(bandwidth[i], 4),
                    },
                ))
        return signals

    def describe(self) -> dict:
        return {
            "name": self.name,
            "display_name": "Bollinger Bands",
            "description": (
                "Places bands around a moving average at ±2 standard deviations. "
                "When price touches the lower band, it may be oversold (BUY). "
                "When it touches the upper band, it may be overbought (SELL). "
                "Bandwidth indicates current volatility level."
            ),
            "params": self.params,
            "signals": ["BUY on lower band re-entry", "SELL on upper band re-entry"],
            "best_for": "Volatile markets with clear mean-reversion",
            "weaknesses": "Bands widen in volatile markets, reducing signal accuracy",
        }
