import { useState, useCallback } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { OllamaStatus } from "../components/common/OllamaStatus";
import { api } from "../services/api";

const WATCHLIST_LABELS: Record<string, string> = {
  sp100_top:   "S&P 100",
  top_crypto:  "Top Crypto",
  growth_tech: "Growth Tech",
  etfs:        "ETFs",
};

const MARKET_CONDITIONS = ["trending_up", "trending_down", "ranging", "volatile"];
const MARKET_CAP_OPTIONS = ["mega", "large", "mid", "small"];

interface ScreenerRow {
  symbol: string;
  current_price: number;
  trend_score: number;
  volatility_ann: number;
  momentum_30d: number;
  momentum_90d: number;
  volume_rank: number;
  rsi_14: number;
  market_condition: string;
  sector: string;
  market_cap: string;
}

interface Props {
  onAddToResearch?:   (symbols: string[]) => void;
  onAddToAutoTrader?: (symbols: string[]) => void;
}

export function ScreenerPage({ onAddToResearch, onAddToAutoTrader }: Props) {
  // Persisted: filters, results, and suggestions survive refresh + navigation
  const [watchlist,       setWatchlist]       = usePersistentState<string>("qe_screener_watchlist", "sp100_top");
  const [customSymbols,   setCustomSymbols]   = usePersistentState<string[]>("qe_screener_custom", []);
  const [minVol,          setMinVol]          = usePersistentState<string>("qe_screener_minvol", "");
  const [maxVol,          setMaxVol]          = usePersistentState<string>("qe_screener_maxvol", "");
  const [minMom,          setMinMom]          = usePersistentState<string>("qe_screener_minmom", "");
  const [conditionFilter, setConditionFilter] = usePersistentState<string>("qe_screener_condition", "");
  const [marketCapFilter, setMarketCapFilter] = usePersistentState<string[]>("qe_screener_mcap", []);
  const [results,         setResults]         = usePersistentState<ScreenerRow[]>("qe_screener_results", []);
  const [scanMeta,        setScanMeta]        = usePersistentState<{ scanned: number; results_count: number } | null>("qe_screener_meta", null);
  const [maxPrice,        setMaxPrice]        = usePersistentState<string>("qe_screener_maxprice", "");
  const [customOnly,      setCustomOnly]      = usePersistentState<boolean>("qe_screener_customonly", false);
  const [aiSuggestions,   setAiSuggestions]   = usePersistentState<any[]>("qe_screener_ai_suggestions", []);
  const [suggestionsAt,   setSuggestionsAt]   = usePersistentState<number | null>("qe_screener_suggestions_at", null);

  // Transient UI state (no value in persisting these)
  const [customInput,     setCustomInput]     = useState("");
  const [selected,        setSelected]        = useState<Set<string>>(new Set());
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [aiSugLoading,    setAiSugLoading]    = useState(false);
  const [aiSugError,      setAiSugError]      = useState<string | null>(null);
  const [ollamaStatus,    setOllamaStatus]    = useState<"unknown"|"online"|"offline">("unknown");

  const runScan = useCallback(async () => {
    setLoading(true); setError(null); setResults([]);
    try {
      const req: any = {
        watchlist,
        custom_symbols:   customSymbols,
        custom_only:      customOnly && customSymbols.length > 0,
        limit:            50,
      };
      if (minVol)          req.min_volatility    = parseFloat(minVol) / 100;
      if (maxVol)          req.max_volatility    = parseFloat(maxVol) / 100;
      if (minMom)          req.min_momentum_30d  = parseFloat(minMom) / 100;
      if (maxPrice)        req.max_price         = parseFloat(maxPrice);
      if (conditionFilter) req.market_condition  = conditionFilter;
      if (marketCapFilter.length > 0) req.market_caps = marketCapFilter;

      const data = await api.scanScreener(req);
      setResults(data.results);
      setScanMeta({ scanned: data.scanned, results_count: data.results_count });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [watchlist, customSymbols, customOnly, minVol, maxVol, minMom, maxPrice, conditionFilter, marketCapFilter]);

  const addCustom = () => {
    const sym = customInput.trim().toUpperCase();
    if (sym && !customSymbols.includes(sym)) setCustomSymbols(p => [...p, sym]);
    setCustomInput("");
  };

  const toggleSelect = (sym: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(sym) ? next.delete(sym) : next.add(sym);
      return next;
    });
  };

  const allSelected  = results.length > 0 && results.every(r => selected.has(r.symbol));
  const someSelected = !allSelected && results.some(r => selected.has(r.symbol));
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map(r => r.symbol)));
    }
  };

  const toggleMarketCap = (cap: string) => {
    setMarketCapFilter(prev =>
      prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap]
    );
  };

  const fetchAiSuggestions = async () => {
    setAiSugLoading(true); setAiSugError(null);
    try {
      // Check Ollama health first
      const health = await api.ollamaHealth();
      setOllamaStatus(health.status === "online" ? "online" : "offline");

      // Build market context from active condition filter
      const marketContext = conditionFilter
        ? conditionFilter.replace(/_/g, " ")
        : "current market conditions";

      const res = await api.aiSuggestAssets({
        existing_symbols:  results.map(r => r.symbol),
        market_context:    marketContext,
        risk_tolerance:    "medium",
        // Pass all active filters so the LLM gives grounded, relevant suggestions
        watchlist:         customOnly && customSymbols.length > 0 ? undefined : watchlist,
        custom_symbols:    customSymbols,
        max_price:         maxPrice ? parseFloat(maxPrice) : undefined,
        min_momentum_30d:  minMom   ? parseFloat(minMom) / 100 : undefined,
        market_condition:  conditionFilter || undefined,
        market_caps:       marketCapFilter.length > 0 ? marketCapFilter : undefined,
      });
      if (res.is_fallback) throw new Error(res.error);
      setAiSuggestions(res.suggestions || []);
      setSuggestionsAt(Date.now());
    } catch (e: any) {
      setAiSugError(e.message);
    } finally {
      setAiSugLoading(false);
    }
  };

  const conditionColor = (c: string) => ({
    trending_up:   "var(--green)",
    trending_down: "var(--red)",
    ranging:       "var(--text-sub)",
    volatile:      "var(--orange)",
  }[c] || "var(--text-dim)");

  const pctColor = (v: number) => v >= 0 ? "green" : "red";
  const fmt      = (v: number, decimals = 2) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;

  return (
    <div className="page">
      <OllamaStatus />
      <header className="page-header">
        <div>
          <h1 className="page-title">Asset Screener</h1>
          <p className="page-sub">Discover tradeable assets ranked by trend, volatility, and momentum</p>
        </div>
        {ollamaStatus !== "unknown" && (
          <div className={`ollama-badge ${ollamaStatus}`}>
            {ollamaStatus === "online" ? "◉ Ollama Online" : "○ Ollama Offline"}
          </div>
        )}
      </header>

      <div className="screener-layout">
        {/* ── Filter Sidebar ── */}
        <div className="screener-filters">
          <h3 className="panel-title" style={{ marginBottom: "14px" }}>Filters</h3>

          <div className="form-group">
            <label>Watchlist</label>
            <div className="watchlist-tabs">
              {Object.entries(WATCHLIST_LABELS).map(([id, label]) => (
                <button key={id}
                  className={`watchlist-tab ${watchlist === id ? "active" : ""}`}
                  onClick={() => setWatchlist(id)}
                >{label}</button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Custom Symbols</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input className="input" placeholder="e.g. CCL, F, NIO" value={customInput}
                onChange={e => setCustomInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && addCustom()} />
              <button className="btn-secondary" onClick={addCustom} style={{ flexShrink: 0 }}>+</button>
            </div>
            {customSymbols.length > 0 && (
              <>
                <div className="portfolio-tags" style={{ marginTop: "6px" }}>
                  {customSymbols.map(s => (
                    <span key={s} className="portfolio-tag">
                      {s}
                      <button onClick={() => setCustomSymbols(p => p.filter(x => x !== s))}>×</button>
                    </span>
                  ))}
                </div>
                <label className="custom-only-toggle">
                  <input
                    type="checkbox"
                    checked={customOnly}
                    onChange={e => setCustomOnly(e.target.checked)}
                  />
                  <span>Search Custom Symbols only</span>
                </label>
              </>
            )}
          </div>

          <div className="filter-row">
            <div className="form-group">
              <label>Min Volatility %</label>
              <input className="input" type="number" placeholder="e.g. 20" value={minVol}
                onChange={e => setMinVol(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Max Volatility %</label>
              <input className="input" type="number" placeholder="e.g. 80" value={maxVol}
                onChange={e => setMaxVol(e.target.value)} />
            </div>
          </div>

          <div className="filter-row">
            <div className="form-group">
              <label>Min 30d Momentum %</label>
              <input className="input" type="number" placeholder="e.g. 5" value={minMom}
                onChange={e => setMinMom(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Max Price ($)</label>
              <input className="input" type="number" placeholder="e.g. 50" value={maxPrice}
                onChange={e => setMaxPrice(e.target.value)}
                title="Only show assets priced below this amount. Also applied to AI suggestions." />
            </div>
          </div>

          <div className="form-group">
            <label>Market Condition</label>
            <select className="select" value={conditionFilter} onChange={e => setConditionFilter(e.target.value)}>
              <option value="">All conditions</option>
              {MARKET_CONDITIONS.map(c => (
                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Market Cap</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
              {MARKET_CAP_OPTIONS.map(cap => (
                <button key={cap}
                  className={`filter-chip ${marketCapFilter.includes(cap) ? "active" : ""}`}
                  onClick={() => toggleMarketCap(cap)}
                >{cap}</button>
              ))}
            </div>
          </div>

          <button className="btn-primary" onClick={runScan} disabled={loading}>
            {loading ? "Scanning…" : "▶  Run Screen"}
          </button>

          {error && <div className="error-banner" style={{ marginTop: "10px" }}>⚠ {error}</div>}

          {scanMeta && (
            <div className="scan-meta">
              Scanned {scanMeta.scanned} assets · {scanMeta.results_count} matched
            </div>
          )}

          {/* AI Suggestions */}
          <div className="ai-suggest-box">
            <div className="ai-suggest-header">
              <span>AI Asset Suggestions</span>
              {suggestionsAt && aiSuggestions.length > 0 && (
                <span className="ai-suggest-hint" title="Suggestions are cached — no need to re-fetch unless you want fresh ideas">
                  cached · {Math.round((Date.now() - suggestionsAt) / 60000)}m ago
                </span>
              )}
              {!suggestionsAt && (
                <span className="ai-suggest-hint">Powered by Ollama</span>
              )}
            </div>
            <button className="btn-secondary" onClick={fetchAiSuggestions} disabled={aiSugLoading}
              style={{ width: "100%", marginBottom: aiSuggestions.length > 0 ? "4px" : "8px" }}>
              {aiSugLoading
                ? "Thinking…"
                : aiSuggestions.length > 0
                  ? "↻  Refresh Suggestions"
                  : "✦  Suggest New Assets"}
            </button>
            {aiSuggestions.length > 0 && (
              <p className="ai-sug-cached-note">
                {aiSuggestions.length} suggestion{aiSuggestions.length > 1 ? "s" : ""} cached — click a symbol to research it
              </p>
            )}
            {aiSugError && <div className="error-banner" style={{ fontSize: "11px" }}>⚠ {aiSugError}</div>}
            {aiSuggestions.map((s, i) => (
              <div key={i} className="ai-suggestion-card">
                <div className="ai-sug-top">
                  <strong>{s.symbol}</strong>
                  <span className="ai-sug-class">{s.asset_class}</span>
                </div>
                <p className="ai-sug-rationale">{s.rationale}</p>
                <div className="ai-sug-footer">
                  <span className="ai-sug-strategy">→ {s.complementary_strategy?.replace(/_/g, " ")}</span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {onAddToResearch && (
                      <button className="btn-secondary-sm"
                        onClick={() => onAddToResearch([s.symbol])}
                        title="Run full research pipeline on this asset">
                        Research →
                      </button>
                    )}
                    {onAddToAutoTrader && (
                      <button className="btn-secondary-sm"
                        onClick={() => onAddToAutoTrader([s.symbol])}
                        title="Add to AutoTrader">
                        ⟳ AutoTrader
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Results ── */}
        <div className="screener-results">
          {selected.size > 0 && (
            <div className="screener-action-bar">
              <span>{selected.size} of {results.length} selected</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn-secondary-sm" onClick={toggleSelectAll}>
                  {allSelected ? "Deselect All" : "Select All"}
                </button>
                <button className="btn-secondary-sm" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
                {onAddToResearch && (
                  <button className="btn-primary" style={{ padding: "6px 14px", fontSize: "12px" }}
                    onClick={() => onAddToResearch(Array.from(selected))}>
                    Research Selected →
                  </button>
                )}
                {onAddToAutoTrader && (
                  <button className="btn-primary" style={{ padding: "6px 14px", fontSize: "12px" }}
                    onClick={() => onAddToAutoTrader(Array.from(selected))}>
                    ⟳ AutoTrader →
                  </button>
                )}
              </div>
            </div>
          )}

          {!results.length && !loading && (
            <div className="empty-state">
              <div className="empty-icon">◈</div>
              <p>Set filters and click Run Screen to find assets</p>
              <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "4px" }}>
                Results are ranked by absolute trend strength
              </p>
            </div>
          )}

          {loading && (
            <div className="empty-state">
              <div className="spinner" />
              <p>Fetching market data for all symbols…</p>
            </div>
          )}

          {results.length > 0 && (
            <div className="panel" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table className="data-table screener-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          className="row-checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected; }}
                          onChange={toggleSelectAll}
                          title={allSelected ? "Deselect all" : "Select all results"}
                        />
                      </th>
                      <th>Symbol</th>
                      <th>Price</th>
                      <th>Condition</th>
                      <th>Trend vs MA20</th>
                      <th>30d Momentum</th>
                      <th>Volatility</th>
                      <th>RSI</th>
                      <th>Vol Rank</th>
                      <th>Sector</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.symbol} className={selected.has(r.symbol) ? "row-selected" : ""}
                        onClick={() => toggleSelect(r.symbol)} style={{ cursor: "pointer" }}>
                        <td>
                          <input type="checkbox" className="row-checkbox"
                            checked={selected.has(r.symbol)} onChange={() => toggleSelect(r.symbol)}
                            onClick={e => e.stopPropagation()} />
                        </td>
                        <td><strong>{r.symbol}</strong></td>
                        <td>${r.current_price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                        <td>
                          <span className="condition-badge"
                            style={{ color: conditionColor(r.market_condition) }}>
                            {r.market_condition.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className={pctColor(r.trend_score)}>{fmt(r.trend_score)}</td>
                        <td className={pctColor(r.momentum_30d)}>{fmt(r.momentum_30d)}</td>
                        <td>{(r.volatility_ann * 100).toFixed(1)}%</td>
                        <td>
                          <span className={r.rsi_14 < 30 ? "green" : r.rsi_14 > 70 ? "red" : ""}>
                            {r.rsi_14.toFixed(0)}
                          </span>
                        </td>
                        <td className={r.volume_rank > 1.5 ? "green" : ""}>{r.volume_rank.toFixed(2)}×</td>
                        <td style={{ color: "var(--text-dim)", fontSize: "11px" }}>{r.sector}</td>
                        <td>
                          {onAddToResearch && (
                            <button className="btn-secondary-sm"
                              onClick={e => { e.stopPropagation(); onAddToResearch([r.symbol]); }}>
                              Research
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
