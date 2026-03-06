import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { CompareResult } from "../../types";

const COLORS = ["#4a9eff", "#00d4a0", "#ff9f40", "#ff4f6d", "#c084fc"];

interface Props { results: CompareResult[]; }

export function CompareChart({ results }: Props) {
  const valid = results.filter((r) => !r.error && r.equity_curve?.length > 0);
  if (!valid.length) return <div className="chart-empty">No valid comparison data</div>;

  const maxLen = Math.max(...valid.map((r) => r.equity_curve.length));
  const data: any[] = [];
  for (let i = 0; i < maxLen; i += Math.floor(maxLen / 100) || 1) {
    const point: any = {
      date: valid[0].equity_curve[i]
        ? new Date(valid[0].equity_curve[i].timestamp).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
        : "",
    };
    valid.forEach((r) => {
      const e = r.equity_curve[i];
      if (e) point[r.strategy] = e.equity;
    });
    data.push(point);
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#5a6a8a", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#1e2535" }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#5a6a8a", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} width={58} />
        <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid #1e2535", borderRadius: "8px" }} />
        <Legend wrapperStyle={{ color: "#8a9ab5", fontSize: 12 }} />
        {valid.map((r, i) => (
          <Line key={r.strategy} type="monotone" dataKey={r.strategy}
            stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false}
            name={r.strategy.replace(/_/g, " ")}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
