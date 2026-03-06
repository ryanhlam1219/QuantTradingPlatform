import { useState, useEffect } from "react";
import { api } from "../../services/api";
import { Signal } from "../../types";

const STRATEGIES = ["rsi", "macd", "bollinger_bands", "moving_average_crossover"];

interface Props { symbol: string; }

export function SignalFeed({ symbol }: Props) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled(
      STRATEGIES.map((s) => api.generateSignals(s, symbol))
    ).then((results) => {
      const all: Signal[] = [];
      results.forEach((r) => {
        if (r.status === "fulfilled" && r.value.latest_signal) {
          all.push(r.value.latest_signal);
        }
      });
      setSignals(all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    }).finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <div className="feed-loading">Scanning strategies…</div>;
  if (!signals.length) return <div className="feed-empty">No recent signals for {symbol}</div>;

  return (
    <div className="signal-feed">
      {signals.map((s, i) => (
        <div key={i} className={`signal-item signal-item--${s.signal_type}`}>
          <div className="signal-header">
            <span className={`signal-badge badge--${s.signal_type}`}>{s.signal_type.toUpperCase()}</span>
            <span className="signal-strategy">{s.strategy.replace(/_/g, " ")}</span>
          </div>
          <div className="signal-price">${s.price.toFixed(2)}</div>
          <div className="signal-meta">
            <span className="signal-conf">Confidence: {(s.confidence * 100).toFixed(0)}%</span>
            <span className="signal-time">{new Date(s.timestamp).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
