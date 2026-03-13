interface Props {
  label: string;
  value: string;
  change?: number;
  sub?: string;
  accent?: "green" | "red" | "blue" | "default";
}

export function MetricCard({ label, value, change, sub, accent = "default" }: Props) {
  const accentClass = `metric-card metric-card--${accent}`;
  return (
    <div className={accentClass}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {change !== undefined && (
        <span className={`metric-change ${change >= 0 ? "pos" : "neg"}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
        </span>
      )}
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}
