import { useState, useCallback, useEffect } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { api } from "../services/api";
import { EquityCurveChart } from "../components/charts/EquityCurveChart";

const STRATEGIES = [
  { id: "moving_average_crossover", label: "MA Crossover" },
  { id: "rsi",                      label: "RSI" },
  { id: "bollinger_bands",          label: "Bollinger Bands" },
  { id: "macd",                     label: "MACD" },
  { id: "grid_trading",             label: "Grid Trading" },
];

interface PortfolioItem {
  symbol:        string;
  strategy:      string;
  current_price: number;
}

interface BuiltItem extends PortfolioItem {
  sharpe_ratio:  number;
  total_return:  number;
  max_drawdown:  number;
  win_rate:      number;
  total_trades:  number;
  weight:        number;
  weight_pct:    number;
  capital:       number;
  shares:        number;
  error?:        string;
}

interface Props {
  /** New pairs pushed from Research/Screener */
  pendingItems?: { symbol: string; strategy: string; current_price: number }[];
  /** Called after pendingItems have been consumed */
  onPendingConsumed?: () => void;
}

const GO_COLOR: Record<string, string> = {
  GO:      "var(--green)",
  CAUTION: "var(--orange)",
  NO_GO:   "var(--red)",
};

export function PortfolioBuilderPage({ pendingItems = [], onPendingConsumed }: Props) {
  // Persisted: survive refresh and navigation
  const [items,            setItems]          = usePersistentState<PortfolioItem[]>("qe_portfolio_items", []);
  const [capital,          setCapital]        = usePersistentState<number>("qe_portfolio_capital", 10000);
  const [plan,             setPlan]           = usePersistentState<{ items: BuiltItem[]; ai_review: any; built_at: string } | null>("qe_portfolio_plan", null);
  const [validationResult, setValidationResult] = usePersistentState<any | null>("qe_portfolio_validation", null);
  const [oosDays,          setOosDays]        = usePersistentState<number>("qe_portfolio_oos_days", 90);

  // Transient UI state
  const [symbolInput,    setSymbolInput]   = useState("");
  const [strategyInput,  setStrategyInput] = useState("rsi");
  const [priceInput,     setPriceInput]    = useState("");
  const [reviewAi,       setReviewAi]      = useState(true);
  const [buildLoading,   setBuildLoading]  = useState(false);
  const [buildError,     setBuildError]    = useState<string | null>(null);
  const [executing,      setExecuting]     = useState(false);
  const [execResults,    setExecResults]   = useState<any[] | null>(null);
  const [execError,      setExecError]     = useState<string | null>(null);
  const [validating,     setValidating]    = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Merge pending items from Research/Screener without resetting existing items
  useEffect(() => {
    if (pendingItems.length === 0) return;
    setItems(prev => {
      const merged = [...prev];
      pendingItems.forEach(p => {
        if (!merged.some(i => i.symbol === p.symbol && i.strategy === p.strategy)) {
          merged.push(p);
        }
      });
      return merged;
    });
    onPendingConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItems]);

  const addItem = () => {
    const sym = symbolInput.trim().toUpperCase();
    if (!sym) return;
    if (items.some(i => i.symbol === sym && i.strategy === strategyInput)) return;
    setItems(p => [...p, {
      symbol: sym,
      strategy: strategyInput,
      current_price: parseFloat(priceInput) || 0,
    }]);
    setSymbolInput(""); setPriceInput("");
  };

  const removeItem = (sym: string, strat: string) =>
    setItems(p => p.filter(i => !(i.symbol === sym && i.strategy === strat)));

  const updateStrategy = (sym: string, oldStrat: string, newStrat: string) =>
    setItems(p => p.map(i => i.symbol === sym && i.strategy === oldStrat
      ? { ...i, strategy: newStrat } : i));

  const buildPlan = async () => {
    if (items.length === 0) { setBuildError("Add at least one asset"); return; }
    setBuildLoading(true); setBuildError(null); setPlan(null); setExecResults(null);
    try {
      const result = await api.buildPortfolio({
        pairs: items,
        total_capital: capital,
        review_with_ai: reviewAi,
      });
      setPlan(result);
    } catch (e: any) {
      setBuildError(e.message);
    } finally {
      setBuildLoading(false);
    }
  };

  const executePlan = async () => {
    if (!plan) return;
    setExecuting(true); setExecError(null); setExecResults(null);
    try {
      const execItems = plan.items
        .filter(i => !i.error && i.shares > 0)
        .map(i => ({ symbol: i.symbol, strategy: i.strategy, shares: i.shares, side: "buy" }));
      const result = await api.executePortfolio(execItems, false);
      setExecResults(result.results);
    } catch (e: any) {
      setExecError(e.message);
    } finally {
      setExecuting(false);
    }
  };

  const validatePlan = async () => {
    if (!items.length) return;
    setValidating(true); setValidationError(null); setValidationResult(null);
    try {
      const result = await api.validatePortfolio(
        items.map(i => ({ symbol: i.symbol, strategy: i.strategy, current_price: i.current_price })),
        oosDays,
      );
      setValidationResult(result);
    } catch (e: any) {
      setValidationError(e.message);
    } finally {
      setValidating(false);
    }
  };

  const ai = plan?.ai_review;
  const totalWeightPct = plan?.items.reduce((s, i) => s + (i.weight_pct ?? 0), 0) ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Portfolio Builder</h1>
          <p className="page-sub">Map assets to strategies · Sharpe-weighted allocation · approve & execute</p>
        </div>
        {(items.length > 0 || plan) && (
          <button className="btn-secondary"
            style={{ color: "var(--text-dim)", fontSize: "11px" }}
            onClick={() => { setItems([]); setPlan(null); setValidationResult(null); setExecResults(null); }}
            title="Clear all portfolio data">
            ✕ Clear all
          </button>
        )}
      </header>

      <div className="builder-layout">
        {/* ── Input panel ── */}
        <div className="builder-input-panel">
          <h3 className="panel-title" style={{ marginBottom: "14px" }}>Asset–Strategy Pairs</h3>

          {/* Add form */}
          <div className="builder-add-row">
            <input className="input" placeholder="Symbol" value={symbolInput}
              onChange={e => setSymbolInput(e.target.value.toUpperCase())}
              style={{ flex: 2 }} />
            <select className="select" value={strategyInput} onChange={e => setStrategyInput(e.target.value)}
              style={{ flex: 3 }}>
              {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input className="input" type="number" placeholder="Price" value={priceInput}
              onChange={e => setPriceInput(e.target.value)} style={{ flex: 2 }} />
            <button className="btn-secondary" onClick={addItem} style={{ flexShrink: 0 }}>+</button>
          </div>
          <div className="config-hint" style={{ marginBottom: "12px" }}>
            Tip: Symbols added from Research page auto-fill the strategy and price
          </div>

          {/* Items list */}
          {items.length === 0 && (
            <div className="table-empty" style={{ background: "var(--bg-elevated)", borderRadius: "8px" }}>
              No assets yet — add above or pass from Research
            </div>
          )}
          {items.map((item, i) => (
            <div key={`${item.symbol}-${item.strategy}-${i}`} className="builder-item-row">
              <strong style={{ minWidth: "60px" }}>{item.symbol}</strong>
              <select className="select" value={item.strategy}
                onChange={e => updateStrategy(item.symbol, item.strategy, e.target.value)}
                style={{ flex: 1, fontSize: "12px" }}>
                {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              {item.current_price > 0 && (
                <span style={{ fontSize: "12px", color: "var(--text-dim)", minWidth: "70px" }}>
                  ${item.current_price.toFixed(2)}
                </span>
              )}
              <button className="btn-close"
                onClick={() => removeItem(item.symbol, item.strategy)}>×</button>
            </div>
          ))}

          <div style={{ marginTop: "16px" }} className="form-group">
            <label>Total Capital ($)</label>
            <input type="number" className="input" value={capital}
              onChange={e => setCapital(Number(e.target.value))} />
          </div>

          <div className="builder-toggle-row">
            <label className="toggle-label">
              <input type="checkbox" checked={reviewAi} onChange={e => setReviewAi(e.target.checked)} />
              AI portfolio review (Ollama)
            </label>
          </div>

          <button className="btn-primary" onClick={buildPlan} disabled={buildLoading || items.length === 0}
            style={{ marginTop: "8px" }}>
            {buildLoading ? "Building plan…" : "▶  Build Allocation Plan"}
          </button>
          {buildError && <div className="error-banner">{buildError}</div>}
        </div>

        {/* ── Results panel ── */}
        <div className="builder-results">
          {!plan && !buildLoading && (
            <div className="empty-state">
              <div className="empty-icon">◈</div>
              <p>Add assets and click Build to generate a Sharpe-weighted allocation plan</p>
              <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "6px" }}>
                The plan shows capital split, position sizes, and an AI portfolio review before you commit to execution
              </p>
            </div>
          )}

          {buildLoading && (
            <div className="empty-state">
              <div className="spinner" />
              <p>Running backtests and computing allocation…</p>
            </div>
          )}

          {plan && (
            <>
              {/* AI Review Banner */}
              {ai && !ai.is_fallback && (
                <div className="ai-review-banner" style={{ borderColor: GO_COLOR[ai.go_no_go] ?? "var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div className="ai-go-badge" style={{
                        background: `${GO_COLOR[ai.go_no_go]}22`,
                        color: GO_COLOR[ai.go_no_go],
                      }}>{ai.go_no_go}</div>
                      <div className="ai-review-score">Portfolio Score: {ai.overall_score}/10</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="research-label">Strongest</div>
                      <span style={{ color: "var(--green)" }}>{ai.strongest_position}</span>
                      <div className="research-label" style={{ marginTop: "4px" }}>Watch</div>
                      <span style={{ color: "var(--orange)" }}>{ai.weakest_position}</span>
                    </div>
                  </div>
                  <p className="ai-review-comment">{ai.diversification_comment}</p>
                  {ai.concentration_risk && (
                    <p className="ai-review-comment" style={{ color: "var(--orange)" }}>
                      ⚠ {ai.concentration_risk}
                    </p>
                  )}
                  {ai.suggestions?.length > 0 && (
                    <ul className="ai-review-suggestions">
                      {ai.suggestions.map((s: string, i: number) => (
                        <li key={i}>▸ {s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {ai?.is_fallback && (
                <div className="error-banner" style={{ marginBottom: "14px" }}>
                  Ollama unavailable for portfolio review — {ai.error}
                </div>
              )}

              {/* Allocation table */}
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Allocation Plan — ${capital.toLocaleString()}</span>
                  <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                    {plan.items.length} positions · {totalWeightPct.toFixed(1)}% allocated
                  </span>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Symbol</th><th>Strategy</th><th>Sharpe</th>
                        <th>1Y Return</th><th>Max DD</th><th>Weight</th>
                        <th>Capital</th><th>Shares</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.items
                        .sort((a, b) => b.weight - a.weight)
                        .map(item => (
                        <tr key={`${item.symbol}-${item.strategy}`}>
                          <td>
                            <strong>{item.symbol}</strong>
                            {item.error && (
                              <span style={{ fontSize: "10px", color: "var(--red)", marginLeft: "6px" }}>
                                ⚠ {item.error}
                              </span>
                            )}
                          </td>
                          <td style={{ color: "var(--text-sub)" }}>
                            {STRATEGIES.find(s => s.id === item.strategy)?.label ?? item.strategy}
                          </td>
                          <td className={item.sharpe_ratio >= 1 ? "green" : item.sharpe_ratio < 0 ? "red" : ""}>
                            {item.sharpe_ratio.toFixed(2)}
                          </td>
                          <td className={item.total_return >= 0 ? "green" : "red"}>
                            {pctFmt(item.total_return)}
                          </td>
                          <td className="red">{pctFmt(item.max_drawdown)}</td>
                          <td>
                            <div className="weight-bar-wrap">
                              <div className="weight-bar" style={{ width: `${item.weight_pct}%` }} />
                              <span>{item.weight_pct.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td>${item.capital.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                          <td>{item.shares}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Walk-Forward Validation ── */}
              <div className="wfv-box">
                <div className="wfv-header">
                  <div>
                    <h4 className="wfv-title">📊 Walk-Forward Validation</h4>
                    <p className="wfv-desc">
                      Tests your strategies on a <strong>recent hold-out period</strong> that was{" "}
                      <em>not</em> used to select them. If out-of-sample (OOS) performance is close
                      to in-sample, the strategies generalise — not just overfit to history.
                    </p>
                  </div>
                  <div className="wfv-controls">
                    <span className="wfv-label">Hold-out window</span>
                    <div className="wfv-tabs">
                      {[30, 60, 90].map(d => (
                        <button key={d}
                          className={`wfv-tab ${oosDays === d ? "active" : ""}`}
                          onClick={() => setOosDays(d)}>{d}d</button>
                      ))}
                    </div>
                    <button className="btn-secondary" onClick={validatePlan} disabled={validating || items.length === 0}>
                      {validating ? "Validating…" : "▶ Run Validation"}
                    </button>
                  </div>
                </div>

                {validationError && <div className="error-banner">{validationError}</div>}

                {validationResult && (
                  <div className="wfv-results">
                    {/* Verdict banner */}
                    <div className={`wfv-verdict ${validationResult.verdict.verdict.toLowerCase()}`}>
                      <div className="wfv-verdict-left">
                        <span className="wfv-verdict-badge">{validationResult.verdict.verdict}</span>
                        <div>
                          <div className="wfv-verdict-periods">
                            IS: {validationResult.is_period} &nbsp;·&nbsp; OOS: {validationResult.oos_period}
                          </div>
                          <p className="wfv-verdict-summary">{validationResult.verdict.summary}</p>
                        </div>
                      </div>
                      <div className="wfv-confidence">
                        <div className="wfv-conf-label">Confidence</div>
                        <div className="wfv-conf-ring">
                          <svg viewBox="0 0 36 36" className="wfv-conf-svg">
                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border-bright)" strokeWidth="3"/>
                            <circle cx="18" cy="18" r="15.9" fill="none"
                              stroke={validationResult.verdict.confidence_score >= 60 ? "var(--green)" :
                                      validationResult.verdict.confidence_score >= 30 ? "var(--orange)" : "var(--red)"}
                              strokeWidth="3"
                              strokeDasharray={`${validationResult.verdict.confidence_score} 100`}
                              strokeLinecap="round"
                              transform="rotate(-90 18 18)"/>
                            <text x="18" y="22" textAnchor="middle" fontSize="9" fontWeight="700"
                              fill="var(--text)">{validationResult.verdict.confidence_score}</text>
                          </svg>
                        </div>
                        <div className="wfv-conf-sub">/ 100</div>
                      </div>
                    </div>

                    {/* Summary stats */}
                    <div className="wfv-summary-row">
                      <div className="wfv-stat-tile">
                        <span className="wfv-stat-label">Avg IS Sharpe</span>
                        <span className="wfv-stat-value" style={{ color: validationResult.verdict.avg_is_sharpe >= 1 ? "var(--green)" : "var(--orange)" }}>
                          {validationResult.verdict.avg_is_sharpe?.toFixed(2)}
                        </span>
                      </div>
                      <div className="wfv-stat-tile">
                        <span className="wfv-stat-label">Avg OOS Sharpe</span>
                        <span className="wfv-stat-value" style={{ color: validationResult.verdict.avg_oos_sharpe >= 0.5 ? "var(--green)" : validationResult.verdict.avg_oos_sharpe < 0 ? "var(--red)" : "var(--orange)" }}>
                          {validationResult.verdict.avg_oos_sharpe?.toFixed(2)}
                        </span>
                      </div>
                      <div className="wfv-stat-tile">
                        <span className="wfv-stat-label">Degradation</span>
                        <span className="wfv-stat-value" style={{ color: validationResult.verdict.degradation_pct < 40 ? "var(--green)" : "var(--orange)" }}>
                          {validationResult.verdict.degradation_pct?.toFixed(0)}%
                        </span>
                      </div>
                      <div className="wfv-stat-tile">
                        <span className="wfv-stat-label">OOS Profitable</span>
                        <span className="wfv-stat-value">{validationResult.verdict.profitable_oos}</span>
                      </div>
                    </div>

                    {/* Per-pair table */}
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Symbol</th><th>Strategy</th>
                            <th>IS Sharpe</th><th>IS Return</th>
                            <th>OOS Sharpe</th><th>OOS Return</th>
                            <th>OOS Max DD</th><th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validationResult.items.map((item: any, i: number) => {
                            const degraded = item.oos_sharpe < item.is_sharpe * 0.5;
                            const improved = item.oos_sharpe >= item.is_sharpe * 0.8;
                            return (
                              <tr key={i}>
                                <td><strong>{item.symbol}</strong></td>
                                <td style={{ color: "var(--text-sub)", fontSize: "11px" }}>
                                  {STRATEGIES.find(s => s.id === item.strategy)?.label ?? item.strategy}
                                </td>
                                <td className={item.is_sharpe >= 1 ? "green" : ""}>{item.is_sharpe?.toFixed(2)}</td>
                                <td className={item.is_return >= 0 ? "green" : "red"}>{pctFmt(item.is_return)}</td>
                                <td className={item.oos_sharpe >= 0.5 ? "green" : item.oos_sharpe < 0 ? "red" : ""}>
                                  {item.oos_error ? "—" : item.oos_sharpe?.toFixed(2)}
                                </td>
                                <td className={item.oos_return >= 0 ? "green" : "red"}>
                                  {item.oos_error ? "—" : pctFmt(item.oos_return)}
                                </td>
                                <td className="red">{item.oos_error ? "—" : pctFmt(item.oos_max_dd)}</td>
                                <td>
                                  {item.oos_error
                                    ? <span style={{ color: "var(--red)", fontSize: "10px" }}>Error</span>
                                    : improved
                                    ? <span style={{ color: "var(--green)", fontSize: "11px" }}>✓ Holds up</span>
                                    : degraded
                                    ? <span style={{ color: "var(--orange)", fontSize: "11px" }}>⚠ Degraded</span>
                                    : <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>~ Moderate</span>
                                  }
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="wfv-footnote">
                      IS = in-sample (full year used for allocation) · OOS = out-of-sample ({validationResult.oos_days}-day hold-out not used in selection)
                    </p>
                  </div>
                )}
              </div>

              {/* Execute section */}
              {!execResults && (
                <div className="execute-box">
                  <div>
                    <h4 style={{ color: "var(--text)", marginBottom: "4px" }}>Execute Portfolio</h4>
                    <p style={{ fontSize: "12px", color: "var(--text-dim)" }}>
                      ⚠ This places real market orders on your Alpaca paper account.
                      {validationResult
                        ? validationResult.verdict.verdict === "VALIDATED"
                          ? " ✓ Walk-forward validated — confidence is good."
                          : validationResult.verdict.verdict === "CAUTION"
                          ? " ⚠ Walk-forward shows degradation — consider reducing size."
                          : " ✗ Walk-forward rejected — review strategies before executing."
                        : " Run walk-forward validation above before executing."}
                    </p>
                  </div>
                  <button className="btn-execute live" onClick={executePlan} disabled={executing}>
                    {executing ? "Executing…" : "▶ Execute All Orders"}
                  </button>
                  {execError && <div className="error-banner">{execError}</div>}
                </div>
              )}

              {execResults && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Execution Results</span>
                    <span style={{ fontSize: "12px", color: "var(--green)" }}>
                      {execResults.filter(r => r.success).length}/{execResults.length} filled
                    </span>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr><th>Symbol</th><th>Strategy</th><th>Shares</th><th>Side</th><th>Status</th><th>Order ID</th></tr>
                    </thead>
                    <tbody>
                      {execResults.map((r: any, i: number) => (
                        <tr key={i}>
                          <td><strong>{r.symbol}</strong></td>
                          <td style={{ color: "var(--text-sub)" }}>
                            {STRATEGIES.find(s => s.id === r.strategy)?.label ?? r.strategy}
                          </td>
                          <td>{r.shares}</td>
                          <td className="green">{r.side?.toUpperCase()}</td>
                          <td>
                            {r.success
                              ? <span style={{ color: "var(--green)" }}>✓ Filled</span>
                              : <span style={{ color: "var(--red)" }}>✗ {r.error}</span>}
                          </td>
                          <td style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                            {r.order_result?.id ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function pctFmt(v: number): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}
