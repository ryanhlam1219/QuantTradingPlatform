import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Cell,
} from "recharts";
import { Candle } from "../../types";

interface Props {
  candles: Candle[];
  loading?: boolean;
  signals?: { timestamp: string; signal_type: string; price: number }[];
  limitDays?: number;
}

function formatDateLabel(isoStr: string, spanYears: number): string {
  const d = new Date(isoStr);
  if (spanYears > 2) {
    // Show "Jan '22" style
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  if (spanYears > 0.5) {
    // Show "Jan 5 '23"
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  }
  // Short range — just month/day
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CandlestickChart({ candles, loading, signals = [], limitDays = 365 }: Props) {
  const data = useMemo(() => {
    if (!candles.length) return [];
    const first = new Date(candles[0].timestamp).getTime();
    const last  = new Date(candles[candles.length - 1].timestamp).getTime();
    const spanYears = (last - first) / (1000 * 60 * 60 * 24 * 365);

    // For very large datasets thin the visible points so the chart stays readable
    const maxPoints = 300;
    const step = Math.max(1, Math.floor(candles.length / maxPoints));
    const visible = candles.filter((_, i) => i % step === 0 || i === candles.length - 1);

    return visible.map((c) => ({
      date:      formatDateLabel(c.timestamp, spanYears),
      fullDate:  new Date(c.timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
      open:      c.open,
      high:      c.high,
      low:       c.low,
      close:     c.close,
      volume:    c.volume,
      isBullish: c.close >= c.open,
      bodyLow:   Math.min(c.open, c.close),
      bodyHigh:  Math.max(c.open, c.close),
    }));
  }, [candles]);

  if (loading) return <div className="chart-skeleton"><div className="skeleton-shimmer" /></div>;
  if (!data.length) return <div className="chart-empty">No chart data — configure backend credentials to load data</div>;

  const prices = data.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...prices) * 0.998;
  const maxPrice = Math.max(...prices) * 1.002;

  return (
    <div className="chart-container">
      <div className="price-chart">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#5a6a8a", fontSize: 11, fontFamily: "IBM Plex Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: "#1e2535" }}
              interval="preserveStartEnd"
              minTickGap={60}
            />
            <YAxis
              domain={[minPrice, maxPrice]}
              tick={{ fill: "#5a6a8a", fontSize: 11, fontFamily: "IBM Plex Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(2)}`}
              width={64}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="bodyHigh" stackId="body" radius={[1, 1, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.isBullish ? "#00d4a0" : "#ff4f6d"} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="close" stroke="#4a9eff" strokeWidth={1.5} dot={false} strokeOpacity={0.6} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="volume-chart">
        <ResponsiveContainer width="100%" height={60}>
          <ComposedChart data={data} margin={{ top: 0, right: 16, bottom: 0, left: 60 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Bar dataKey="volume" radius={[1, 1, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.isBullish ? "#00d4a020" : "#ff4f6d20"} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{d.fullDate}</div>
      <div className="tooltip-row"><span>O</span><span>${d.open?.toFixed(2)}</span></div>
      <div className="tooltip-row"><span>H</span><span className="green">${d.high?.toFixed(2)}</span></div>
      <div className="tooltip-row"><span>L</span><span className="red">${d.low?.toFixed(2)}</span></div>
      <div className="tooltip-row"><span>C</span><span>${d.close?.toFixed(2)}</span></div>
    </div>
  );
}
