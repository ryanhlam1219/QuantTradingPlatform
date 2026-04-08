import { NormalizedCandle } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class KrakenWSClient {
  private ws: WebSocket | null = null;
  private url = 'wss://ws.kraken.com';
  private symbol: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private channelId: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;

  /**
   * Connect and subscribe to 1-minute OHLC feed for a symbol.
   * @param symbol - e.g., "XBT/USD" or "ETH/USD"
   * @param onCandle - Callback fired when a 1m candle arrives
   */
  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    this.symbol = symbol;
    this.onCandleCallback = onCandle;

    return new Promise((resolve, reject) => {
      try {
        console.log(`[Kraken] 🔌 Attempting to connect to: ${this.url}`);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log(`[Kraken] ✅ WebSocket OPEN - Connection established for ${symbol}`);
          console.log(`[Kraken] 🔍 WebSocket state: ${this.ws?.readyState} (OPEN=1)`);
          // Subscribe to OHLC (1m) feed
          const subscriptionMsg = {
            event: 'subscribe',
            pair: [symbol],
            subscription: {
              name: 'ohlc',
              interval: 1,
            },
          };
          console.log(`[Kraken] 📤 Sending subscription message:`, subscriptionMsg);
          this.ws!.send(JSON.stringify(subscriptionMsg));
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            console.log(`[Kraken] 📨 Message received (size: ${event.data.length} bytes)`);
            const message = JSON.parse(event.data);

            // Subscription confirmation
            if (message.event === 'subscriptionStatus') {
              console.log(`[Kraken] 📋 Subscription status:`, message);
              if (message.status === 'subscribed') {
                this.channelId = message.channelID;
                console.log(`[Kraken] ✔️ Subscribed with channel ID ${this.channelId}`);
              }
              return;
            }

            // OHLC data comes as array: [channelId, [[time, open, high, low, close, vwap, volume, count], ...], 'ohlc', pair]
            if (Array.isArray(message) && message.length >= 4 && message[2] === 'ohlc') {
              console.log(`[Kraken] 🎯 OHLC data received:`, message);
              const ohlcData = message[1];
              if (Array.isArray(ohlcData) && ohlcData.length > 0) {
                const lastCandle = ohlcData[ohlcData.length - 1];
                const [time, open, high, low, close, vwap, volume, count] = lastCandle;

                const candle: NormalizedCandle = {
                  symbol: this.symbol!,
                  open: parseFloat(open),
                  high: parseFloat(high),
                  low: parseFloat(low),
                  close: parseFloat(close),
                  volume: parseFloat(volume),
                  timestamp: new Date(time * 1000),
                  timeframe: Timeframe.M1,
                  broker: 'kraken',
                  assetClass: 'crypto',
                };
                console.log(`[Kraken] 📤 Calling callback with candle:`, candle);
                this.onCandleCallback?.(candle);
                console.log(`[Kraken] ✅ Callback executed`);
              }
            }
          } catch (err) {
            console.error('[Kraken] ❌ Message parse error:', err);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('[Kraken] ❌ WebSocket ERROR:', err);
          reject(err);
        };

        this.ws.onclose = (event: CloseEvent) => {
          console.log(`[Kraken] ❌ WebSocket CLOSED - Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
          console.log(`[Kraken] 🔍 WebSocket state: ${this.ws?.readyState} (CLOSED=3)`);
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
      console.error(`[Kraken] ❌ max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`[Kraken] 🔄 reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.symbol && this.onCandleCallback) {
        this.connect(this.symbol, this.onCandleCallback).catch((err) => {
          console.error('[Kraken] ❌ reconnect failed:', err);
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
