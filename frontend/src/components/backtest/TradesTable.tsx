import { Trade } from "../../types";

interface Props { trades: Trade[]; }

export function TradesTable({ trades }: Props) {
  if (!trades.length) return <div className="table-empty">No completed trades</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Entry</th><th>Exit</th><th>Entry $</th>
            <th>Exit $</th><th>Qty</th><th>P&L</th><th>P&L %</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 50).map((t, i) => (
            <tr key={i}>
              <td>{t.entry_time ? new Date(t.entry_time).toLocaleDateString() : "—"}</td>
              <td>{t.exit_time ? new Date(t.exit_time).toLocaleDateString() : "Open"}</td>
              <td>${t.entry_price.toFixed(2)}</td>
              <td>{t.exit_price ? `$${t.exit_price.toFixed(2)}` : "—"}</td>
              <td>{t.quantity.toFixed(2)}</td>
              <td className={t.pnl != null ? (t.pnl >= 0 ? "green" : "red") : ""}>
                {t.pnl != null ? `$${t.pnl.toFixed(2)}` : "—"}
              </td>
              <td className={t.pnl_pct != null ? (t.pnl_pct >= 0 ? "green" : "red") : ""}>
                {t.pnl_pct != null ? `${(t.pnl_pct * 100).toFixed(2)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
