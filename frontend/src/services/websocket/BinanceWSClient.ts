import { NormalizedCandle } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class BinanceWSClient {
  private eventSource: EventSource | null = null;
  private symbol: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private isIntentionallyClosed = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private backendUrl = 'http://localhost:8000/exchanges/binance/klines';

  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    console.log(`[Binance US] 🔌 Connecting via backend proxy for ${symbol}`);
    this.symbol = symbol;
    this.onCandleCallback = onCandle;
    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      this._openEventSource(symbol, resolve, reject);
    });
  }

  private _openEventSource(
    symbol: string,
    resolve?: () => void,
    reject?: (err: unknown) => void,
  ): void {
    const url = `${this.backendUrl}/${symbol.toUpperCase()}`;
    console.log(`[Binance US] 📡 EventSource → ${url}`);

    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      console.log(`[Binance US] ✅ SSE connection open`);
      this.reconnectAttempts = 0;
      resolve?.();
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.status === 'connected') {
          console.log(`[Binance US] ✅ Backend proxy connected`);
          return;
        }

        if (data.error) {
          console.error(`[Binance US] ❌ Backend error: ${data.error}`);
          return;
        }

        // Normalize candle
        const candle: NormalizedCandle = {
          symbol: data.symbol,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: data.volume,
          timestamp: new Date(data.timestamp),
          timeframe: Timeframe.M1,
          broker: 'binance',
          assetClass: 'crypto',
        };

        console.log(`[Binance US] 🕯️ Candle: O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
        this.onCandleCallback?.(candle);
      } catch (err) {
        console.error(`[Binance US] ❌ Failed to parse SSE message:`, err);
      }
    };

    this.eventSource.onerror = (err) => {
      console.error(`[Binance US] ❌ SSE error:`, err);
      this.eventSource?.close();
      this.eventSource = null;
      reject?.(err);
      this._attemptReconnect();
    };
  }

  private _attemptReconnect(): void {
    if (this.isIntentionallyClosed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[Binance US] ❌ Max reconnect attempts reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`[Binance US] 🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      if (this.symbol && this.onCandleCallback && !this.isIntentionallyClosed) {
        this._openEventSource(this.symbol);
      }
    }, delay);
  }

  disconnect(): void {
    console.log(`[Binance US] 🔌 Disconnect called`);
    this.isIntentionallyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.eventSource?.close();
    this.eventSource = null;
    this.onCandleCallback = null;
    this.symbol = null;
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
