import { NormalizedCandle, BinanceKlineMessage } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class BinanceWSClient {
  private ws: WebSocket | null = null;
  // Binance US websocket - use unauthenticated data stream
  private url = 'wss://stream.binance.us:9443/ws';
  private symbol: string | null = null;
  private streamName: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private isIntentionallyClosed = false;
  private messageCount = 0;

  /**
   * Connect and subscribe to 1-minute kline stream for a symbol.
   * @param symbol - e.g., "BTCUSDT" or "ETHUSDT"
   * @param onCandle - Callback fired when a 1m candle closes
   */
  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    this.symbol = symbol;
    this.onCandleCallback = onCandle;

    // Try Binance US market data stream format (may require different stream name)
    // Format 1: symbol@klines_1m (standard Binance format)
    this.streamName = `${symbol.toLowerCase()}@klines_1m`;

    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.messageCount = 0;

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.url}/${this.streamName}`;
        console.log(`[Binance US] 🔌 Attempting connection: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);
        console.log(`[Binance US] 📝 WebSocket created, waiting for OPEN...`);

        this.ws.onopen = () => {
          console.log(`[Binance US] ✅ WebSocket OPEN`);
          console.log(`[Binance US] 📤 Sending subscription message...`);

          // Send subscription message to explicitly subscribe to the stream
          const subscriptionMsg = {
            method: 'SUBSCRIBE',
            params: [this.streamName],
            id: 1
          };

          try {
            this.ws!.send(JSON.stringify(subscriptionMsg));
            console.log(`[Binance US] ✅ Subscription sent for stream: ${this.streamName}`);
          } catch (err) {
            console.error(`[Binance US] ❌ Failed to send subscription:`, err);
          }

          console.log(`[Binance US] 🎧 Waiting for kline data...`);
          this.reconnectAttempts = 0;

          // Heartbeat to confirm connection is alive
          const heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              console.log(`[Binance US] 💓 Connection alive`);
            } else {
              clearInterval(heartbeatInterval);
            }
          }, 15000);

          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          console.log(`[Binance US] 🚨🚨🚨 ONMESSAGE TRIGGERED - Message received!`);
          try {
            this.messageCount++;
            console.log(`[Binance US] 📨 Message #${this.messageCount} received (${event.data.length} bytes)`);

            const message: BinanceKlineMessage = JSON.parse(event.data);

            if (message.k && message.k.x) {
              console.log(`[Binance US] 🎯 Candle closed - O: ${message.k.o}, H: ${message.k.h}, L: ${message.k.l}, C: ${message.k.c}, V: ${message.k.v}`);

              const candle = this.parseKline(message, symbol);

              if (this.onCandleCallback) {
                this.onCandleCallback(candle);
                console.log(`[Binance US] ✅ Candle emitted to UI`);
              }
            } else if (message.k) {
              console.log(`[Binance US] ⏳ Candle open - C: ${message.k.c}`);
            }
          } catch (err) {
            console.error('[Binance US] ❌ Error processing message:', err);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('[Binance US] ❌ WebSocket error:', err);
          reject(err);
        };

        this.ws.onclose = (event: CloseEvent) => {
          console.log(`[Binance US] ❌ WebSocket closed - Code: ${event.code}`);
          this.attemptReconnect();
        };

        console.log(`[Binance US] ✅ ALL EVENT HANDLERS ATTACHED`);
      } catch (err) {
        console.error('[Binance US] ❌ Setup error:', err);
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
    if (this.isIntentionallyClosed) {
      console.log(`[Binance US] ℹ️ Skipping reconnect - intentionally closed`);
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[Binance US] ❌ Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`[Binance US] 🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.symbol && this.onCandleCallback && !this.isIntentionallyClosed) {
        this.connect(this.symbol, this.onCandleCallback).catch((err) => {
          console.error('[Binance US] ❌ Reconnect failed:', err);
        });
      }
    }, delay);
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    console.log(`[Binance US] 🔌 Disconnect called`);
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onCandleCallback = null;
    this.symbol = null;
  }

  /**
   * Get connection status.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
