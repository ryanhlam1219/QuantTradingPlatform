"""
RSI (Relative Strength Index) Strategy.
BUY when RSI crosses above oversold threshold (default 30).
SELL when RSI crosses below overbought threshold (default 70).
"""
import numpy as np
from app.algorithms.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.signal import Signal, SignalType


class RSIStrategy(BaseStrategy):
    name = "rsi"
    description = "Mean-reversion using Relative Strength Index"
    default_params = {
        "period": 14,
        "oversold": 30,
        "overbought": 70,
    }

    def _calc_rsi(self, closes: list[float], period: int) -> np.ndarray:
        arr = np.array(closes, dtype=float)
        deltas = np.diff(arr)
        result = np.full(len(arr), np.nan)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)

        if len(gains) < period:
            return result

        avg_gain = gains[:period].mean()
        avg_loss = losses[:period].mean()

        for i in range(period, len(deltas)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
            rs = avg_gain / avg_loss if avg_loss != 0 else float("inf")
            result[i + 1] = 100 - (100 / (1 + rs))

        return result

    def generate_signals(self, series: CandleSeries) -> list[Signal]:
        closes = series.closes
        timestamps = series.timestamps
        rsi = self._calc_rsi(closes, self.params["period"])
        oversold = self.params["oversold"]
        overbought = self.params["overbought"]
        signals = []

        for i in range(1, len(closes)):
            if np.isnan(rsi[i]) or np.isnan(rsi[i - 1]):
                continue
            # Cross above oversold → BUY
            if rsi[i - 1] <= oversold and rsi[i] > oversold:
                confidence = (oversold - min(rsi[i - 1], rsi[i])) / oversold
                signals.append(Signal(
                    symbol=series.symbol, signal_type=SignalType.BUY,
                    price=closes[i], timestamp=timestamps[i],
                    strategy=self.name, confidence=min(1.0, confidence),
                    metadata={"rsi": round(rsi[i], 2)},
                ))
            # Cross below overbought → SELL
            elif rsi[i - 1] >= overbought and rsi[i] < overbought:
                confidence = (max(rsi[i - 1], rsi[i]) - overbought) / (100 - overbought)
                signals.append(Signal(
                    symbol=series.symbol, signal_type=SignalType.SELL,
                    price=closes[i], timestamp=timestamps[i],
                    strategy=self.name, confidence=min(1.0, confidence),
                    metadata={"rsi": round(rsi[i], 2)},
                ))
        return signals

    def describe(self) -> dict:
        return {
            "name": self.name,
            "display_name": "RSI Strategy",
            "description": (
                "Measures momentum by comparing recent gains vs losses on a 0-100 scale. "
                "Signals a BUY when the asset is oversold (RSI < 30) and recovering, "
                "and a SELL when overbought (RSI > 70) and weakening."
            ),
            "params": self.params,
            "signals": [f"BUY on RSI cross above {self.params['oversold']}",
                        f"SELL on RSI cross below {self.params['overbought']}"],
            "best_for": "Range-bound / mean-reverting markets",
            "weaknesses": "Can stay overbought/oversold in strong trends",
        }
