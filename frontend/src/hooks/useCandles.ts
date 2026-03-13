import { useState, useEffect } from "react";
import { api } from "../services/api";
import { Candle } from "../types";

export function useCandles(symbol: string, timeframe: string, limitDays?: number) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getCandles(symbol, timeframe, "alpaca", 10000)
      .then((data) => { if (!cancelled) setCandles(data.candles); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, timeframe, limitDays]);

  return { candles, loading, error };
}
