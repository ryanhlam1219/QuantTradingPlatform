"""
RSI (Relative Strength Index) Strategy.

BUY  when RSI crosses above the oversold threshold (default 30).
SELL when RSI crosses below the overbought threshold (default 70).

Mean-reversion approach: assumes price will snap back after extremes.
"""
from datetime import timezone

from app.strategies.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.trade import TradeSignal, OrderSide


def _rsi(closes: list[float], period: int) -> list[float | None]:
    """Wilder's smoothed RSI."""
    if len(closes) < period + 1:
        return [None] * len(closes)

    result: list[float | None] = [None] * period

    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(d, 0) for d in deltas]
    losses = [abs(min(d, 0)) for d in deltas]

    # Initial average over first period
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    def _rsi_val(avg_g, avg_l):
        if avg_l == 0:
            return 100.0
        rs = avg_g / avg_l
        return 100 - (100 / (1 + rs))

    result.append(_rsi_val(avg_gain, avg_loss))

    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        result.append(_rsi_val(avg_gain, avg_loss))

    return result


class RSIStrategy(BaseStrategy):

    @property
    def name(self) -> str:
        return "rsi"

    @property
    def description(self) -> str:
        return (
            "Uses the Relative Strength Index (RSI) to identify overbought and oversold "
            "conditions. Generates a BUY signal when RSI rises back above the oversold "
            "threshold and a SELL when it falls back below the overbought threshold. "
            "A mean-reversion strategy; works best in range-bound markets."
        )

    @property
    def default_params(self) -> dict:
        return {
            "period": 14,
            "oversold": 30,
            "overbought": 70,
        }

    @property
    def param_schema(self) -> dict:
        return {
            "period":     {"type": "int",   "min": 2,   "max": 50,  "default": 14},
            "oversold":   {"type": "float", "min": 10,  "max": 45,  "default": 30},
            "overbought": {"type": "float", "min": 55,  "max": 90,  "default": 70},
        }

    def generate_signals(self, series: CandleSeries) -> list[TradeSignal]:
        period = self.params["period"]
        oversold = self.params["oversold"]
        overbought = self.params["overbought"]

        closes = series.closes
        if len(closes) < period + 2:
            return []

        rsi_values = _rsi(closes, period)
        signals: list[TradeSignal] = []

        for i in range(1, len(rsi_values)):
            prev_rsi = rsi_values[i - 1]
            curr_rsi = rsi_values[i]
            if prev_rsi is None or curr_rsi is None:
                continue

            candle = series.candles[i]
            ts = candle.timestamp
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            # Cross above oversold line → BUY
            if prev_rsi <= oversold and curr_rsi > oversold:
                confidence = min((curr_rsi - oversold) / oversold, 1.0)
                signals.append(TradeSignal(
                    symbol=series.symbol,
                    side=OrderSide.BUY,
                    strategy_name=self.name,
                    confidence=confidence,
                    reason=f"RSI({period}) crossed above oversold level {oversold} (RSI={curr_rsi:.1f})",
                    timestamp=ts,
                    metadata={"rsi": curr_rsi, "oversold": oversold},
                ))

            # Cross below overbought line → SELL
            elif prev_rsi >= overbought and curr_rsi < overbought:
                confidence = min((overbought - curr_rsi) / (100 - overbought), 1.0)
                signals.append(TradeSignal(
                    symbol=series.symbol,
                    side=OrderSide.SELL,
                    strategy_name=self.name,
                    confidence=confidence,
                    reason=f"RSI({period}) crossed below overbought level {overbought} (RSI={curr_rsi:.1f})",
                    timestamp=ts,
                    metadata={"rsi": curr_rsi, "overbought": overbought},
                ))

        return signals
