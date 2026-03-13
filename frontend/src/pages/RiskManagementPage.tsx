import { useState } from "react";
import { api } from "../services/api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface HoldingRow { id: number; symbol: string; qty: string; entry_price: string; }

type Tab = "sizer" | "portfolio";

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(v: number | undefined | null) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function dollar(v: number | undefined | null) {
  if (v == null) return "—";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function colorClass(v: number) {
  return v > 0 ? "#00d4a0" : v < 0 ? "#ff4f6d" : "#a0aec0";
}
function corrColor(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 0.85) return "#ff4f6d";
  if (abs >= 0.6)  return "#ff9f40";
  return "#00d4a0";
}

// ── Component ─────────────────────────────────────────────────────────────────
export function RiskManagementPage() {
  const [tab, setTab] = useState<Tab>("sizer");

  // ── Position Sizer state ──────────────────────────────────────────────────
  const [capital,         setCapital]         = useState(10000);
  const [entryPrice,      setEntryPrice]      = useState(100);
  const [stopLossPct,     setStopLossPct]     = useState(5);    // shown as %
  const [riskPct,         setRiskPct]         = useState(2);    // shown as %
  const [winRate,         setWinRate]         = useState("");
  const [avgWin,          setAvgWin]          = useState("");
  const [avgLoss,         setAvgLoss]         = useState("");
  const [sizerResult,     setSizerResult]     = useState<any>(null);
  const [sizerLoading,    setSizerLoading]    = useState(false);
  const [sizerError,      setSizerError]      = useState("");

  async function calcSize() {
    setSizerLoading(true);
    setSizerError("");
    setSizerResult(null);
    try {
      const req: any = {
        capital,
        entry_price:        entryPrice,
        stop_loss_pct:      stopLossPct / 100,
        risk_per_trade_pct: riskPct / 100,
      };
      if (winRate && avgWin && avgLoss) {
        req.win_rate    = parseFloat(winRate) / 100;
        req.avg_win_pct = parseFloat(avgWin) / 100;
        req.avg_loss_pct = parseFloat(avgLoss) / 100;
      }
      const res = await api.calcPositionSize(req);
      setSizerResult(res);
    } catch (e: any) {
      setSizerError(e.message);
    } finally {
      setSizerLoading(false);
    }
  }

  // ── Portfolio Risk state ──────────────────────────────────────────────────
  const [holdings,       setHoldings]       = useState<HoldingRow[]>([{ id: 1, symbol: "", qty: "", entry_price: "" }]);
  const [lookbackDays,   setLookbackDays]   = useState(252);
  const [riskResult,     setRiskResult]     = useState<any>(null);
  const [riskLoading,    setRiskLoading]    = useState(false);
  const [riskError,      setRiskError]      = useState("");

  function addHolding() {
    setHoldings(prev => [...prev, { id: Date.now(), symbol: "", qty: "", entry_price: "" }]);
  }
  function removeHolding(id: number) {
    setHoldings(prev => prev.filter(h => h.id !== id));
  }
  function updateHolding(id: number, field: keyof HoldingRow, value: string) {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, [field]: value } : h));
  }

  async function analyzePortfolio() {
    const valid = holdings.filter(h => h.symbol.trim() && parseFloat(h.qty) > 0 && parseFloat(h.entry_price) > 0);
    if (!valid.length) { setRiskError("Add at least one valid holding."); return; }
    setRiskLoading(true);
    setRiskError("");
    setRiskResult(null);
    try {
      const res = await api.portfolioRisk({
        holdings: valid.map(h => ({
          symbol:      h.symbol.toUpperCase().trim(),
          qty:         parseFloat(h.qty),
          entry_price: parseFloat(h.entry_price),
        })),
        lookback_days: lookbackDays,
      });
      setRiskResult(res);
    } catch (e: any) {
      setRiskError(e.message);
    } finally {
      setRiskLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "24px", maxWidth: "1100px" }}>
      <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "6px" }}>⚖️ Risk Management</h1>
      <p style={{ color: "#a0aec0", marginBottom: "24px", fontSize: "14px" }}>
        Position sizing, VaR analysis, and portfolio correlation diagnostics.
      </p>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        {([ ["sizer", "🎯 Position Sizer"], ["portfolio", "📊 Portfolio Risk"] ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={tab === id ? "btn-primary" : "btn-secondary"}
            style={{ fontSize: "13px" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Position Sizer ─────────────────────────────────────────────────── */}
      {tab === "sizer" && (
        <div>
          <div className="card" style={{ marginBottom: "20px" }}>
            <h3 style={{ marginBottom: "16px", fontSize: "15px" }}>Trade Parameters</h3>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "14px", marginBottom: "16px" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Account Capital ($)</label>
                <input className="input" type="number" min={100}
                  value={capital} onChange={e => setCapital(parseFloat(e.target.value) || 10000)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Entry Price ($)</label>
                <input className="input" type="number" min={0.01} step={0.01}
                  value={entryPrice} onChange={e => setEntryPrice(parseFloat(e.target.value) || 100)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Stop Loss (%)</label>
                <input className="input" type="number" min={0.1} max={50} step={0.1}
                  value={stopLossPct} onChange={e => setStopLossPct(parseFloat(e.target.value) || 5)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Risk per Trade (%)</label>
                <input className="input" type="number" min={0.1} max={20} step={0.1}
                  value={riskPct} onChange={e => setRiskPct(parseFloat(e.target.value) || 2)} />
              </div>
            </div>

            <details style={{ marginBottom: "14px" }}>
              <summary style={{ cursor: "pointer", color: "#a0aec0", fontSize: "13px", marginBottom: "10px" }}>
                ⚡ Optional: Kelly Criterion inputs
              </summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "14px", marginTop: "10px" }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Win Rate (%)</label>
                  <input className="input" type="number" min={1} max={99} placeholder="e.g. 55"
                    value={winRate} onChange={e => setWinRate(e.target.value)} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Avg Win (%)</label>
                  <input className="input" type="number" min={0.1} placeholder="e.g. 8"
                    value={avgWin} onChange={e => setAvgWin(e.target.value)} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Avg Loss (%)</label>
                  <input className="input" type="number" min={0.1} placeholder="e.g. 4"
                    value={avgLoss} onChange={e => setAvgLoss(e.target.value)} />
                </div>
              </div>
            </details>

            <button className="btn-primary" onClick={calcSize} disabled={sizerLoading}>
              {sizerLoading ? "Calculating…" : "Calculate Position Size"}
            </button>
          </div>

          {sizerError && <div className="error-banner" style={{ marginBottom: "16px" }}>{sizerError}</div>}

          {sizerResult && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {/* Fixed-fractional */}
              <div className="card">
                <h4 style={{ marginBottom: "14px", color: "#4a9eff" }}>Fixed-Fractional ({riskPct}% risk)</h4>
                {[
                  ["Shares to buy",     sizerResult.fixed_fractional.shares],
                  ["Position value",    dollar(sizerResult.fixed_fractional.position_value)],
                  ["Capital at risk",   dollar(sizerResult.fixed_fractional.capital_at_risk)],
                  ["Stop-loss price",   dollar(sizerResult.fixed_fractional.stop_price)],
                  ["% of account",      `${sizerResult.fixed_fractional.pct_of_capital}%`],
                ].map(([label, val]) => (
                  <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "14px" }}>
                    <span style={{ color: "#a0aec0" }}>{label}</span>
                    <strong>{val}</strong>
                  </div>
                ))}
              </div>

              {/* Kelly */}
              {sizerResult.kelly ? (
                <div className="card">
                  <h4 style={{ marginBottom: "14px", color: "#c084fc" }}>
                    Kelly Criterion ({(sizerResult.kelly.fraction * 100).toFixed(1)}% risk)
                  </h4>
                  {[
                    ["Kelly fraction",    `${(sizerResult.kelly.fraction * 100).toFixed(2)}%`],
                    ["Shares to buy",     sizerResult.kelly.shares],
                    ["Position value",    dollar(sizerResult.kelly.position_value)],
                    ["Capital at risk",   dollar(sizerResult.kelly.capital_at_risk)],
                    ["% of account",      `${sizerResult.kelly.pct_of_capital}%`],
                  ].map(([label, val]) => (
                    <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "14px" }}>
                      <span style={{ color: "#a0aec0" }}>{label}</span>
                      <strong>{val}</strong>
                    </div>
                  ))}
                  <p style={{ fontSize: "12px", color: "#a0aec0", marginTop: "10px" }}>
                    Half-Kelly applied for safety. Full Kelly would be {(sizerResult.kelly.fraction * 2 * 100).toFixed(1)}%.
                  </p>
                </div>
              ) : (
                <div className="card" style={{ opacity: 0.5 }}>
                  <h4 style={{ marginBottom: "10px", color: "#a0aec0" }}>Kelly Criterion</h4>
                  <p style={{ fontSize: "13px", color: "#a0aec0" }}>
                    Provide win rate, avg win %, and avg loss % above to see a Kelly-sized position.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Portfolio Risk ─────────────────────────────────────────────────── */}
      {tab === "portfolio" && (
        <div>
          <div className="card" style={{ marginBottom: "20px" }}>
            <h3 style={{ marginBottom: "16px", fontSize: "15px" }}>Holdings</h3>

            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Symbol", "Qty", "Entry Price ($)", ""].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: "12px", color: "#a0aec0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => (
                  <tr key={h.id}>
                    <td style={{ padding: "4px 8px" }}>
                      <input className="input" style={{ width: "90px" }} placeholder="AAPL"
                        value={h.symbol} onChange={e => updateHolding(h.id, "symbol", e.target.value.toUpperCase())} />
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      <input className="input" style={{ width: "80px" }} type="number" min={0.001} step={0.001} placeholder="10"
                        value={h.qty} onChange={e => updateHolding(h.id, "qty", e.target.value)} />
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      <input className="input" style={{ width: "100px" }} type="number" min={0.01} step={0.01} placeholder="150.00"
                        value={h.entry_price} onChange={e => updateHolding(h.id, "entry_price", e.target.value)} />
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      {holdings.length > 1 && (
                        <button onClick={() => removeHolding(h.id)}
                          style={{ background: "none", border: "none", color: "#ff4f6d", cursor: "pointer", fontSize: "16px" }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn-secondary" onClick={addHolding} style={{ fontSize: "13px" }}>+ Add Holding</button>
              <div className="form-group" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "13px", whiteSpace: "nowrap" }}>Lookback (days)</label>
                <input className="input" type="number" min={30} max={756} style={{ width: "80px" }}
                  value={lookbackDays} onChange={e => setLookbackDays(parseInt(e.target.value) || 252)} />
              </div>
              <button className="btn-primary" onClick={analyzePortfolio} disabled={riskLoading}
                style={{ fontSize: "13px" }}>
                {riskLoading ? "Analyzing…" : "Analyze Risk"}
              </button>
            </div>
          </div>

          {riskError && <div className="error-banner" style={{ marginBottom: "16px" }}>{riskError}</div>}

          {riskLoading && (
            <div style={{ textAlign: "center", padding: "40px", color: "#a0aec0" }}>
              Fetching historical data and computing risk metrics…
            </div>
          )}

          {riskResult && !riskLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Summary row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
                {[
                  { label: "Total Cost",    val: dollar(riskResult.summary.total_cost),    color: "#a0aec0" },
                  { label: "Current Value", val: dollar(riskResult.summary.total_value),   color: "#a0aec0" },
                  { label: "Total P&L",     val: dollar(riskResult.summary.total_pnl),     color: colorClass(riskResult.summary.total_pnl) },
                  { label: "P&L %",         val: pct(riskResult.summary.total_pnl_pct),    color: colorClass(riskResult.summary.total_pnl_pct) },
                ].map(({ label, val, color }) => (
                  <div key={label} className="card" style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: "11px", color: "#a0aec0", marginBottom: "4px" }}>{label}</div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Risk metrics */}
              <div className="card">
                <h4 style={{ marginBottom: "14px" }}>Risk Metrics
                  <span style={{ fontSize: "11px", color: "#a0aec0", fontWeight: 400, marginLeft: "8px" }}>
                    ({riskResult.risk_metrics.trading_days} trading days lookback)
                  </span>
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px" }}>
                  {[
                    { label: "VaR 95% (daily)",   val: `${riskResult.risk_metrics.var_95?.toFixed(2)}%`,    tip: "5% chance of losing more than this in a single day" },
                    { label: "CVaR 95% (daily)",  val: `${riskResult.risk_metrics.cvar_95?.toFixed(2)}%`,   tip: "Expected loss on a worst-5% day" },
                    { label: "VaR 99% (daily)",   val: `${riskResult.risk_metrics.var_99?.toFixed(2)}%`,    tip: "1% chance of losing more than this in a single day" },
                    { label: "Max Drawdown",       val: `${Math.abs(riskResult.risk_metrics.max_drawdown ?? 0).toFixed(2)}%`, tip: "Largest peak-to-trough loss over the lookback period" },
                    { label: "Sharpe Ratio",       val: riskResult.risk_metrics.sharpe_ratio?.toFixed(3),   tip: "Annualised risk-adjusted return (>1 is good)" },
                  ].map(({ label, val, tip }) => (
                    <div key={label} style={{ background: "var(--bg-active)", borderRadius: "6px", padding: "10px 14px" }} title={tip}>
                      <div style={{ fontSize: "11px", color: "#a0aec0", marginBottom: "4px" }}>{label}</div>
                      <div style={{ fontSize: "16px", fontWeight: 700 }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Positions table */}
              <div className="card">
                <h4 style={{ marginBottom: "12px" }}>Positions</h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Symbol", "Sector", "Qty", "Entry", "Current", "Cost", "Value", "P&L", "P&L %"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "right", color: "#a0aec0", fontWeight: 500 }}
                            className={h === "Symbol" || h === "Sector" ? "text-left" : ""}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {riskResult.positions.map((p: any) => (
                        <tr key={p.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "7px 10px", fontWeight: 600 }}>{p.symbol}</td>
                          <td style={{ padding: "7px 10px", color: "#a0aec0", fontSize: "12px" }}>{p.sector}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{p.qty}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>${p.entry_price}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>${p.current_price}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{dollar(p.cost_basis)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{dollar(p.current_value)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right", color: colorClass(p.pnl) }}>{dollar(p.pnl)}</td>
                          <td style={{ padding: "7px 10px", textAlign: "right", color: colorClass(p.pnl_pct) }}>{pct(p.pnl_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Concentration + Sector side by side */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div className="card">
                  <h4 style={{ marginBottom: "12px" }}>Concentration</h4>
                  {riskResult.concentration.map((c: any) => (
                    <div key={c.symbol} style={{ marginBottom: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "3px" }}>
                        <span>{c.symbol}</span><span>{c.weight_pct}%</span>
                      </div>
                      <div style={{ background: "var(--border)", borderRadius: "4px", height: "6px" }}>
                        <div style={{ width: `${Math.min(c.weight_pct, 100)}%`, height: "100%", background: c.weight_pct > 40 ? "#ff4f6d" : "#4a9eff", borderRadius: "4px" }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card">
                  <h4 style={{ marginBottom: "12px" }}>Sector Exposure</h4>
                  {riskResult.sector_breakdown.map((s: any) => (
                    <div key={s.sector} style={{ marginBottom: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "3px" }}>
                        <span>{s.sector}</span><span>{s.pct}%</span>
                      </div>
                      <div style={{ background: "var(--border)", borderRadius: "4px", height: "6px" }}>
                        <div style={{ width: `${Math.min(s.pct, 100)}%`, height: "100%", background: "#c084fc", borderRadius: "4px" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Correlation matrix */}
              {riskResult.correlation.symbols.length > 1 && (
                <div className="card">
                  <h4 style={{ marginBottom: "12px" }}>Correlation Matrix
                    <span style={{ fontSize: "11px", color: "#a0aec0", fontWeight: 400, marginLeft: "8px" }}>Pearson (daily returns)</span>
                  </h4>
                  {riskResult.high_corr_pairs.length > 0 && (
                    <div className="error-banner" style={{ background: "rgba(255,159,64,0.12)", borderColor: "#ff9f40", color: "#ff9f40", marginBottom: "12px" }}>
                      ⚠️ High correlation detected:{" "}
                      {riskResult.high_corr_pairs.map((p: any) => (
                        <span key={`${p.a}-${p.b}`}><strong>{p.a}–{p.b}</strong> ({(p.correlation * 100).toFixed(0)}%) </span>
                      ))}
                      — consider reducing overlap for better diversification.
                    </div>
                  )}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "5px 10px", background: "var(--bg-active)" }}></th>
                          {riskResult.correlation.symbols.map((s: string) => (
                            <th key={s} style={{ padding: "5px 10px", background: "var(--bg-active)", fontWeight: 600 }}>{s}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {riskResult.correlation.symbols.map((rowSym: string, i: number) => (
                          <tr key={rowSym}>
                            <td style={{ padding: "5px 10px", fontWeight: 600, background: "var(--bg-active)" }}>{rowSym}</td>
                            {riskResult.correlation.matrix[i].map((v: number, j: number) => (
                              <td key={j} style={{
                                padding: "5px 10px",
                                textAlign: "center",
                                background: i === j ? "var(--bg-active)" : `rgba(${v > 0 ? "74,158,255" : "255,79,109"}, ${Math.abs(v) * 0.3})`,
                                color: corrColor(v),
                                fontWeight: i === j ? 700 : 400,
                              }}>
                                {i === j ? "—" : v.toFixed(2)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
