import { NormalizedCandle, BinanceKlineMessage } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class BinanceWSClient {
  private ws: WebSocket | null = null;
  // Note: Using binance.com instead of binance.us - .us may not have kline data
  // If you need .us specifically, you may need to use REST API + polling instead
  private url = 'wss://stream.binance.com:9443/ws';
  private symbol: string | null = null;
  private streamName: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000; // 5 seconds
  private isIntentionallyClosed = false;

  /**
   * Connect and subscribe to 1-minute kline stream for a symbol.
   * @param symbol - e.g., "BTCUSDT" or "ETHUSDT"
   * @param onCandle - Callback fired when a 1m candle closes
   */
  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    this.symbol = symbol;
    this.onCandleCallback = onCandle;
    this.streamName = `${symbol.toLowerCase()}@klines_1m`;
    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.url}/${this.streamName}`;
        console.log(`[Binance] 🔌 Attempting to connect to: ${wsUrl}`);
        const connectTime = Date.now();
        console.log(`[Binance] ⏱️ Connection attempt timestamp: ${connectTime}`);
        this.ws = new WebSocket(wsUrl);
        console.log(`[Binance] 📝 WebSocket object created`);

        this.ws.onopen = () => {
          const openTime = Date.now();
          console.log(`[Binance] ✅ WebSocket OPEN - Connection established for ${symbol}`);
          console.log(`[Binance] ⏱️ OPEN timestamp: ${openTime} (${openTime - connectTime}ms after attempt)`);
          console.log(`[Binance] 🔍 WebSocket state: ${this.ws?.readyState} (OPEN=1)`);
          console.log(`[Binance] 🔍 Connected to stream: ${this.streamName}`);
          console.log(`[Binance] 🔍 Full URL used: ${wsUrl}`);
          this.reconnectAttempts = 0;

          // Try sending a ping to confirm bidirectional communication
          try {
            console.log(`[Binance] 📤 Attempting to send test ping...`);
            this.ws!.send(JSON.stringify({ method: 'ping' }));
            console.log(`[Binance] ✅ Ping sent`);
          } catch (pingErr) {
            console.error(`[Binance] ❌ Failed to send ping:`, pingErr);
          }

          // Set up a heartbeat monitor to check if connection is alive
          const heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              console.log(`[Binance] 💓 Heartbeat check - Connection ALIVE (${new Date().toLocaleTimeString()})`);
            } else if (this.ws?.readyState === WebSocket.CLOSED) {
              console.log(`[Binance] 💀 Heartbeat check - Connection CLOSED`);
              clearInterval(heartbeatInterval);
            }
          }, 10000); // Every 10 seconds

          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const msgTime = Date.now();
            console.log(`[Binance] 📨 Message received at ${msgTime} (size: ${event.data.length} bytes)`);
            const message: BinanceKlineMessage = JSON.parse(event.data);
            console.log(`[Binance] ✔️ Parsed message. Symbol=${message.s}, isClosed(k.x)=${message.k.x}`);
            console.log(`[Binance] 🔍 onCandleCallback exists?`, this.onCandleCallback !== null);
            console.log(`[Binance] 🔍 this.symbol=`, this.symbol);

            // Only emit if candle is closed (x: true)
            if (message.k.x) {
              console.log(`[Binance] 🎯 CANDLE CLOSED - message.k.x is TRUE, proceeding to parse`);
              try {
                const candle = this.parseKline(message, symbol);
                console.log(`[Binance] ✔️ Candle parsed successfully:`, candle);
                console.log(`[Binance] 📤 About to call callback. Callback is:`, typeof this.onCandleCallback);
                if (this.onCandleCallback) {
                  console.log(`[Binance] ▶️ Calling callback NOW...`);
                  this.onCandleCallback(candle);
                  console.log(`[Binance] ✅ Callback executed successfully`);
                } else {
                  console.error(`[Binance] ❌ onCandleCallback is null! Cannot call.`);
                }
              } catch (parseErr) {
                console.error(`[Binance] ❌ Error parsing candle:`, parseErr);
              }
            } else {
              console.log(`[Binance] ⏳ Candle still open (message.k.x=${message.k.x}, will wait for close)`);
            }
          } catch (err) {
            console.error('[Binance] ❌ Message parse error:', err);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('[Binance] ❌ WebSocket ERROR:', err);
          reject(err);
        };

        this.ws.onclose = (event: CloseEvent) => {
          const closeTime = Date.now();
          console.log(`[Binance] ❌ WebSocket CLOSED at ${closeTime}`);
          console.log(`[Binance] 📊 Close event - Code: ${event.code}, Reason: ${event.reason || '(no reason)'}, Clean: ${event.wasClean}`);
          console.log(`[Binance] 🔍 WebSocket state: ${this.ws?.readyState} (CLOSED=3)`);
          console.log(`[Binance] ℹ️ Common close codes: 1000=normal, 1001=going away, 1002=protocol error, 1006=abnormal`);
          this.attemptReconnect();
        };

        console.log(`[Binance] ✅ Event handlers attached (onopen, onmessage, onerror, onclose)`);
      } catch (err) {
        console.error('[Binance] ❌ Connection setup error:', err);
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
      console.log(`[Binance] ℹ️ Skipping reconnect - intentionally closed`);
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[Binance] ❌ max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`[Binance] 🔄 reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.symbol && this.onCandleCallback && !this.isIntentionallyClosed) {
        this.connect(this.symbol, this.onCandleCallback).catch((err) => {
          console.error('[Binance] ❌ reconnect failed:', err);
        });
      }
    }, delay);
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    console.log(`[Binance] 🔌 Disconnect called - marking as intentionally closed`);
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
