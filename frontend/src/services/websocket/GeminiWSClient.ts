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
        console.log(`[Gemini] 🔌 Attempting to connect to: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log(`[Gemini] ✅ WebSocket OPEN - Connection established for ${symbol}`);
          console.log(`[Gemini] 🔍 WebSocket state: ${this.ws?.readyState} (OPEN=1)`);
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            console.log(`[Gemini] 📨 Message received (size: ${event.data.length} bytes)`);
            const message = JSON.parse(event.data);
            console.log(`[Gemini] ✔️ Parsed message. Type: ${message.type}`);

            // Gemini sends heartbeats (type: 'heartbeat')
            if (message.type === 'heartbeat') {
              console.log(`[Gemini] 💓 Heartbeat received`);
              return;
            }

            // Candles come as type: 'candles'
            if (message.type === 'candles' && message.changes && Array.isArray(message.changes)) {
              console.log(`[Gemini] 🎯 CANDLE data received with ${message.changes.length} changes`);
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
                console.log(`[Gemini] 📤 Calling callback with candle:`, candle);
                this.onCandleCallback?.(candle);
                console.log(`[Gemini] ✅ Callback executed`);
              }
            }
          } catch (err) {
            console.error('[Gemini] ❌ Message parse error:', err);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('[Gemini] ❌ WebSocket ERROR:', err);
          reject(err);
        };

        this.ws.onclose = (event: CloseEvent) => {
          console.log(`[Gemini] ❌ WebSocket CLOSED - Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
          console.log(`[Gemini] 🔍 WebSocket state: ${this.ws?.readyState} (CLOSED=3)`);
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
      console.error(`[Gemini] ❌ max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`[Gemini] 🔄 reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.symbol && this.onCandleCallback) {
        this.connect(this.symbol, this.onCandleCallback).catch((err) => {
          console.error('[Gemini] ❌ reconnect failed:', err);
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
