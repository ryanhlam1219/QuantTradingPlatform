import { NormalizedCandle, BinanceKlineMessage } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class BinanceWSClient {
  private ws: WebSocket | null = null;
  private url = 'wss://stream.binance.us:9443/ws';
  private symbol: string | null = null;
  private streamName: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000; // 5 seconds

  /**
   * Connect and subscribe to 1-minute kline stream for a symbol.
   * @param symbol - e.g., "BTCUSDT" or "ETHUSDT"
   * @param onCandle - Callback fired when a 1m candle closes
   */
  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    this.symbol = symbol;
    this.onCandleCallback = onCandle;
    this.streamName = `${symbol.toLowerCase()}@klines_1m`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${this.url}/${this.streamName}`);

        this.ws.onopen = () => {
          console.log(`Binance WS connected: ${symbol}`);
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const message: BinanceKlineMessage = JSON.parse(event.data);
            // Only emit if candle is closed (x: true)
            if (message.k.x) {
              const candle = this.parseKline(message, symbol);
              this.onCandleCallback?.(candle);
            }
          } catch (err) {
            console.error('Binance WS message parse error:', err);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('Binance WS error:', err);
          reject(err);
        };

        this.ws.onclose = () => {
          console.log('Binance WS closed');
          this.attemptReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Parse Binance kline message into normalized Candle.
   */
  private parseKline(message: BinanceKlineMessage, symbol: string): NormalizedCandle {
    const k = message.k;
    return {
      symbol,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      timestamp: new Date(k.T),
      timeframe: Timeframe.M1,
      broker: 'binance',
      assetClass: 'crypto',
    };
  }

  /**
   * Attempt to reconnect with exponential backoff.
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Binance WS: max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`Binance WS: reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.symbol && this.onCandleCallback) {
        this.connect(this.symbol, this.onCandleCallback).catch((err) => {
          console.error('Binance WS reconnect failed:', err);
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
