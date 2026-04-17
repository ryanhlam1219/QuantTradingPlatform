import { describe, test, expect } from 'vitest';
import { aggregateCandles } from '../candleAggregator';
import { Timeframe } from '../../types/Timeframe';
import { NormalizedCandle } from '../../types/ExchangeComparison';

describe('aggregateCandles', () => {
  // Helper to create test candle
  const createCandle = (closePrice: number, volumeAmount: number, minuteOffset: number): NormalizedCandle => ({
    symbol: 'BTCUSD',
    open: closePrice,
    high: closePrice + 5,
    low: closePrice - 15,
    close: closePrice,
    volume: volumeAmount,
    timestamp: new Date(new Date('2026-04-07T15:00:00Z').getTime() + minuteOffset * 60000),
    timeframe: Timeframe.M1,
    broker: 'binance',
    assetClass: 'crypto',
  });

  test('aggregates 5 x 1m candles into 1 x 5m candle', () => {
    const input = [
      createCandle(45000, 10, 0),
      createCandle(45010, 20, 1),
      createCandle(45005, 15, 2),
      createCandle(45020, 18, 3),
      createCandle(45015, 12, 4),
    ];

    const result = aggregateCandles(input, Timeframe.M5);

    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(45000);      // open of first
    expect(result[0].high).toBe(45025);      // max high
    expect(result[0].low).toBe(44985);       // min low
    expect(result[0].close).toBe(45015);     // close of last
    expect(result[0].volume).toBe(75);       // sum of volumes
    expect(result[0].timeframe).toBe(Timeframe.M5);
  });

  test('returns empty array if input is empty', () => {
    const result = aggregateCandles([], Timeframe.M5);
    expect(result).toEqual([]);
  });

  test('returns single candle unchanged for M1 timeframe', () => {
    const input = [createCandle(45000, 10, 0)];
    const result = aggregateCandles(input, Timeframe.M1);
    expect(result).toEqual(input);
  });

  test('aggregates 15 x 1m candles into 3 x 5m candles', () => {
    const input = Array.from({ length: 15 }, (_, i) =>
      createCandle(45000 + i, 10, i)
    );

    const result = aggregateCandles(input, Timeframe.M5);

    expect(result).toHaveLength(3);
    expect(result[0].open).toBe(45000);    // First group
    expect(result[1].open).toBe(45005);    // Second group
    expect(result[2].open).toBe(45010);    // Third group
  });
});
