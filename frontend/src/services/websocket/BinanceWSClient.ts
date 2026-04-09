import { NormalizedCandle, BinanceKlineMessage } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class BinanceWSClient {
  private ws: WebSocket | null = null;
  // Binance US WebSocket API endpoint
  private url = 'wss://ws-api.binance.us:443/ws-api/v3';
  private symbol: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private isIntentionallyClosed = false;
  private messageCount = 0;
  private requestId = 1;

  // API credentials from environment
  private apiKey = import.meta.env.VITE_BINANCE_API_KEY || '';
  private apiSecret = import.meta.env.VITE_BINANCE_SECRET_KEY || '';

  /**
   * Connect and subscribe to 1-minute kline stream for a symbol using Binance US WebSocket API.
   * @param symbol - e.g., "BTCUSDT" or "ETHUSDT"
   * @param onCandle - Callback fired when a 1m candle closes
   */
  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    console.log(`[Binance US] 🔌 CONNECT CALLED for ${symbol}`);
    this.symbol = symbol;
    this.onCandleCallback = onCandle;
    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.messageCount = 0;

    return new Promise((resolve, reject) => {
      try {
        console.log(`[Binance US] 🔌 Attempting connection to: ${this.url}`);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = async () => {
          console.log(`[Binance US] ✅ WebSocket OPEN`);
          console.log(`[Binance US] 📤 Subscribing to klines for ${symbol} (authenticated)...`);

          if (!this.apiKey || !this.apiSecret) {
            console.error(`[Binance US] ❌ Missing API credentials. Set VITE_BINANCE_API_KEY and VITE_BINANCE_SECRET_KEY in .env`);
            this.ws!.close();
            return;
          }

          // Create authenticated subscription request
          const timestamp = Date.now();
          const stream = `${symbol.toLowerCase()}@kline_1m`;

          const subscribeRequest = {
            id: this.requestId++,
            method: 'stream.subscribe',
            params: {
              streams: [stream]
            }
          };

          try {
            // Create signature for authentication
            const signature = await this.createSignature(JSON.stringify(subscribeRequest), timestamp);

            // Add authentication to request
            subscribeRequest.params = {
              ...subscribeRequest.params,
              apiKey: this.apiKey,
              timestamp: timestamp,
              signature: signature
            };

            this.ws!.send(JSON.stringify(subscribeRequest));
            console.log(`[Binance US] ✅ Authenticated subscribe request sent`);
          } catch (err) {
            console.error(`[Binance US] ❌ Failed to send subscription:`, err);
          }

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
          this.messageCount++;
          console.log(`[Binance US] 📨 Message #${this.messageCount} (${event.data.length} bytes)`);

          try {
            const message: any = JSON.parse(event.data);

            // Handle subscription response
            if (message.result === null && message.id) {
              console.log(`[Binance US] ✅ Subscription confirmed`);
              return;
            }

            // Handle errors
            if (message.error) {
              console.error(`[Binance US] ❌ Error:`, message.error);
              return;
            }

            // Handle kline data from stream
            if (message.data && message.data.k) {
              const k = message.data.k;
              console.log(`[Binance US] 📊 Kline - O: ${k.o}, H: ${k.h}, L: ${k.l}, C: ${k.c}, V: ${k.v}`);

              if (k.x) {
                console.log(`[Binance US] 🎯 CANDLE CLOSED`);
                const candle: NormalizedCandle = {
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

                if (this.onCandleCallback) {
                  this.onCandleCallback(candle);
                  console.log(`[Binance US] ✅ Candle emitted to UI`);
                }
              } else {
                console.log(`[Binance US] ⏳ Candle building - C: ${k.c}`);
              }
            } else {
              console.log(`[Binance US] 📋 Other message:`, Object.keys(message));
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
      } catch (err) {
        console.error('[Binance US] ❌ Setup error:', err);
        reject(err);
      }
    });
  }

  /**
   * Create HMAC-SHA256 signature for authenticated API requests.
   */
  private async createSignature(data: string, timestamp: number): Promise<string> {
    const message = `${data}${timestamp}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
