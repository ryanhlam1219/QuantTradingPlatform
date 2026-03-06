"""
MACD (Moving Average Convergence Divergence) Strategy.

BUY  when MACD line crosses above the signal line (bullish crossover).
SELL when MACD line crosses below the signal line (bearish crossover).

Histogram zero-line crossover confirmation is included as metadata.
"""
from datetime import timezone

from app.strategies.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.trade import TradeSignal, OrderSide


def _ema(prices: list[float], period: int) -> list[float | None]:
    if len(prices) < period:
        return [None] * len(prices)
    k = 2 / (period + 1)
    result: list[float | None] = [None] * (period - 1)
    ema = sum(prices[:period]) / period
    result.append(ema)
    for p in prices[period:]:
        ema = p * k + ema * (1 - k)
        result.append(ema)
    return result


class MACDStrategy(BaseStrategy):

    @property
    def name(self) -> str:
        return "macd"

    @property
    def description(self) -> str:
        return (
            "MACD (Moving Average Convergence Divergence) measures momentum by "
            "computing the difference between a fast and slow EMA (the MACD line). "
            "A signal line (EMA of MACD) is then applied. BUY signals fire when MACD "
            "crosses above the signal line; SELL signals fire on a bearish crossover. "
            "The histogram (MACD − signal) shows the strength of momentum."
        )

    @property
    def default_params(self) -> dict:
        return {
            "fast_period":   12,
            "slow_period":   26,
            "signal_period":  9,
        }

    @property
    def param_schema(self) -> dict:
        return {
            "fast_period":   {"type": "int", "min": 2,  "max": 50,  "default": 12},
            "slow_period":   {"type": "int", "min": 5,  "max": 200, "default": 26},
            "signal_period": {"type": "int", "min": 2,  "max": 50,  "default": 9},
        }

    def generate_signals(self, series: CandleSeries) -> list[TradeSignal]:
        fast   = self.params["fast_period"]
        slow   = self.params["slow_period"]
        signal = self.params["signal_period"]

        closes = series.closes
        min_len = slow + signal + 1
        if len(closes) < min_len:
            return []

        fast_ema = _ema(closes, fast)
        slow_ema = _ema(closes, slow)

        # MACD line = fast EMA − slow EMA
        macd_line: list[float | None] = []
        for f, s in zip(fast_ema, slow_ema):
            if f is None or s is None:
                macd_line.append(None)
            else:
                macd_line.append(f - s)

        # Signal line = EMA of MACD line
        macd_values = [v for v in macd_line if v is not None]
        signal_ema_raw = _ema(macd_values, signal)

        # Align signal_ema back to full index
        none_count = sum(1 for v in macd_line if v is None)
        signal_line: list[float | None] = [None] * none_count
        signal_none = [None] * (signal - 1)
        signal_line.extend(signal_none)
        signal_line.extend(signal_ema_raw[signal - 1:])

        signals: list[TradeSignal] = []
        for i in range(1, len(macd_line)):
            prev_macd = macd_line[i - 1]
            curr_macd = macd_line[i]
            prev_sig  = signal_line[i - 1] if i - 1 < len(signal_line) else None
            curr_sig  = signal_line[i] if i < len(signal_line) else None

            if None in (prev_macd, curr_macd, prev_sig, curr_sig):
                continue

            histogram = curr_macd - curr_sig
            candle = series.candles[i]
            ts = candle.timestamp
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            # Bullish crossover
            if prev_macd <= prev_sig and curr_macd > curr_sig:
                signals.append(TradeSignal(
                    symbol=series.symbol,
                    side=OrderSide.BUY,
                    strategy_name=self.name,
                    confidence=min(abs(histogram) / (abs(curr_sig) + 1e-9), 1.0),
                    reason=f"MACD({fast},{slow},{signal}) crossed above signal line",
                    timestamp=ts,
                    metadata={
                        "macd": curr_macd, "signal": curr_sig, "histogram": histogram,
                    },
                ))

            # Bearish crossover
            elif prev_macd >= prev_sig and curr_macd < curr_sig:
                signals.append(TradeSignal(
                    symbol=series.symbol,
                    side=OrderSide.SELL,
                    strategy_name=self.name,
                    confidence=min(abs(histogram) / (abs(curr_sig) + 1e-9), 1.0),
                    reason=f"MACD({fast},{slow},{signal}) crossed below signal line",
                    timestamp=ts,
                    metadata={
                        "macd": curr_macd, "signal": curr_sig, "histogram": histogram,
                    },
                ))

        return signals
