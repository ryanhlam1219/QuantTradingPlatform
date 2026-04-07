import { NormalizedCandle } from '../types/ExchangeComparison';
import { Timeframe } from '../types/Timeframe';

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  [Timeframe.M1]: 1,
  [Timeframe.M5]: 5,
  [Timeframe.M15]: 15,
  [Timeframe.M30]: 30,
  [Timeframe.H1]: 60,
  [Timeframe.H4]: 240,
  [Timeframe.D1]: 1440,
  [Timeframe.W1]: 10080,
};

/**
 * Aggregate 1-minute candles into a target timeframe.
 * Groups consecutive candles and computes OHLCV for each group.
 */
export function aggregateCandles(
  candles: NormalizedCandle[],
  targetTimeframe: Timeframe
): NormalizedCandle[] {
  if (candles.length === 0) return [];
  if (targetTimeframe === Timeframe.M1) return candles;

  const targetMinutes = TIMEFRAME_MINUTES[targetTimeframe];
  const grouped: NormalizedCandle[][] = [];
  let currentGroup: NormalizedCandle[] = [];

  for (const candle of candles) {
    currentGroup.push(candle);

    if (currentGroup.length === targetMinutes) {
      grouped.push(currentGroup);
      currentGroup = [];
    }
  }

  // Don't include partial groups

  return grouped.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    const highValues = group.map((c) => c.high);
    const lowValues = group.map((c) => c.low);

    return {
      symbol: first.symbol,
      open: first.open,
      high: Math.max(...highValues),
      low: Math.min(...lowValues),
      close: last.close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
      timestamp: first.timestamp,
      timeframe: targetTimeframe,
      broker: first.broker,
      assetClass: first.assetClass,
    };
  });
}
