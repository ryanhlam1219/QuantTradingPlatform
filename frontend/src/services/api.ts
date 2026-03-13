const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

/** Formats any error into a readable string, handling FastAPI 422 arrays */
function formatError(err: any): string {
  if (!err) return "Unknown error";
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

  // Algorithms
  listAlgorithms: () => request<{ strategies: any[] }>("/algorithms/"),
  getAlgorithm: (name: string) => request<any>(`/algorithms/${name}`),
  generateSignals: (strategy: string, symbol: string, timeframe = "1d", lookbackDays = 365, params: Record<string, any> = {}) =>
    request<{ signals: any[]; latest_signal: any }>(
      `/algorithms/${strategy}/signals?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&lookback_days=${lookbackDays}`,
      { method: "POST", body: JSON.stringify(params) }
    ),

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

  // Screener
  scanScreener: (req: any) =>
    request<any>("/screener/scan", { method: "POST", body: JSON.stringify(req) }),
  getWatchlists: () => request<any>("/screener/watchlists"),
  getScreenerSectors: () => request<any>("/screener/sectors"),
  aiSuggestAssets: (req: any) =>
    request<any>("/screener/suggest", { method: "POST", body: JSON.stringify(req) }),
  ollamaHealth: () => request<any>("/screener/health"),

  // Research
  researchAsset: (symbol: string) =>
    request<any>(`/research/${encodeURIComponent(symbol)}`, { method: "POST" }),
  researchBatch: (symbols: string[]) =>
    request<any>("/research/batch", { method: "POST", body: JSON.stringify({ symbols }) }),

  // Portfolio Builder
  buildPortfolio: (req: any) =>
    request<any>("/portfolio/build", { method: "POST", body: JSON.stringify(req) }),
  executePortfolio: (items: any[], dry_run = false) =>
    request<any>("/portfolio/execute", { method: "POST", body: JSON.stringify({ items, dry_run }) }),
  validatePortfolio: (pairs: any[], oos_days: number) =>
    request<any>("/portfolio/validate", { method: "POST", body: JSON.stringify({ pairs, oos_days }) }),
  portfolioChat: (messages: any[]) =>
    request<any>("/portfolio/chat", { method: "POST", body: JSON.stringify({ messages }) }),
  ollamaStatus: () => request<any>("/portfolio/ollama"),

  // AutoTrader
  autoTraderAnalyze: (req: { symbols: string[]; total_capital: number }) =>
    request<any>("/autotrader/analyze", { method: "POST", body: JSON.stringify(req) }),
  autoTraderExecute: (req: { items: any[]; dry_run?: boolean }) =>
    request<any>("/autotrader/execute", { method: "POST", body: JSON.stringify(req) }),
  autoTraderBacktest: (req: {
    symbols: string[];
    total_capital: number;
    rebalance_every_days?: number;
    total_days?: number;
    lookback_days?: number;
  }) =>
    request<any>("/autotrader/backtest", { method: "POST", body: JSON.stringify(req) }),

  // AutoTrader Cycles
  listCycles: () =>
    request<{ cycles: any[] }>("/autotrader/cycles"),
  createCycle: (req: any) =>
    request<any>("/autotrader/cycles", { method: "POST", body: JSON.stringify(req) }),
  getCycle: (id: string) =>
    request<any>(`/autotrader/cycles/${id}`),
  updateCycle: (id: string, updates: any) =>
    request<any>(`/autotrader/cycles/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
  deleteCycle: (id: string) =>
    request<any>(`/autotrader/cycles/${id}`, { method: "DELETE" }),
  startCycle: (id: string) =>
    request<any>(`/autotrader/cycles/${id}/start`, { method: "POST" }),
  stopCycle: (id: string) =>
    request<any>(`/autotrader/cycles/${id}/stop`, { method: "POST" }),
  runCycleNow: (id: string) =>
    request<any>(`/autotrader/cycles/${id}/run-now`, { method: "POST" }),
  getCycleLogs: (id: string) =>
    request<{ cycle_id: string; logs: any[] }>(`/autotrader/cycles/${id}/logs`),
  getCycleRuns: (id: string) =>
    request<{ cycle_id: string; runs: any[] }>(`/autotrader/cycles/${id}/runs`),
  getCyclePerformance: (id: string) =>
    request<any>(`/autotrader/cycles/${id}/performance`),

  // Trades
  getAccount: () => request<any>("/trades/account"),
  getPositions: () => request<any[]>("/trades/positions"),
  getOrders: (status = "open") => request<any[]>(`/trades/orders?status=${status}`),
  placeOrder: (order: any) =>
    request<any>("/trades/order", { method: "POST", body: JSON.stringify(order) }),
  cancelOrder: (id: string) => request<any>(`/trades/order/${id}`, { method: "DELETE" }),
  closePosition: (symbol: string) => request<any>(`/trades/positions/${symbol}`, { method: "DELETE" }),

  // Risk Management
  calcPositionSize: (req: {
    capital: number;
    entry_price: number;
    stop_loss_pct: number;
    risk_per_trade_pct?: number;
    win_rate?: number;
    avg_win_pct?: number;
    avg_loss_pct?: number;
  }) =>
    request<any>("/risk/position-size", { method: "POST", body: JSON.stringify(req) }),

  portfolioRisk: (req: {
    holdings: { symbol: string; qty: number; entry_price: number }[];
    lookback_days?: number;
  }) =>
    request<any>("/risk/portfolio", { method: "POST", body: JSON.stringify(req) }),

  // Strategy Ranking
  rankStrategies: (req: { symbols: string[]; lookback_days?: number; top_n?: number }) =>
    request<any>("/algorithms/rank", { method: "POST", body: JSON.stringify(req) }),
};
