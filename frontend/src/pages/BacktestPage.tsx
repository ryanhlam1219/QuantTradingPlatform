import { useState } from "react";
import { api } from "../services/api";
import { BacktestResult, CompareResult } from "../types";
import { EquityCurveChart } from "../components/charts/EquityCurveChart";
import { MetricsGrid } from "../components/backtest/MetricsGrid";
import { TradesTable } from "../components/backtest/TradesTable";
import { CompareChart } from "../components/charts/CompareChart";
import { useAlgoParams } from "../hooks/useAlgoParams";

const STRATEGIES = ["moving_average_crossover", "rsi", "bollinger_bands", "macd", "grid_trading"];
const TIMEFRAMES = ["1d", "1w", "4h", "1h"];
const SYMBOL_SUGGESTIONS = ["AAPL","TSLA","NVDA","MSFT","AMZN","GOOGL","SPY","QQQ","META","NFLX"];

type Mode = "single" | "compare" | "portfolio";

export function BacktestPage() {
  const today = new Date().toISOString().split("T")[0];
  const { getParams } = useAlgoParams();

  const [mode, setMode] = useState<Mode>("single");

  // Single / compare / portfolio shared config
  const [form, setForm] = useState({
    symbol:          "AAPL",
    strategy:        "rsi",
    start_date:      "2016-01-01",
    end_date:        today,
    initial_capital: 10000,
    timeframe:       "1d",
    commission:      0,
  });

  // Portfolio specific
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>(["AAPL", "TSLA", "NVDA", "MSFT", "SPY"]);
  const [symbolInput, setSymbolInput]           = useState("");

  const [result,         setResult]         = useState<BacktestResult | null>(null);
  const [compareResults, setCompareResults] = useState<CompareResult[] | null>(null);
  const [portfolioResult,setPortfolioResult]= useState<any | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const clearResults = () => { setResult(null); setCompareResults(null); setPortfolioResult(null); setError(null); };

  const runSingle = async () => {
    setLoading(true); clearResults();
    try {
      const r = await api.runBacktest({
        ...form,
        start_date:      `${form.start_date}T00:00:00Z`,
        end_date:        `${form.end_date}T00:00:00Z`,
        broker:          "alpaca",
        strategy_params: getParams(form.strategy),
      });
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const runCompare = async () => {
    setLoading(true); clearResults();
    try {
      const r = await api.compareStrategies(
        form.symbol,
        `${form.start_date}T00:00:00`,
        `${form.end_date}T00:00:00`,
        form.initial_capital
      );
      setCompareResults(r.results);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const runPortfolio = async () => {
    if (portfolioSymbols.length === 0) { setError("Add at least one symbol to the portfolio"); return; }
    setLoading(true); clearResults();
    try {
      const r = await api.portfolioBacktest({
        symbols:         portfolioSymbols,
        strategy:        form.strategy,
        start_date:      `${form.start_date}T00:00:00`,
        end_date:        `${form.end_date}T00:00:00`,
        total_capital:   form.initial_capital,
        timeframe:       form.timeframe,
        commission:      form.commission,
        strategy_params: getParams(form.strategy),
      });
      setPortfolioResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const addSymbol = () => {
    const sym = symbolInput.trim().toUpperCase();
    if (sym && !portfolioSymbols.includes(sym)) setPortfolioSymbols(p => [...p, sym]);
    setSymbolInput("");
  };

  const runAction = mode === "single" ? runSingle : mode === "compare" ? runCompare : runPortfolio;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Backtesting</h1>
          <p className="page-sub">Simulate strategies against historical data</p>
        </div>
        <div className="mode-tabs">
          {(["single","compare","portfolio"] as Mode[]).map(m => (
            <button key={m} className={`mode-tab ${mode === m ? "active" : ""}`}
              onClick={() => { setMode(m); clearResults(); }}>
              {m === "single" ? "Single Strategy" : m === "compare" ? "Compare All" : "Portfolio"}
            </button>
          ))}
        </div>
      </header>

      <div className="backtest-layout">
        {/* Config Panel */}
        <div className="config-panel">
          <h3 className="panel-title" style={{marginBottom:"14px"}}>Configuration</h3>

          {/* Symbol — single/compare */}
          {mode !== "portfolio" && (
            <div className="form-group">
              <label>Symbol</label>
              <input className="input" value={form.symbol}
                onChange={e => set("symbol", e.target.value.toUpperCase())} placeholder="AAPL" />
            </div>
          )}

          {/* Strategy */}
          <div className="form-group">
            <label>Strategy</label>
            <select className="select" value={form.strategy} onChange={e => set("strategy", e.target.value)}>
              {STRATEGIES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g," ").replace(/\b\w/g,l=>l.toUpperCase())}</option>
              ))}
            </select>
          </div>

          {/* Timeframe */}
          <div className="form-group">
            <label>Timeframe</label>
            <select className="select" value={form.timeframe} onChange={e => set("timeframe", e.target.value)}>
              {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Dates — kept inside config panel */}
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" className="input" value={form.start_date}
              onChange={e => set("start_date", e.target.value)} />
          </div>
          <div className="form-group">
            <label>End Date</label>
            <input type="date" className="input" value={form.end_date}
              onChange={e => set("end_date", e.target.value)} />
          </div>

          <div className="form-group">
            <label>Initial Capital ($)</label>
            <input type="number" className="input" value={form.initial_capital}
              onChange={e => set("initial_capital", Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label>Commission (fraction, e.g. 0.001 = 0.1%)</label>
            <input type="number" step="0.0001" className="input" value={form.commission}
              onChange={e => set("commission", Number(e.target.value))} />
          </div>

          {/* Portfolio symbols */}
          {mode === "portfolio" && (
            <div className="form-group">
              <label>Portfolio Symbols</label>
              <div style={{display:"flex",gap:"6px",marginBottom:"8px"}}>
                <input className="input" placeholder="Add symbol…" value={symbolInput}
                  onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === "Enter" && addSymbol()} />
                <button className="btn-secondary" onClick={addSymbol} style={{flexShrink:0}}>+</button>
              </div>
              <div className="portfolio-tags">
                {portfolioSymbols.map(sym => (
                  <span key={sym} className="portfolio-tag">
                    {sym}
                    <button onClick={() => setPortfolioSymbols(p => p.filter(s => s !== sym))}>×</button>
                  </span>
                ))}
              </div>
              <div className="config-hint">
                Capital of ${form.initial_capital.toLocaleString()} split equally across {portfolioSymbols.length} symbol{portfolioSymbols.length !== 1 ? "s" : ""} (${Math.round(form.initial_capital / Math.max(portfolioSymbols.length,1)).toLocaleString()} each)
              </div>
            </div>
          )}

          <div style={{marginTop:"4px"}}>
            <div className="params-in-use-note">
              ⚙ Using params from Algorithms tab
            </div>
            <button className="btn-primary" onClick={runAction} disabled={loading} style={{marginTop:"8px"}}>
              {loading ? "Running…" : mode === "single" ? "▶ Run Backtest" : mode === "compare" ? "▶ Compare All Strategies" : "▶ Run Portfolio Backtest"}
            </button>
          </div>
          {error && <div className="error-banner">⚠ {error}</div>}
        </div>

        {/* Results */}
        <div className="results-panel">
          {!result && !compareResults && !portfolioResult && !loading && (
            <div className="empty-state">
              <div className="empty-icon">◈</div>
              <p>Configure and run a backtest to see results</p>
              <p style={{fontSize:"11px",color:"var(--text-dim)",marginTop:"4px"}}>Strategy parameters are set in the Algorithms tab</p>
            </div>
          )}
          {loading && (
            <div className="empty-state">
              <div className="spinner" />
              <p>Running simulation…</p>
            </div>
          )}

          {result && (
            <>
              <MetricsGrid result={result} />
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Equity Curve</span></div>
                <EquityCurveChart equityCurve={result.equity_curve} initialCapital={result.config.initial_capital} />
              </div>
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Trade History ({result.total_trades} trades)</span>
                </div>
                <TradesTable trades={result.trades} />
              </div>
            </>
          )}

          {compareResults && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Strategy Comparison — {form.symbol}</span>
              </div>
              <CompareChart results={compareResults} />
              <CompareTable results={compareResults} />
            </div>
          )}

          {portfolioResult && <PortfolioResults result={portfolioResult} />}
        </div>
      </div>
    </div>
  );
}

/* ── Portfolio Results ── */
function PortfolioResults({ result }: { result: any }) {
  const successful = result.results.filter((r: any) => !r.error);
  const failed     = result.results.filter((r: any) =>  r.error);

  const portfolioReturn = result.portfolio_return * 100;

  return (
    <>
      {/* Summary strip */}
      <div className="portfolio-summary">
        <div className="port-stat">
          <span>Portfolio Return</span>
          <strong className={portfolioReturn >= 0 ? "green" : "red"}>
            {portfolioReturn >= 0 ? "+" : ""}{portfolioReturn.toFixed(2)}%
          </strong>
        </div>
        <div className="port-stat">
          <span>Final Value</span>
          <strong>${result.final_portfolio_value.toLocaleString("en-US",{minimumFractionDigits:2})}</strong>
        </div>
        <div className="port-stat">
          <span>Avg Sharpe</span>
          <strong className={result.avg_sharpe_ratio >= 1 ? "green" : ""}>{result.avg_sharpe_ratio.toFixed(2)}</strong>
        </div>
        <div className="port-stat">
          <span>Avg Max DD</span>
          <strong className="red">{(result.avg_max_drawdown * 100).toFixed(1)}%</strong>
        </div>
        <div className="port-stat">
          <span>Symbols</span>
          <strong>{result.symbols.length}</strong>
        </div>
      </div>

      {/* Combined equity curve */}
      {result.combined_equity_curve.length > 1 && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Combined Portfolio Equity Curve</span>
          </div>
          <EquityCurveChart
            equityCurve={result.combined_equity_curve}
            initialCapital={result.total_capital}
          />
        </div>
      )}

      {/* Per-symbol breakdown */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Per-Symbol Results — {result.strategy?.replace(/_/g," ")}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Return</th>
                <th>Ann. Return</th>
                <th>Sharpe</th>
                <th>Max DD</th>
                <th>Win Rate</th>
                <th>Trades</th>
                <th>Final Equity</th>
              </tr>
            </thead>
            <tbody>
              {successful
                .sort((a: any, b: any) => b.total_return - a.total_return)
                .map((r: any) => (
                <tr key={r.symbol}>
                  <td><strong>{r.symbol}</strong></td>
                  <td className={r.total_return >= 0 ? "green" : "red"}>{(r.total_return * 100).toFixed(2)}%</td>
                  <td className={r.annualized_return >= 0 ? "green" : "red"}>{(r.annualized_return * 100).toFixed(2)}%</td>
                  <td className={r.sharpe_ratio >= 1 ? "green" : r.sharpe_ratio < 0 ? "red" : ""}>{r.sharpe_ratio.toFixed(2)}</td>
                  <td className="red">{(r.max_drawdown * 100).toFixed(1)}%</td>
                  <td>{(r.win_rate * 100).toFixed(1)}%</td>
                  <td>{r.total_trades}</td>
                  <td>${r.final_equity.toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                </tr>
              ))}
              {failed.map((r: any) => (
                <tr key={r.symbol}>
                  <td><strong>{r.symbol}</strong></td>
                  <td colSpan={7} className="red">⚠ {r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ── Compare Table ── */
function CompareTable({ results }: { results: CompareResult[] }) {
  const sorted = [...results].filter(r => !r.error).sort((a, b) => b.sharpe_ratio - a.sharpe_ratio);
  return (
    <div className="compare-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Strategy</th><th>Return</th><th>Ann. Return</th>
            <th>Sharpe</th><th>Max DD</th><th>Win Rate</th><th>Trades</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.strategy}>
              <td>{r.strategy.replace(/_/g," ")}</td>
              <td className={r.total_return >= 0 ? "green" : "red"}>{(r.total_return * 100).toFixed(2)}%</td>
              <td className={r.annualized_return >= 0 ? "green" : "red"}>{(r.annualized_return * 100).toFixed(2)}%</td>
              <td className={r.sharpe_ratio >= 1 ? "green" : r.sharpe_ratio < 0 ? "red" : ""}>{r.sharpe_ratio.toFixed(2)}</td>
              <td className="red">{(r.max_drawdown * 100).toFixed(2)}%</td>
              <td>{(r.win_rate * 100).toFixed(1)}%</td>
              <td>{r.total_trades}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
