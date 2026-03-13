import { useState, useCallback, useEffect } from "react";
import { usePersistentState, clearAllPersistentState } from "../hooks/usePersistentState";
import { OllamaStatus } from "../components/common/OllamaStatus";
import { api } from "../services/api";

interface ResearchResult {
  symbol: string;
  price_stats?: any;
  strategy_scores?: any[];
  best_strategy?: string;
  news_headlines?: string[];
  ai_analysis?: any;
  error?: string;
}

interface Props {
  /** New symbols pushed from Screener — merged into queue without resetting it */
  pendingSymbols?: string[];
  /** Called after pendingSymbols have been consumed so App can clear them */
  onPendingConsumed?: () => void;
  onAddToPortfolio?: (symbol: string, strategy: string, price: number) => void;
}

const STRATEGY_LABELS: Record<string, string> = {
  moving_average_crossover: "MA Crossover",
  rsi:                      "RSI",
  bollinger_bands:          "Bollinger Bands",
  macd:                     "MACD",
  grid_trading:             "Grid Trading",
};

const REC_COLOR: Record<string, string> = {
  BUY:  "var(--green)",
  SELL: "var(--red)",
  HOLD: "var(--orange)",
};

const COND_ICON: Record<string, string> = {
  trending_up:   "↗",
  trending_down: "↘",
  ranging:       "↔",
  volatile:      "⚡",
};

function pctFmt(v: number): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

// ── Single collapsible result card ──────────────────────────────────────────

