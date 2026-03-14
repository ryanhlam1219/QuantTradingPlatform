import { useState, useEffect } from "react";
import { MetricCard } from "../components/dashboard/MetricCard";
import { CandlestickChart } from "../components/charts/CandlestickChart";
import { SignalFeed } from "../components/dashboard/SignalFeed";
import { useCandles } from "../hooks/useCandles";
import { api } from "../services/api";
import { logger } from "../utils/logger";

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
  const [backendReady, setBackendReady] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const tf = TIMEFRAMES[tfIdx];

  const { candles, loading, error } = useCandles(symbol, tf.value, tf.limitDays);

  // Health check on mount
  useEffect(() => {
    logger.info("Dashboard", "Dashboard mounted, checking backend health");
    api.health()
      .then((res) => {
        logger.info("Dashboard", "Backend health check passed", res);
        setBackendReady(true);
      })
      .catch((err) => {
        logger.error("Dashboard", "Backend health check failed", err.message);
        setBackendError(err.message);
      });
  }, []);

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
      {backendError && (
        <div style={{ padding: "12px 16px", background: "#fee", border: "1px solid #f99", borderRadius: "4px", marginBottom: "12px", color: "#c33", fontSize: "13px" }}>
          ⚠ Backend unavailable: {backendError}
        </div>
      )}

      <header className="page-header">
        <div>
          <h1 className="page-title">Market Overview</h1>
          <p className="page-sub">
            {candles.length > 0 ? `${candles.length} candles · ${dateRange}` : "Real-time price action & signal monitoring"}
            {backendReady && <span style={{ marginLeft: "12px", color: "#0a0" }}>● Connected</span>}
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
