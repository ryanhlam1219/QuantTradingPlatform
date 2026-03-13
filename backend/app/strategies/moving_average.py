"""
Moving Average Crossover Strategy.

BUY  when fast MA crosses ABOVE slow MA (golden cross).
SELL when fast MA crosses BELOW slow MA (death cross).

Supports both SMA and EMA variants.
"""
import numpy as np
from datetime import timezone

from app.strategies.base import BaseStrategy
from app.models.candlestick import CandleSeries
from app.models.trade import TradeSignal, OrderSide


def _sma(prices: list[float], period: int) -> list[float | None]:
    result: list[float | None] = [None] * (period - 1)
    for i in range(period - 1, len(prices)):
        result.append(sum(prices[i - period + 1 : i + 1]) / period)
    return result


def _ema(prices: list[float], period: int) -> list[float | None]:
    result: list[float | None] = [None] * (period - 1)
    if len(prices) < period:
        return [None] * len(prices)
    k = 2 / (period + 1)
    ema = sum(prices[:period]) / period
    result.append(ema)
    for price in prices[period:]:
        ema = price * k + ema * (1 - k)
        result.append(ema)
    return result


class MovingAverageCrossoverStrategy(BaseStrategy):

    @property
    def name(self) -> str:
        return "moving_average_crossover"

    @property
    def description(self) -> str:
        return (
            "Generates a BUY signal when the fast moving average crosses above "
            "the slow moving average (golden cross), and a SELL signal when it "
            "crosses below (death cross). Supports both SMA and EMA variants. "
            "Best suited for trending markets; prone to whipsaws in ranging conditions."
        )

    @property
    def default_params(self) -> dict:
        return {
            "fast_period": 10,
            "slow_period": 30,
            "ma_type": "ema",  # "sma" or "ema"
        }

    @property
    def param_schema(self) -> dict:
        return {
            "fast_period": {"type": "int", "min": 2, "max": 50, "default": 10},
            "slow_period": {"type": "int", "min": 5, "max": 200, "default": 30},
            "ma_type": {"type": "select", "options": ["sma", "ema"], "default": "ema"},
        }

    def generate_signals(self, series: CandleSeries) -> list[TradeSignal]:
        fast = self.params["fast_period"]
        slow = self.params["slow_period"]
        ma_fn = _ema if self.params["ma_type"] == "ema" else _sma

        closes = series.closes
        if len(closes) < slow + 1:
            return []

        fast_ma = ma_fn(closes, fast)
        slow_ma = ma_fn(closes, slow)

        signals: list[TradeSignal] = []
        for i in range(1, len(closes)):
            prev_fast = fast_ma[i - 1]
            prev_slow = slow_ma[i - 1]
            curr_fast = fast_ma[i]
            curr_slow = slow_ma[i]

            if None in (prev_fast, prev_slow, curr_fast, curr_slow):
                continue

            candle = series.candles[i]
            ts = candle.timestamp
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            # Golden cross: fast crosses above slow
            if prev_fast <= prev_slow and curr_fast > curr_slow:
                signals.append(
                    TradeSignal(
                        symbol=series.symbol,
                        side=OrderSide.BUY,
                        strategy_name=self.name,
                        confidence=min((curr_fast - curr_slow) / curr_slow * 100, 1.0),
                        reason=f"{self.params['ma_type'].upper()}({fast}) crossed above {self.params['ma_type'].upper()}({slow})",
                        timestamp=ts,
                        metadata={"fast_ma": curr_fast, "slow_ma": curr_slow},
                    )
                )
            # Death cross: fast crosses below slow
            elif prev_fast >= prev_slow and curr_fast < curr_slow:
                signals.append(
                    TradeSignal(
                        symbol=series.symbol,
                        side=OrderSide.SELL,
                        strategy_name=self.name,
                        confidence=min((curr_slow - curr_fast) / curr_slow * 100, 1.0),
                        reason=f"{self.params['ma_type'].upper()}({fast}) crossed below {self.params['ma_type'].upper()}({slow})",
                        timestamp=ts,
                        metadata={"fast_ma": curr_fast, "slow_ma": curr_slow},
                    )
                )

        return signals
