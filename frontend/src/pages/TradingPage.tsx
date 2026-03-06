import { useState, useEffect, useRef, useCallback } from "react";
import { useAlgoParams } from "../hooks/useAlgoParams";
import { api } from "../services/api";
import { EquityCurveChart } from "../components/charts/EquityCurveChart";

const STRATEGIES = [
  { id: "moving_average_crossover", label: "MA Crossover" },
  { id: "rsi",                      label: "RSI" },
  { id: "bollinger_bands",          label: "Bollinger Bands" },
  { id: "macd",                     label: "MACD" },
  { id: "grid_trading",             label: "Grid Trading" },
];
const SYMBOLS = ["AAPL","TSLA","NVDA","MSFT","AMZN","GOOGL","SPY","QQQ","BTC/USD","ETH/USD"];
const REFRESH_INTERVAL_MS = 30_000; // auto-refresh every 30s

interface AlgoSession {
  id: string;
  symbol: string;
  strategy: string;
  qty: number;
  startedAt: string;
  startEquity: number;
  signals: any[];
  executions: Execution[];
  active: boolean;
}

interface Execution {
  id: string;
  side: "buy" | "sell";
  symbol: string;
  qty: number;
  price: number | null;
  status: string;
  placedAt: string;
  signal: string;
}

export function TradingPage() {
  const [tab, setTab]                   = useState<"monitor"|"manual">("monitor");
  const [account, setAccount]           = useState<any>(null);
  const [positions, setPositions]       = useState<any[]>([]);
  const [orders, setOrders]             = useState<any[]>([]);
  const [closedOrders, setClosedOrders] = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string|null>(null);
  const [lastRefresh, setLastRefresh]   = useState<Date>(new Date());

  // Algo runner state
  const [algoForm, setAlgoForm]   = useState({ symbol: "AAPL", strategy: "rsi", qty: 1 });
  const [sessions, setSessions]   = useState<AlgoSession[]>([]);
  const { getParams } = useAlgoParams();
  const [running, setRunning]     = useState(false);
  const [algoMsg, setAlgoMsg]     = useState<string|null>(null);

  // Manual order state
  const [orderForm, setOrderForm] = useState({ symbol: "AAPL", qty: 1, side: "buy" });
  const [placing, setPlacing]     = useState(false);
  const [orderMsg, setOrderMsg]   = useState<string|null>(null);

  // Equity history for portfolio chart (last 50 snapshots)
  const equityHistory = useRef<{timestamp: string; equity: number}[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [acc, pos, openOrds, closedOrds] = await Promise.all([
        api.getAccount(),
        api.getPositions(),
        api.getOrders("open"),
        api.getOrders("closed"),
      ]);
      setAccount(acc);
      setPositions(pos);
      setOrders(openOrds);
      setClosedOrders((closedOrds as any[]).slice(0, 30));
      setLastRefresh(new Date());

      // Push to equity history
      if (acc?.portfolio_value) {
        const snap = {
          timestamp: new Date().toISOString(),
          equity: parseFloat(acc.portfolio_value),
        };
        equityHistory.current = [...equityHistory.current.slice(-49), snap];
      }
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── Algo execution ──────────────────────────
  const executeAlgo = async () => {
    setRunning(true); setAlgoMsg(null);
    try {
      // 1. Fetch latest signals for the chosen strategy
      const { signals, latest_signal } = await api.generateSignals(
        algoForm.strategy, algoForm.symbol, "1d", 365, getParams(algoForm.strategy)
      );
      if (!latest_signal) {
        setAlgoMsg("⚠ No signal generated for current market conditions.");
        return;
      }

      const side = latest_signal.signal_type === "buy" ? "buy" : "sell";

      // 2. Check we have a position to sell if signal is SELL
      const hasPosition = positions.some(p => p.symbol === algoForm.symbol.toUpperCase());
      if (side === "sell" && !hasPosition) {
        setAlgoMsg(`⚠ SELL signal for ${algoForm.symbol} but no open position to close.`);
        return;
      }

      // 3. Place the order
      const order = await api.placeOrder({
        symbol: algoForm.symbol.toUpperCase(),
        qty: algoForm.qty,
        side,
        order_type: "market",
        time_in_force: "day",
      });

      const execution: Execution = {
        id: order.order?.id || crypto.randomUUID(),
        side,
        symbol: algoForm.symbol.toUpperCase(),
        qty: algoForm.qty,
        price: latest_signal.price,
        status: order.order?.status || "pending",
        placedAt: new Date().toISOString(),
        signal: algoForm.strategy,
      };

      // 4. Log the session
      const sessionId = crypto.randomUUID();
      const newSession: AlgoSession = {
        id: sessionId,
        symbol: algoForm.symbol.toUpperCase(),
        strategy: algoForm.strategy,
        qty: algoForm.qty,
        startedAt: new Date().toISOString(),
        startEquity: parseFloat(account?.portfolio_value || "0"),
        signals,
        executions: [execution],
        active: true,
      };

      setSessions(prev => [newSession, ...prev]);
      setAlgoMsg(`✓ ${side.toUpperCase()} ${algoForm.qty} ${algoForm.symbol} — signal: ${latest_signal.strategy} (confidence: ${(latest_signal.confidence * 100).toFixed(0)}%)`);
      await loadData();
    } catch (e: any) {
      setAlgoMsg(`✗ ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const placeManual = async () => {
    setPlacing(true); setOrderMsg(null);
    try {
      const r = await api.placeOrder({ ...orderForm, order_type: "market", time_in_force: "day" });
      setOrderMsg(`✓ Order placed: ${r.order?.id || "submitted"}`);
      await loadData();
    } catch (e: any) {
      setOrderMsg(`✗ ${e.message}`);
    } finally { setPlacing(false); }
  };

  // ── Derived metrics ──────────────────────────
  const totalUnrealizedPL   = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
  const totalDayPL          = parseFloat(account?.equity || 0) - parseFloat(account?.last_equity || 0);
  const portfolioValue      = parseFloat(account?.portfolio_value || 0);
  const cash                = parseFloat(account?.cash || 0);
  const startingEquity      = equityHistory.current[0]?.equity ?? portfolioValue;
  const sessionReturn       = startingEquity > 0 ? ((portfolioValue - startingEquity) / startingEquity) * 100 : 0;

  if (error && !account) {
    return (
      <div className="page">
        <div className="error-state full">
          <p>⚠ Cannot connect to Alpaca</p>
          <p className="error-detail">{error}</p>
          <p className="error-hint">Check <code>backend/.env</code> — ALPACA_API_KEY and ALPACA_SECRET_KEY must be set</p>
          <button className="btn-secondary" onClick={loadData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Live Trading</h1>
          <p className="page-sub">
            {loading ? "Connecting…" : `Last updated ${lastRefresh.toLocaleTimeString()} · auto-refresh every 30s`}
          </p>
        </div>
        <div style={{display:"flex", gap:"10px", alignItems:"center"}}>
          <div className="paper-mode-badge">PAPER MODE</div>
          <button className="btn-secondary-sm" onClick={loadData}>↻ Refresh</button>
        </div>
      </header>

      {/* ── Account Strip ── */}
      <div className="account-strip">
        <div className="account-stat">
          <span>Portfolio Value</span>
          <strong>${portfolioValue.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})}</strong>
        </div>
        <div className="account-stat">
          <span>Cash</span>
          <strong>${cash.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})}</strong>
        </div>
        <div className="account-stat">
          <span>Buying Power</span>
          <strong>${parseFloat(account?.buying_power||0).toLocaleString("en-US",{minimumFractionDigits:2})}</strong>
        </div>
        <div className="account-stat">
          <span>Unrealized P&L</span>
          <strong className={totalUnrealizedPL >= 0 ? "green" : "red"}>
            {totalUnrealizedPL >= 0 ? "+" : ""}${totalUnrealizedPL.toFixed(2)}
          </strong>
        </div>
        <div className="account-stat">
          <span>Day P&L</span>
          <strong className={totalDayPL >= 0 ? "green" : "red"}>
            {totalDayPL >= 0 ? "+" : ""}${totalDayPL.toFixed(2)}
          </strong>
        </div>
        <div className="account-stat">
          <span>Session Return</span>
          <strong className={sessionReturn >= 0 ? "green" : "red"}>
            {sessionReturn >= 0 ? "+" : ""}{sessionReturn.toFixed(3)}%
          </strong>
        </div>
      </div>

      {/* ── Portfolio Equity Curve ── */}
      {equityHistory.current.length > 1 && (
        <div className="panel" style={{marginBottom:"16px"}}>
          <div className="panel-header"><span className="panel-title">Portfolio Value — Live Session</span></div>
          <EquityCurveChart equityCurve={equityHistory.current} initialCapital={startingEquity} />
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="mode-tabs" style={{marginBottom:"16px"}}>
        <button className={`mode-tab ${tab === "monitor" ? "active" : ""}`} onClick={() => setTab("monitor")}>
          ◎  Algo Execution
        </button>
        <button className={`mode-tab ${tab === "manual" ? "active" : ""}`} onClick={() => setTab("manual")}>
          ⟡  Manual Orders
        </button>
      </div>

      {tab === "monitor" && (
        <div className="trading-layout">
          {/* ── Algo Runner ── */}
          <div className="order-panel">
            <h3 className="panel-title" style={{marginBottom:"14px"}}>Execute Strategy Signal</h3>
            <p style={{fontSize:"11px",color:"var(--text-dim)",marginBottom:"14px",lineHeight:"1.7"}}>
              Fetches the latest signal for the selected strategy and symbol,
              then places a market order if conditions are met.
            </p>

            <div className="form-group">
              <label>Symbol</label>
              <select className="select" value={algoForm.symbol} onChange={e => setAlgoForm(f=>({...f,symbol:e.target.value}))}>
                {SYMBOLS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Strategy</label>
              <select className="select" value={algoForm.strategy} onChange={e => setAlgoForm(f=>({...f,strategy:e.target.value}))}>
                {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Quantity (shares / units)</label>
              <input type="number" className="input" min="1" value={algoForm.qty}
                onChange={e => setAlgoForm(f=>({...f,qty:Number(e.target.value)}))} />
            </div>

            <button className="btn-primary" onClick={executeAlgo} disabled={running}>
              {running ? "Scanning signal…" : "▶  Execute Signal"}
            </button>
            {algoMsg && (
              <div className={`order-msg ${algoMsg.startsWith("✓") ? "success" : "error"}`}>
                {algoMsg}
              </div>
            )}
          </div>

          {/* ── Execution Log ── */}
          <div style={{display:"flex", flexDirection:"column", gap:"16px"}}>
            {/* Open Positions */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Open Positions ({positions.length})</span>
              </div>
              {positions.length === 0
                ? <div className="table-empty">No open positions</div>
                : <table className="data-table">
                    <thead><tr><th>Symbol</th><th>Qty</th><th>Avg Entry</th><th>Current</th><th>Unrealized P&L</th><th>P&L %</th><th></th></tr></thead>
                    <tbody>
                      {positions.map(p => (
                        <tr key={p.symbol}>
                          <td><strong>{p.symbol}</strong></td>
                          <td>{p.qty}</td>
                          <td>${parseFloat(p.avg_entry_price).toFixed(2)}</td>
                          <td>${parseFloat(p.current_price).toFixed(2)}</td>
                          <td className={parseFloat(p.unrealized_pl) >= 0 ? "green" : "red"}>
                            {parseFloat(p.unrealized_pl) >= 0 ? "+" : ""}${parseFloat(p.unrealized_pl).toFixed(2)}
                          </td>
                          <td className={parseFloat(p.unrealized_plpc) >= 0 ? "green" : "red"}>
                            {(parseFloat(p.unrealized_plpc)*100).toFixed(2)}%
                          </td>
                          <td>
                            <button className="btn-close" onClick={() => api.closePosition(p.symbol).then(loadData)}>
                              Close
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </div>

            {/* Strategy Execution History */}
            {sessions.length > 0 && (
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Strategy Execution Log</span></div>
                <table className="data-table">
                  <thead><tr><th>Time</th><th>Symbol</th><th>Strategy</th><th>Side</th><th>Qty</th><th>Signal Price</th><th>Status</th></tr></thead>
                  <tbody>
                    {sessions.flatMap(s => s.executions).map(e => (
                      <tr key={e.id}>
                        <td>{new Date(e.placedAt).toLocaleTimeString()}</td>
                        <td><strong>{e.symbol}</strong></td>
                        <td style={{color:"var(--text-sub)"}}>{e.signal.replace(/_/g," ")}</td>
                        <td className={e.side === "buy" ? "green" : "red"}>{e.side.toUpperCase()}</td>
                        <td>{e.qty}</td>
                        <td>${e.price?.toFixed(2) ?? "—"}</td>
                        <td><span className="status-badge">{e.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Open Orders */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Open Orders ({orders.length})</span>
              </div>
              {orders.length === 0
                ? <div className="table-empty">No open orders</div>
                : <table className="data-table">
                    <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {orders.map(o => (
                        <tr key={o.id}>
                          <td><strong>{o.symbol}</strong></td>
                          <td className={o.side === "buy" ? "green" : "red"}>{o.side.toUpperCase()}</td>
                          <td>{o.qty}</td>
                          <td>{o.type}</td>
                          <td><span className="status-badge">{o.status}</span></td>
                          <td><button className="btn-close" onClick={() => api.cancelOrder(o.id).then(loadData)}>Cancel</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </div>

            {/* Closed Orders / Trade History */}
            {closedOrders.length > 0 && (
              <div className="panel">
                <div className="panel-header"><span className="panel-title">Recent Fills ({closedOrders.length})</span></div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Filled Avg</th><th>Filled At</th><th>Status</th></tr></thead>
                    <tbody>
                      {closedOrders.map(o => (
                        <tr key={o.id}>
                          <td><strong>{o.symbol}</strong></td>
                          <td className={o.side === "buy" ? "green" : "red"}>{o.side.toUpperCase()}</td>
                          <td>{o.filled_qty || o.qty}</td>
                          <td>{o.filled_avg_price ? `$${parseFloat(o.filled_avg_price).toFixed(2)}` : "—"}</td>
                          <td>{o.filled_at ? new Date(o.filled_at).toLocaleString() : "—"}</td>
                          <td><span className="status-badge">{o.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "manual" && (
        <div className="trading-layout">
          <div className="order-panel">
            <h3 className="panel-title" style={{marginBottom:"14px"}}>Place Manual Order</h3>
            <div className="side-tabs">
              <button className={`side-tab ${orderForm.side==="buy"?"active-buy":""}`}
                onClick={() => setOrderForm(f=>({...f,side:"buy"}))}>BUY</button>
              <button className={`side-tab ${orderForm.side==="sell"?"active-sell":""}`}
                onClick={() => setOrderForm(f=>({...f,side:"sell"}))}>SELL</button>
            </div>
            <div className="form-group">
              <label>Symbol</label>
              <input className="input" value={orderForm.symbol}
                onChange={e => setOrderForm(f=>({...f,symbol:e.target.value.toUpperCase()}))} />
            </div>
            <div className="form-group">
              <label>Quantity</label>
              <input type="number" className="input" min="1" value={orderForm.qty}
                onChange={e => setOrderForm(f=>({...f,qty:Number(e.target.value)}))} />
            </div>
            <div className="order-type-info">Market Order · Day</div>
            <button className={`btn-order ${orderForm.side}`} onClick={placeManual} disabled={placing}>
              {placing ? "Placing…" : `${orderForm.side.toUpperCase()} ${orderForm.symbol}`}
            </button>
            {orderMsg && <div className={`order-msg ${orderMsg.startsWith("✓")?"success":"error"}`}>{orderMsg}</div>}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Open Positions ({positions.length})</span></div>
              {positions.length === 0 ? <div className="table-empty">No open positions</div>
                : <table className="data-table">
                    <thead><tr><th>Symbol</th><th>Qty</th><th>Avg Entry</th><th>Current</th><th>P&L</th><th>P&L %</th><th></th></tr></thead>
                    <tbody>
                      {positions.map(p => (
                        <tr key={p.symbol}>
                          <td><strong>{p.symbol}</strong></td>
                          <td>{p.qty}</td>
                          <td>${parseFloat(p.avg_entry_price).toFixed(2)}</td>
                          <td>${parseFloat(p.current_price).toFixed(2)}</td>
                          <td className={parseFloat(p.unrealized_pl)>=0?"green":"red"}>${parseFloat(p.unrealized_pl).toFixed(2)}</td>
                          <td className={parseFloat(p.unrealized_plpc)>=0?"green":"red"}>{(parseFloat(p.unrealized_plpc)*100).toFixed(2)}%</td>
                          <td><button className="btn-close" onClick={()=>api.closePosition(p.symbol).then(loadData)}>Close</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
