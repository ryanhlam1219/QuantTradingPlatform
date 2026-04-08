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
        const wsUrl = `${this.url}/${this.streamName}`;
        console.log(`[Binance] 🔌 Attempting to connect to: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log(`[Binance] ✅ WebSocket OPEN - Connection established for ${symbol}`);
          console.log(`[Binance] 🔍 WebSocket state: ${this.ws?.readyState} (OPEN=1)`);
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            console.log(`[Binance] 📨 Message received (size: ${event.data.length} bytes)`);
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
          console.log(`[Binance] ❌ WebSocket CLOSED - Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
          console.log(`[Binance] 🔍 WebSocket state: ${this.ws?.readyState} (CLOSED=3)`);
          this.attemptReconnect();
        };
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
