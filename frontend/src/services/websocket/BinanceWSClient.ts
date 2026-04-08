import { NormalizedCandle, BinanceKlineMessage } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class BinanceWSClient {
  private ws: WebSocket | null = null;
  // Binance US websocket endpoint
  private url = 'wss://stream.binance.us:9443/ws';
  private symbol: string | null = null;
  private streamName: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000; // 5 seconds
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
    this.streamName = `${symbol.toLowerCase()}@klines_1m`;
    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.messageCount = 0;

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.url}/${this.streamName}`;
        console.log(`[Binance US] 🔌 Attempting to connect to: ${wsUrl}`);
        const connectTime = Date.now();
        console.log(`[Binance US] ⏱️ Connection attempt timestamp: ${connectTime}`);
        this.ws = new WebSocket(wsUrl);
        console.log(`[Binance US] 📝 WebSocket object created`);

        this.ws.onopen = () => {
          const openTime = Date.now();
          console.log(`[Binance US] ✅ WebSocket OPEN - Connection established for ${symbol}`);
          console.log(`[Binance US] ⏱️ OPEN timestamp: ${openTime} (${openTime - connectTime}ms after attempt)`);
          console.log(`[Binance US] 🔍 WebSocket state: ${this.ws?.readyState} (OPEN=1)`);
          console.log(`[Binance US] 🔍 Connected to stream: ${this.streamName}`);
          console.log(`[Binance US] 🔍 Full URL used: ${wsUrl}`);
          console.log(`[Binance US] ℹ️ Waiting for kline data on stream: ${this.streamName}`);
          this.reconnectAttempts = 0;

          // Set up a heartbeat monitor to check if connection is alive
          const heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              console.log(`[Binance US] 💓 Heartbeat - Connection ALIVE (${new Date().toLocaleTimeString()})`);
            } else if (this.ws?.readyState === WebSocket.CLOSED) {
              console.log(`[Binance US] 💀 Heartbeat - Connection CLOSED`);
              clearInterval(heartbeatInterval);
            }
          }, 10000); // Every 10 seconds

          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            this.messageCount++;
            const msgTime = Date.now();
            console.log(`[Binance US] 📨 Message #${this.messageCount} received at ${msgTime} (size: ${event.data.length} bytes)`);
            console.log(`[Binance US] 📋 Raw message data:`, event.data.substring(0, 200)); // First 200 chars
            const message: BinanceKlineMessage = JSON.parse(event.data);
            console.log(`[Binance US] ✔️ Parsed message. Symbol=${message.s}, isClosed(k.x)=${message.k.x}`);
            console.log(`[Binance US] 🔍 onCandleCallback exists?`, this.onCandleCallback !== null);
            console.log(`[Binance US] 🔍 this.symbol=`, this.symbol);

            // Only emit if candle is closed (x: true)
            if (message.k.x) {
              console.log(`[Binance US] 🎯 CANDLE CLOSED - message.k.x is TRUE, proceeding to parse`);
              try {
                const candle = this.parseKline(message, symbol);
                console.log(`[Binance US] ✔️ Candle parsed successfully:`, candle);
                console.log(`[Binance US] 📤 About to call callback. Callback is:`, typeof this.onCandleCallback);
                if (this.onCandleCallback) {
                  console.log(`[Binance US] ▶️ Calling callback NOW...`);
                  this.onCandleCallback(candle);
                  console.log(`[Binance US] ✅ Callback executed successfully`);
                } else {
                  console.error(`[Binance US] ❌ onCandleCallback is null! Cannot call.`);
                }
              } catch (parseErr) {
                console.error(`[Binance US] ❌ Error parsing candle:`, parseErr);
              }
            } else {
              console.log(`[Binance US] ⏳ Candle still open (message.k.x=${message.k.x}, will wait for close)`);
            }
          } catch (err) {
            console.error('[Binance US] ❌ Message parse error:', err);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('[Binance US] ❌ WebSocket ERROR:', err);
          console.log(`[Binance US] 🌍 NOTE: If you see error 451 "Unavailable For Legal Reasons", Binance is blocking your region.`);
          console.log(`[Binance US] 💡 Solutions: Use a VPN, use a backend proxy, or switch to a different exchange (Kraken, Gemini).`);
          reject(err);
        };

        this.ws.onclose = (event: CloseEvent) => {
          const closeTime = Date.now();
          console.log(`[Binance US] ❌ WebSocket CLOSED at ${closeTime}`);
          console.log(`[Binance US] 📊 Close event - Code: ${event.code}, Reason: ${event.reason || '(no reason)'}, Clean: ${event.wasClean}`);
          console.log(`[Binance US] 🔍 WebSocket state: ${this.ws?.readyState} (CLOSED=3)`);
          console.log(`[Binance US] ℹ️ Common close codes: 1000=normal, 1001=going away, 1002=protocol error, 1006=abnormal`);
          this.attemptReconnect();
        };

        console.log(`[Binance US] ✅ Event handlers attached (onopen, onmessage, onerror, onclose)`);
        console.log(`[Binance US] 🔔 Ready to receive messages on stream: ${this.streamName}`);
        console.log(`[Binance US] ⏳ Waiting for data... (may take a few seconds for first message)`);
      } catch (err) {
        console.error('[Binance US] ❌ Connection setup error:', err);
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
      console.error(`[Binance US] ❌ max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log(`[Binance US] 🔄 reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.symbol && this.onCandleCallback && !this.isIntentionallyClosed) {
        this.connect(this.symbol, this.onCandleCallback).catch((err) => {
          console.error('[Binance US] ❌ reconnect failed:', err);
        });
      }
    }, delay);
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    console.log(`[Binance US] 🔌 Disconnect called - marking as intentionally closed`);
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
