import { NormalizedCandle } from '../../types/ExchangeComparison';
import { Timeframe } from '../../types/Timeframe';

export class BinanceWSClient {
  // Using REST API polling instead of websocket since WS doesn't stream data
  private symbol: string | null = null;
  private onCandleCallback: ((candle: NormalizedCandle) => void) | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isIntentionallyClosed = false;
  private lastCandleTime = 0;
  private apiUrl = 'https://api.binance.us/api/v3';

  /**
   * Connect and fetch 1-minute kline data for a symbol via REST API polling.
   * @param symbol - e.g., "BTCUSDT" or "ETHUSDT"
   * @param onCandle - Callback fired when new kline data is available
   */
  async connect(symbol: string, onCandle: (candle: NormalizedCandle) => void): Promise<void> {
    this.symbol = symbol;
    this.onCandleCallback = onCandle;
    this.isIntentionallyClosed = false;
    this.lastCandleTime = 0;

    console.log(`[Binance US] 🔌 Connecting via REST API polling for ${symbol}`);

    try {
      // Fetch initial candle to verify API works
      await this.fetchAndEmitCandle(symbol);
      console.log(`[Binance US] ✅ Connected - polling for klines every 1 second`);

      // Poll for new klines every 1 second
      this.pollInterval = setInterval(async () => {
        if (!this.isIntentionallyClosed && this.symbol && this.onCandleCallback) {
          try {
            await this.fetchAndEmitCandle(this.symbol);
          } catch (err) {
            console.error(`[Binance US] ❌ Polling error:`, err);
          }
        }
      }, 1000);
    } catch (err) {
      console.error(`[Binance US] ❌ Connection error:`, err);
      throw err;
    }
  }

  /**
   * Fetch latest kline data from Binance US REST API and emit if new.
   */
  private async fetchAndEmitCandle(symbol: string): Promise<void> {
    try {
      const url = `${this.apiUrl}/klines?symbol=${symbol}&interval=1m&limit=1`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        console.error(`[Binance US] ❌ Invalid response from API`);
        return;
      }

      const kline = data[0];
      const [time, open, high, low, close, volume, closeTime, quoteAssetVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore] = kline;

      // Only emit if we haven't seen this candle before
      if (time > this.lastCandleTime) {
        this.lastCandleTime = time;

        const candle: NormalizedCandle = {
          symbol,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseFloat(volume),
          timestamp: new Date(time),
          timeframe: Timeframe.M1,
          broker: 'binance',
          assetClass: 'crypto',
        };

        console.log(`[Binance US] 📊 Kline fetched - O: ${candle.open}, H: ${candle.high}, L: ${candle.low}, C: ${candle.close}, V: ${candle.volume}`);

        if (this.onCandleCallback) {
          this.onCandleCallback(candle);
          console.log(`[Binance US] 📤 Candle emitted to UI`);
        }
      }
    } catch (err) {
      console.error(`[Binance US] ❌ Fetch error:`, err);
    }
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    console.log(`[Binance US] 🔌 Disconnect called`);
    this.isIntentionallyClosed = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.onCandleCallback = null;
    this.symbol = null;
  }

  /**
   * Get connection status.
   */
  isConnected(): boolean {
    return !this.isIntentionallyClosed && this.pollInterval !== null;
  }
}
