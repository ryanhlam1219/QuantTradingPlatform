import { Timeframe } from './Timeframe';

// Normalized candle matching backend Candle model
export interface NormalizedCandle {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
  timeframe: Timeframe;  // Assuming Timeframe enum exists in frontend/src/types/Timeframe.ts
  broker: 'binance' | 'kraken' | 'gemini';
  assetClass: 'crypto';
}

// Per-exchange raw message types
export interface BinanceKlineMessage {
  k: {
    t: number;        // Kline start time
    T: number;        // Kline close time
    s: string;        // Symbol
    i: string;        // Interval
    o: string;        // Open
    h: string;        // High
    l: string;        // Low
    c: string;        // Close
    v: string;        // Volume
    x: boolean;       // Is kline closed
  };
}

export interface KrakenOHLCMessage {
  [key: string]: [
    timestamp: number,
    open: string,
    high: string,
    low: string,
    close: string,
    vwap: string,
    volume: string,
    count: number
  ];
}

export interface GeminiCandleMessage {
  type: string;
  symbol: string;
  changes: Array<{
    time: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
}

// UI state for each exchange
export interface ExchangeCandles {
  binance: NormalizedCandle[];
  kraken: NormalizedCandle[];
  gemini: NormalizedCandle[];
}

// Connection status per exchange
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ExchangeStatus {
  binance: ConnectionStatus;
  kraken: ConnectionStatus;
  gemini: ConnectionStatus;
}
