import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from "recharts";
import { EquityPoint } from "../../types";

interface Props { equityCurve: EquityPoint[]; initialCapital: number; }

export function EquityCurveChart({ equityCurve, initialCapital }: Props) {
  const data = equityCurve.map((p) => ({
    date: new Date(p.timestamp).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    equity: p.equity,
    pct: ((p.equity - initialCapital) / initialCapital) * 100,
  }));
  const maxEquity = Math.max(...data.map((d) => d.equity));
  const minEquity = Math.min(...data.map((d) => d.equity));
  const isPositive = data[data.length - 1]?.equity >= initialCapital;

  return (
    <div className="equity-chart">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 60 }}>
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isPositive ? "#00d4a0" : "#ff4f6d"} stopOpacity={0.3} />
              <stop offset="95%" stopColor={isPositive ? "#00d4a0" : "#ff4f6d"} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#5a6a8a", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#1e2535" }} interval="preserveStartEnd" />
          <YAxis
            domain={[minEquity * 0.995, maxEquity * 1.005]}
            tick={{ fill: "#5a6a8a", fontSize: 11 }}
            tickLine={false} axisLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
            width={58}
          />
          <Tooltip
            formatter={(v: number) => [`$${v.toFixed(2)}`, "Portfolio"]}
            labelStyle={{ color: "#8a9ab5" }}
            contentStyle={{ background: "#0d1117", border: "1px solid #1e2535", borderRadius: "8px" }}
          />
          <ReferenceLine y={initialCapital} stroke="#5a6a8a" strokeDasharray="4 4" />
          <Area
            type="monotone" dataKey="equity"
            stroke={isPositive ? "#00d4a0" : "#ff4f6d"}
            strokeWidth={2}
            fill="url(#equityGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
