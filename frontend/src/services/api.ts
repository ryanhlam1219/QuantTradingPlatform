const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

/** Formats any error into a readable string, handling FastAPI's 422 arrays */
function formatError(err: any): string {
  if (!err) return "Unknown error";
  // FastAPI 422 detail is an array of validation errors
  if (Array.isArray(err)) {
    return err
      .map((e: any) => {
        const loc = Array.isArray(e.loc) ? e.loc.filter((l: any) => l !== "body").join(" → ") : "";
        return loc ? `${loc}: ${e.msg}` : e.msg;
      })
      .join(" | ");
  }
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    if (err.detail) return formatError(err.detail);
    if (err.message) return err.message;
    return JSON.stringify(err);
  }
  return String(err);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (networkErr: any) {
    throw new Error(`Network error — is the backend running? (${networkErr.message})`);
  }
  if (!res.ok) {
    let errBody: any;
    try { errBody = await res.json(); } catch { errBody = { detail: res.statusText }; }
    throw new Error(formatError(errBody));
  }
  return res.json();
}

export const api = {
  // Health
  health: () => request<{ status: string; version: string }>("/health/"),
  readiness: () => request<{ status: string; brokers: Record<string, string> }>("/health/ready"),

  // Market Data
  getCandles: (symbol: string, timeframe = "1d", broker = "alpaca", limit = 10000) =>
    request<{ symbol: string; candles: any[]; count: number }>(
      `/market-data/candles/${symbol}?timeframe=${timeframe}&broker=${broker}&limit=${limit}`
    ),

  getSymbols: (broker = "alpaca") =>
    request<{ symbols: string[] }>(`/market-data/symbols?broker=${broker}`),

  // Algorithms — signals now POSTs a proper JSON body
  listAlgorithms: () => request<{ strategies: any[] }>("/algorithms/"),
  getAlgorithm: (name: string) => request<any>(`/algorithms/${name}`),
  generateSignals: (strategy: string, symbol: string, timeframe = "1d", lookbackDays = 365, params: Record<string, any> = {}) =>
    request<{ signals: any[]; latest_signal: any }>(`/algorithms/${strategy}/signals?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&lookback_days=${lookbackDays}`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Backtest
  runBacktest: (config: any) =>
    request<any>("/backtest/run", { method: "POST", body: JSON.stringify(config) }),
  compareStrategies: (symbol: string, startDate: string, endDate: string, capital = 10000) =>
    request<{ symbol: string; results: any[] }>(
      `/backtest/compare?symbol=${symbol}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&initial_capital=${capital}`,
      { method: "POST" }
    ),
  portfolioBacktest: (config: any) =>
    request<any>("/backtest/portfolio", { method: "POST", body: JSON.stringify(config) }),

  // Trades
  getAccount: () => request<any>("/trades/account"),
  getPositions: () => request<any[]>("/trades/positions"),
  getOrders: (status = "open") => request<any[]>(`/trades/orders?status=${status}`),
  placeOrder: (order: any) =>
    request<any>("/trades/order", { method: "POST", body: JSON.stringify(order) }),
  cancelOrder: (id: string) => request<any>(`/trades/order/${id}`, { method: "DELETE" }),
  closePosition: (symbol: string) => request<any>(`/trades/positions/${symbol}`, { method: "DELETE" }),
};
