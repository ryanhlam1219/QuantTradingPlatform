import { useState, useEffect } from "react";
import { api } from "../services/api";
import { logger } from "../utils/logger";
import { Candle } from "../types";

export function useCandles(symbol: string, timeframe: string, limitDays?: number) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    
    logger.debug("useCandles", `Fetching candles for ${symbol}/${timeframe}`);
    
    api.getCandles(symbol, timeframe, "alpaca", 10000)
      .then((data) => {
        if (!cancelled) {
          logger.info("useCandles", `Loaded ${data.candles.length} candles`, { symbol, timeframe });
          setCandles(data.candles);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          logger.error("useCandles", `Failed to fetch candles`, { symbol, timeframe, error: e.message });
          setError(e.message);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    
    return () => { cancelled = true; };
  }, [symbol, timeframe, limitDays]);

  return { candles, loading, error };
}
