import { BacktestResult } from "../../types";

interface Props { result: BacktestResult; }

export function MetricsGrid({ result: r }: Props) {
  const metrics = [
    { label: "Total Return", value: `${(r.total_return * 100).toFixed(2)}%`, positive: r.total_return >= 0 },
    { label: "Ann. Return", value: `${(r.annualized_return * 100).toFixed(2)}%`, positive: r.annualized_return >= 0 },
    { label: "Sharpe Ratio", value: r.sharpe_ratio.toFixed(3), positive: r.sharpe_ratio >= 1 },
    { label: "Sortino Ratio", value: r.sortino_ratio.toFixed(3), positive: r.sortino_ratio >= 1 },
    { label: "Max Drawdown", value: `${(r.max_drawdown * 100).toFixed(2)}%`, positive: false, alwaysRed: true },
    { label: "Calmar Ratio", value: r.calmar_ratio.toFixed(3), positive: r.calmar_ratio >= 1 },
    { label: "Win Rate", value: `${(r.win_rate * 100).toFixed(1)}%`, positive: r.win_rate >= 0.5 },
    { label: "Profit Factor", value: r.profit_factor.toFixed(3), positive: r.profit_factor >= 1 },
    { label: "Total Trades", value: r.total_trades.toString(), neutral: true },
    { label: "Avg Win", value: `$${r.avg_win.toFixed(2)}`, positive: true },
    { label: "Avg Loss", value: `$${r.avg_loss.toFixed(2)}`, positive: false, alwaysRed: true },
    { label: "Avg Hold (days)", value: r.avg_holding_days.toFixed(1), neutral: true },
  ];
  return (
    <div className="metrics-grid">
      {metrics.map((m) => (
        <div key={m.label} className="metric-tile">
          <span className="metric-tile-label">{m.label}</span>
          <span className={`metric-tile-value ${m.neutral ? "" : m.alwaysRed ? "red" : m.positive ? "green" : "red"}`}>
            {m.value}
          </span>
        </div>
      ))}
    </div>
  );
}
