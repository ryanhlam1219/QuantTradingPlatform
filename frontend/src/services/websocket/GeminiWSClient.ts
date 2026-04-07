import { NormalizedCandle } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class GeminiWSClient {
  private ws: WebSocket | null = null;
  private url = 'wss://api.sandbox.gemini.com/v1/marketdata'; // Use sandbox for testing
  private symbol: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;

  /**
   * Connect and subscribe to candles feed for a symbol.
   * @param symbol - e.g., "btcusd" or "ethusd" (lowercase)
   * @param onCandle - Callback fired when a 1m candle arrives
   */
  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    this.symbol = symbol.toLowerCase();
    this.onCandleCallback = onCandle;

    return new Promise((resolve, reject) => {
      try {
        // Gemini WS URL includes the symbol
        const wsUrl = `${this.url}/${this.symbol}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log(`Gemini WS connected: ${symbol}`);
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(event.data);

            // Gemini sends heartbeats (type: 'heartbeat')
            if (message.type === 'heartbeat') {
              return;
            }

            // Candles come as type: 'candles'
            if (message.type === 'candles' && message.changes && Array.isArray(message.changes)) {
              // Each entry is [time, open, high, low, close, volume]
              for (const change of message.changes) {
                const [time, open, high, low, close, volume] = change;
                const candle: NormalizedCandle = {
                  symbol: this.symbol!.toUpperCase(),
                  open: parseFloat(open),
                  high: parseFloat(high),
                  low: parseFloat(low),
                  close: parseFloat(close),
                  volume: parseFloat(volume),
                  timestamp: new Date(parseInt(time) * 1000),
                  timeframe: Timeframe.M1,
                  broker: 'gemini',
                  assetClass: 'crypto',
                };
                this.onCandleCallback?.(candle);
              }
            }
          } catch (err) {
            console.error('Gemini WS message parse error:', err);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('Gemini WS error:', err);
          reject(err);
        };

        this.ws.onclose = () => {
          console.log('Gemini WS closed');
          this.attemptReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Attempt to reconnect with exponential backoff.
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Gemini WS: max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`Gemini WS: reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.symbol && this.onCandleCallback) {
        this.connect(this.symbol, this.onCandleCallback).catch((err) => {
          console.error('Gemini WS reconnect failed:', err);
        });
      }
    }, delay);
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get connection status.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
