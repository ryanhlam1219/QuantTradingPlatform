"""
Bollinger Bands Strategy.

BUY  when price closes below the lower band (oversold squeeze).
SELL when price closes above the upper band (overbought expansion).

Optional: %B and bandwidth indicator metadata included in signals.
"""
import math
from datetime import timezone

from app.strategies.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.trade import TradeSignal, OrderSide


def _bollinger(closes: list[float], period: int, std_dev: float):
    """Returns (upper, middle, lower) band lists."""
    upper = []
    middle = []
    lower = []

    for i in range(len(closes)):
        if i < period - 1:
            upper.append(None)
            middle.append(None)
            lower.append(None)
        else:
            window = closes[i - period + 1 : i + 1]
            sma = sum(window) / period
            variance = sum((p - sma) ** 2 for p in window) / period
            sd = math.sqrt(variance)
            middle.append(sma)
            upper.append(sma + std_dev * sd)
            lower.append(sma - std_dev * sd)

    return upper, middle, lower


class BollingerBandsStrategy(BaseStrategy):

    @property
    def name(self) -> str:
        return "bollinger_bands"

    @property
    def description(self) -> str:
        return (
            "Uses Bollinger Bands (SMA ± N standard deviations) to identify price "
            "extremes. Generates a BUY signal when price closes below the lower band "
            "and a SELL when price closes above the upper band. The bandwidth indicator "
            "can also detect volatility squeezes that often precede large moves."
        )

    @property
    def default_params(self) -> dict:
        return {
            "period": 20,
            "std_dev": 2.0,
        }

    @property
    def param_schema(self) -> dict:
        return {
            "period":  {"type": "int",   "min": 5,   "max": 100,  "default": 20},
            "std_dev": {"type": "float", "min": 0.5, "max": 4.0,  "default": 2.0},
        }

    def generate_signals(self, series: CandleSeries) -> list[TradeSignal]:
        period = self.params["period"]
        std_dev = self.params["std_dev"]

        closes = series.closes
        if len(closes) < period + 1:
            return []

        upper, middle, lower = _bollinger(closes, period, std_dev)
        signals: list[TradeSignal] = []

        for i in range(1, len(closes)):
            u, m, l = upper[i], middle[i], lower[i]
            if None in (u, m, l):
                continue

            price = closes[i]
            candle = series.candles[i]
            ts = candle.timestamp
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            bandwidth = (u - l) / m if m else 0
            pct_b = (price - l) / (u - l) if (u - l) else 0.5

            # Price closes below lower band → oversold → BUY
            if price < l:
                confidence = min(abs(price - l) / (u - l), 1.0)
                signals.append(TradeSignal(
                    symbol=series.symbol,
                    side=OrderSide.BUY,
                    strategy_name=self.name,
                    confidence=confidence,
                    reason=f"Price {price:.2f} closed below lower band {l:.2f}",
                    timestamp=ts,
                    metadata={
                        "upper_band": u, "middle_band": m, "lower_band": l,
                        "bandwidth": bandwidth, "pct_b": pct_b,
                    },
                ))

            # Price closes above upper band → overbought → SELL
            elif price > u:
                confidence = min(abs(price - u) / (u - l), 1.0)
                signals.append(TradeSignal(
                    symbol=series.symbol,
                    side=OrderSide.SELL,
                    strategy_name=self.name,
                    confidence=confidence,
                    reason=f"Price {price:.2f} closed above upper band {u:.2f}",
                    timestamp=ts,
                    metadata={
                        "upper_band": u, "middle_band": m, "lower_band": l,
                        "bandwidth": bandwidth, "pct_b": pct_b,
                    },
                ))

        return signals
