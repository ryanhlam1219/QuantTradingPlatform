import { useState } from "react";
import { MetricCard } from "../components/dashboard/MetricCard";
import { CandlestickChart } from "../components/charts/CandlestickChart";
import { SignalFeed } from "../components/dashboard/SignalFeed";
import { useCandles } from "../hooks/useCandles";

const SYMBOLS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ", "BTC/USD", "ETH/USD"];

const TIMEFRAMES = [
  { value: "1h",  label: "1H",  limitDays: 30 },
  { value: "4h",  label: "4H",  limitDays: 90 },
  { value: "1d",  label: "1D",  limitDays: 365 },
  { value: "1d",  label: "3Y",  limitDays: 1095 },
  { value: "1d",  label: "5Y",  limitDays: 1825 },
  { value: "1d",  label: "MAX", limitDays: 3650 },
  { value: "1w",  label: "1W",  limitDays: 3650 },
];

export function Dashboard() {
  const [symbol, setSymbol]   = useState("AAPL");
  const [tfIdx, setTfIdx]     = useState(2); // default 1D
  const tf = TIMEFRAMES[tfIdx];

  const { candles, loading, error } = useCandles(symbol, tf.value, tf.limitDays);

  const latestCandle = candles[candles.length - 1];
  const prevCandle   = candles[candles.length - 2];
  const priceChange  = latestCandle && prevCandle
    ? ((latestCandle.close - prevCandle.close) / prevCandle.close) * 100
    : 0;

  // First/last candle date range for the header
  const dateRange = candles.length >= 2
    ? `${new Date(candles[0].timestamp).getFullYear()} – ${new Date(candles[candles.length-1].timestamp).getFullYear()}`
    : "";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Market Overview</h1>
          <p className="page-sub">
            {candles.length > 0 ? `${candles.length} candles · ${dateRange}` : "Real-time price action & signal monitoring"}
          </p>
        </div>
        <div className="header-controls">
          <select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {SYMBOLS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="timeframe-tabs">
            {TIMEFRAMES.map((t, i) => (
              <button
                key={`${t.label}-${i}`}
                className={`tf-tab ${tfIdx === i ? "active" : ""}`}
                onClick={() => setTfIdx(i)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="metrics-row">
        <MetricCard
          label="Last Price"
          value={latestCandle ? `$${latestCandle.close.toFixed(2)}` : "—"}
          change={priceChange}
          sub={symbol}
        />
        <MetricCard label="Period High" value={latestCandle ? `$${Math.max(...candles.map(c => c.high)).toFixed(2)}` : "—"} accent="green" />
        <MetricCard label="Period Low"  value={latestCandle ? `$${Math.min(...candles.map(c => c.low)).toFixed(2)}` : "—"}  accent="red" />
        <MetricCard
          label="Latest Volume"
          value={latestCandle ? formatVolume(latestCandle.volume) : "—"}
          accent="blue"
        />
      </div>

      <div className="dashboard-grid">
        <div className="chart-panel">
          <div className="panel-header">
            <span className="panel-title">{symbol} · {tf.label}</span>
            {loading && <span className="loading-dot" />}
          </div>
          {error ? (
            <div className="error-state">
              <p>⚠ Could not load chart data</p>
              <p className="error-detail">{error}</p>
              <p className="error-hint">Make sure the backend is running on port 8000.</p>
            </div>
          ) : (
            <CandlestickChart candles={candles} loading={loading} limitDays={tf.limitDays} />
          )}
        </div>
        <div className="signal-panel">
          <div className="panel-header"><span className="panel-title">Signal Feed</span></div>
          <SignalFeed symbol={symbol} />
        </div>
      </div>
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}