function ResultCard({ sym, result, loading, onReanalyse, onRemove, onAddToPortfolio }: {
  sym: string;
  result: ResearchResult | undefined;
  loading: boolean;
  onReanalyse: () => void;
  onRemove: () => void;
  onAddToPortfolio?: (symbol: string, strategy: string, price: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const ai    = result?.ai_analysis;
  const stats = result?.price_stats;
  const done  = !!result && !result.error && !!stats;
  const rec   = ai?.recommendation;

  return (
    <div className="research-card">
      {/* Always-visible header */}
      <div className="research-card-header">
        <div className="research-card-header-left" onClick={() => done && setCollapsed(c => !c)}
          style={{ cursor: done ? "pointer" : "default", flex: 1 }}>
          <span className="research-card-symbol">{sym}</span>
          {loading && <span className="queue-spinner" style={{ marginLeft: 8 }} />}
          {done && rec && !loading && (
            <span className="rec-pill" style={{
              background: `${REC_COLOR[rec] ?? "var(--border)"}22`,
              color: REC_COLOR[rec] ?? "var(--text-sub)",
            }}>{rec}</span>
          )}
          {done && ai?.market_condition && !loading && (
            <span className="research-card-condition">
              {COND_ICON[ai.market_condition]} {ai.market_condition.replace(/_/g, " ")}
            </span>
          )}
          {done && stats && !loading && (
            <span className="research-card-price">
              ${stats.current_price?.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          )}
          {result?.error && !loading && (
            <span style={{ color: "var(--red)", fontSize: "11px" }}>⚠ Error</span>
          )}
        </div>
        <div className="research-card-header-right">
          {done && result?.best_strategy && onAddToPortfolio && (
            <button className="btn-primary" style={{ padding: "5px 14px", fontSize: "11px" }}
              onClick={() => onAddToPortfolio(sym, result.best_strategy!, stats.current_price)}>
              + Portfolio
            </button>
          )}
          <button className="btn-secondary-sm" onClick={onReanalyse} disabled={loading}>
            {loading ? "…" : done ? "↻" : "Analyse"}
          </button>
          <button className="btn-secondary-sm" onClick={onRemove}>×</button>
          {done && (
            <button className="btn-secondary-sm" onClick={() => setCollapsed(c => !c)}>
              {collapsed ? "▼" : "▲"}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="research-card-loading">
          <div className="spinner" style={{ width: 20, height: 20, marginRight: 10 }} />
          <span>Fetching data → running 5 backtests → asking Ollama…</span>
        </div>
      )}

      {result?.error && !loading && (
        <div className="research-card-error">
          <p>⚠ Analysis failed: {result.error}</p>
          <button className="btn-secondary-sm" onClick={onReanalyse} style={{ marginTop: 8 }}>Retry</button>
        </div>
      )}

      {!result && !loading && (
        <div className="research-card-pending">
          Click <strong>Analyse</strong> (or Analyse All) to fetch live data, run backtests, and get an AI recommendation.
        </div>
      )}

      {done && !loading && !collapsed && (
        <div className="research-card-body">
          {ai && !ai.is_fallback && (
            <div className="ai-banner" style={{ borderColor: REC_COLOR[rec] ?? "var(--border)", marginBottom: 14 }}>
              <div className="ai-banner-left">
                <div className="ai-rec-badge" style={{ background: `${REC_COLOR[rec]}22`, color: REC_COLOR[rec] }}>
                  {rec}
                </div>
                <div>
                  <div className="ai-banner-symbol">{sym}</div>
                  <div className="ai-banner-condition">
                    {COND_ICON[ai.market_condition]} {ai.market_condition?.replace(/_/g, " ")} ·{" "}
                    {ai.trend_direction} · {ai.volatility_regime} volatility
                  </div>
                </div>
              </div>
              <div className="ai-banner-right">
                <div className="ai-conf-label">AI Confidence</div>
                <div className="ai-conf-bar-wrap">
                  <div className="ai-conf-bar" style={{
                    width: `${(ai.confidence ?? 0) * 100}%`,
                    background: REC_COLOR[rec],
                  }} />
                </div>
                <div className="ai-conf-pct">{((ai.confidence ?? 0) * 100).toFixed(0)}%</div>
              </div>
            </div>
          )}
          {ai?.is_fallback && (
            <div className="error-banner" style={{ marginBottom: 14 }}>
              ⚠ Ollama unavailable — backtest data only. {ai.error}
            </div>
          )}

          <div className="research-grid">
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Price Statistics</span></div>
              <div className="stats-grid">
                <StatTile label="Current Price"   value={`$${stats.current_price?.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
                <StatTile label="30d Return"      value={pctFmt(stats.return_30d)}      color={stats.return_30d >= 0 ? "var(--green)" : "var(--red)"} />
                <StatTile label="90d Return"      value={pctFmt(stats.return_90d)}      color={stats.return_90d >= 0 ? "var(--green)" : "var(--red)"} />
                <StatTile label="Ann. Volatility" value={`${(stats.volatility_ann * 100).toFixed(1)}%`} />
                <StatTile label="RSI (14)"        value={stats.rsi_14?.toFixed(1)}      color={stats.rsi_14 < 30 ? "var(--green)" : stats.rsi_14 > 70 ? "var(--red)" : undefined} />
                <StatTile label="vs MA20"         value={pctFmt(stats.pct_above_ma20)}  color={stats.pct_above_ma20 >= 0 ? "var(--green)" : "var(--red)"} />
                <StatTile label="vs MA50"         value={pctFmt(stats.pct_above_ma50)}  color={stats.pct_above_ma50 >= 0 ? "var(--green)" : "var(--red)"} />
                <StatTile label="Volume Rank"     value={`${stats.volume_rank?.toFixed(2)}×`} color={stats.volume_rank > 1.5 ? "var(--green)" : undefined} />
              </div>
            </div>

            {ai && !ai.is_fallback && (
              <div className="panel">
                <div className="panel-header"><span className="panel-title">AI Reasoning</span></div>
                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <div className="research-label">Analysis</div>
                    <p className="research-text">{ai.reasoning}</p>
                  </div>
                  <div>
                    <div className="research-label">Key Risk</div>
                    <p className="research-text" style={{ color: "var(--red)" }}>{ai.risks}</p>
                  </div>
                  <div className="research-row">
                    <div>
                      <div className="research-label">Best Strategy</div>
                      <strong style={{ color: "var(--blue)" }}>
                        {STRATEGY_LABELS[ai.best_strategy] ?? ai.best_strategy}
                      </strong>
                    </div>
                    <div>
                      <div className="research-label">Strategy Fit</div>
                      <p className="research-text">{ai.strategy_reasoning}</p>
                    </div>
                  </div>
                  <div className="research-row">
                    <div>
                      <div className="research-label">Holding Period</div>
                      <span style={{ color: "var(--text-sub)" }}>{ai.suggested_holding_period}</span>
                    </div>
                    {ai.key_levels && (
                      <div>
                        <div className="research-label">Key Levels</div>
                        <span style={{ color: "var(--text-sub)" }}>
                          Support ${ai.key_levels.support?.toFixed(2)} · Resistance ${ai.key_levels.resistance?.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Strategy Backtests (1 Year)</span>
                <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>ranked by Sharpe</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Strategy</th><th>Return</th><th>Sharpe</th><th>Max DD</th><th>Win %</th><th>Trades</th><th></th></tr>
                  </thead>
                  <tbody>
                    {(result.strategy_scores ?? [])
                      .filter(s => !s.error && s.total_trades > 0)
                      .sort((a, b) => b.sharpe_ratio - a.sharpe_ratio)
                      .map(s => (
                        <tr key={s.strategy} className={s.strategy === result.best_strategy ? "row-best-strategy" : ""}>
                          <td>
                            {STRATEGY_LABELS[s.strategy] ?? s.strategy}
                            {s.strategy === result.best_strategy && <span className="best-badge">best</span>}
                          </td>
                          <td className={s.total_return >= 0 ? "green" : "red"}>{pctFmt(s.total_return)}</td>
                          <td className={s.sharpe_ratio >= 1 ? "green" : s.sharpe_ratio < 0 ? "red" : ""}>{s.sharpe_ratio.toFixed(2)}</td>
                          <td className="red">{pctFmt(s.max_drawdown)}</td>
                          <td>{(s.win_rate * 100).toFixed(0)}%</td>
                          <td>{s.total_trades}</td>
                          <td>
                            {onAddToPortfolio && (
                              <button className="btn-secondary-sm"
                                onClick={() => onAddToPortfolio(sym, s.strategy, stats.current_price)}>
                                + Portfolio
                              </button>
                            )}
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {result.news_headlines && result.news_headlines.length > 0 && (
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Recent News — {sym}</span></div>
                <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {result.news_headlines.map((h, i) => (
                    <div key={i} className="news-item">
                      <span className="news-bullet">▸</span><span>{h}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {onAddToPortfolio && result.best_strategy && (
              <div className="research-cta">
                <div>
                  <div className="research-label">Recommended allocation</div>
                  <p style={{ color: "var(--text-sub)", fontSize: "13px", marginTop: "2px" }}>
                    {sym} → {STRATEGY_LABELS[result.best_strategy] ?? result.best_strategy}
                    {rec === "BUY" ? " · Signal: BUY" : ""}
                  </p>
                </div>
                <button className="btn-primary" style={{ width: "auto", padding: "10px 24px" }}
                  onClick={() => onAddToPortfolio(sym, result.best_strategy!, stats.current_price)}>
                  Add to Portfolio Builder →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export function ResearchPage({ pendingSymbols = [], onPendingConsumed, onAddToPortfolio }: Props) {
  // Persisted: survive page refresh and navigation
  const [queue,          setQueue]         = usePersistentState<string[]>("qe_research_queue", []);
  const [results,        setResults]       = usePersistentState<Record<string, ResearchResult>>("qe_research_results", {});
  const [lastAnalysedAt, setLastAnalysedAt] = usePersistentState<number | null>("qe_research_last_at", null);

  // Transient: reset on refresh (in-flight state)
  const [symbolInput,   setSymbolInput]   = useState("");
  const [loadingSet,    setLoadingSet]    = useState<Set<string>>(new Set());
  const [analysingAll,  setAnalysingAll]  = useState(false);

  // Merge pending symbols from Screener/App into queue without resetting
  useEffect(() => {
    if (pendingSymbols.length === 0) return;
    setQueue(prev => {
      const merged = [...prev];
      pendingSymbols.forEach(s => { if (!merged.includes(s)) merged.push(s); });
      return merged;
    });
    onPendingConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSymbols]);

  const addToQueue = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (s && !queue.includes(s)) setQueue(p => [...p, s]);
  };

  const removeFromQueue = (sym: string) => {
    setQueue(p => p.filter(s => s !== sym));
    setResults(prev => { const n = { ...prev }; delete n[sym]; return n; });
  };

  const analyseSymbol = useCallback(async (sym: string) => {
    setLoadingSet(prev => new Set(prev).add(sym));
    try {
      const data = await api.researchAsset(sym);
      setResults(prev => ({ ...prev, [sym]: data }));
      setLastAnalysedAt(Date.now());
    } catch (e: any) {
      setResults(prev => ({ ...prev, [sym]: { symbol: sym, error: e.message } }));
    } finally {
      setLoadingSet(prev => { const n = new Set(prev); n.delete(sym); return n; });
    }
  }, []);

  // Fire ALL analyses concurrently — results stream in as they complete
  const analyseAll = async () => {
    if (queue.length === 0) return;
    setAnalysingAll(true);
    await Promise.all(queue.map(sym => analyseSymbol(sym)));
    setAnalysingAll(false);
  };

  const done    = queue.filter(s => results[s] && !results[s].error).length;
  const running = loadingSet.size;
  const pending = queue.filter(s => !results[s] && !loadingSet.has(s)).length;

  return (
    <div className="page">
      <OllamaStatus />
      <header className="page-header">
        <div>
          <h1 className="page-title">AI Research</h1>
          <p className="page-sub">Price analysis · strategy backtests · news · Ollama recommendations</p>
          {done > 0 && lastAnalysedAt && (
            <p className="research-cache-badge">
              <span className="cache-dot" />
              {done} analysis result{done > 1 ? "s" : ""} cached
              {" · "}last updated {Math.round((Date.now() - lastAnalysedAt) / 60000)}m ago
              {" · "}results persist across navigation &amp; page refresh
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {running > 0 && (
            <span style={{ fontSize: "12px", color: "var(--blue)" }}>⟳ {running} running</span>
          )}
          {pending > 0 && queue.length > 1 && (
            <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>{pending} pending</span>
          )}
          {queue.length > 0 && (
            <button className="btn-secondary" onClick={analyseAll}
              disabled={analysingAll || (running > 0 && pending === 0)}>
              {analysingAll ? `Running… (${running} active)` : `▶ Analyse All (${queue.length})`}
            </button>
          )}
          {(queue.length > 0 || Object.keys(results).length > 0) && (
            <button className="btn-secondary"
              style={{ color: "var(--text-dim)", fontSize: "11px" }}
              onClick={() => { setQueue([]); setResults({}); setLastAnalysedAt(null); }}
              title="Clear all research data">
              ✕ Clear all
            </button>
          )}
        </div>
      </header>

      <div className="research-layout">
        {/* ── Sticky sidebar queue ── */}
        <div className="research-queue">
          <div className="research-queue-header">
            <h3 className="panel-title" style={{ marginBottom: "10px" }}>Queue</h3>
            <div style={{ display: "flex", gap: "6px" }}>
              <input className="input" placeholder="Add symbol…" value={symbolInput}
                onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === "Enter") { addToQueue(symbolInput); setSymbolInput(""); }
                }} />
              <button className="btn-secondary" style={{ flexShrink: 0 }}
                onClick={() => { addToQueue(symbolInput); setSymbolInput(""); }}>+</button>
            </div>
          </div>

          <div className="research-queue-list">
            {queue.length === 0 && (
              <p style={{ fontSize: "12px", color: "var(--text-dim)", textAlign: "center", padding: "20px 0" }}>
                Add symbols or send from Screener
              </p>
            )}
            {queue.map(sym => {
              const r       = results[sym];
              const loading = loadingSet.has(sym);
              const isDone  = !!r && !r.error && r.price_stats;
              const isErr   = !!r?.error;
              const rec     = r?.ai_analysis?.recommendation;
              return (
                <div key={sym}
                  className={`queue-item ${isErr ? "error" : isDone ? "done" : ""}`}
                  onClick={() => document.getElementById(`rcard-${sym}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  <div className="queue-item-top">
                    <strong>{sym}</strong>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {loading && <span className="queue-spinner" />}
                      {isDone && rec && <span className="queue-rec" style={{ color: REC_COLOR[rec] }}>{rec}</span>}
                      {isErr && <span style={{ color: "var(--red)", fontSize: "10px" }}>ERR</span>}
                    </div>
                  </div>
                  {isDone && r.best_strategy && (
                    <div className="queue-item-sub">{STRATEGY_LABELS[r.best_strategy] ?? r.best_strategy}</div>
                  )}
                  <div className="queue-item-actions">
                    <button className="btn-secondary-sm"
                      onClick={e => { e.stopPropagation(); analyseSymbol(sym); }} disabled={loading}>
                      {isDone ? "↻" : loading ? "…" : "▶"}
                    </button>
                    <button className="btn-secondary-sm"
                      onClick={e => { e.stopPropagation(); removeFromQueue(sym); }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable results feed ── */}
        <div className="research-feed">
          {queue.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <p>Add symbols to the queue and click Analyse</p>
              <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "4px" }}>
                All results appear here as cards — scroll to compare across stocks
              </p>
            </div>
          ) : (
            queue.map(sym => (
              <div key={sym} id={`rcard-${sym}`}>
                <ResultCard
                  sym={sym}
                  result={results[sym]}
                  loading={loadingSet.has(sym)}
                  onReanalyse={() => analyseSymbol(sym)}
                  onRemove={() => removeFromQueue(sym)}
                  onAddToPortfolio={onAddToPortfolio}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value" style={color ? { color } : undefined}>{value ?? "—"}</span>
    </div>
  );
}
