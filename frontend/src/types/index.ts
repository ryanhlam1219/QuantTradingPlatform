// ── Market Data ─────────────────────────────────────────────────────────────

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Algorithms / Signals ────────────────────────────────────────────────────

export interface Strategy {
  name: string;
  display_name: string;
  description: string;
  params: Record<string, number | string>;
  signals: string[];
  best_for: string;
  weaknesses: string;
}

// ── Backtesting ─────────────────────────────────────────────────────────────

export interface Trade {
  symbol: string;
  entry_price: number;
  exit_price?: number;
  entry_time: string;
  exit_time?: string;
  quantity: number;
  direction: string;
  pnl?: number;
  pnl_pct?: number;
  commission: number;
}

export interface BacktestConfig {
  symbol: string;
  strategy: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  timeframe: string;
  commission: number;
  strategy_params: Record<string, unknown>;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: Trade[];
  signals: unknown[];
  equity_curve: { timestamp: string; equity: number }[];
  total_return: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  avg_holding_days: number;
  volatility: number;
  calmar_ratio: number;
  sortino_ratio: number;
}

export interface CompareResult {
  strategy: string;
  total_return: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  total_trades: number;
  profit_factor: number;
  equity_curve: { timestamp: string; equity: number }[];
  error?: string;
}
