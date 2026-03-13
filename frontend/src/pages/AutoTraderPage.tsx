import { useState, useEffect, useRef, useCallback } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { api } from "../services/api";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

interface Cycle {
  id:                    string;
  name:                  string;
  symbols:               string[];
  total_capital:         number;
  interval_minutes:      number;
  lookback_days?:        number;
  auto_execute:          boolean;
  dry_run:               boolean;
  max_cycles:            number | null;
  stop_loss_pct:         number | null;
  stop_at:               string | null;
  daily_loss_limit_pct:  number | null;
  status:                "idle" | "running" | "stopped" | "error";
  runs_completed:        number;
  last_run_at:           string | null;
  next_run_at:           string | null;
  stop_reason:           string | null;
  last_result_summary?:  { ran_at: string; allocation_method: string; portfolio_thesis: string; item_count: number } | null;
  created_at:            string;
}

interface RunItem {
  symbol:        string;
  weight_pct:    number | null;
  capital:       number | null;
  shares:        number | null;
  current_price: number | null;
  best_strategy: string | null;
  sharpe_ratio:  number | null;
}

interface RunEntry {
  run_number:        number;
  ran_at:            string;
  allocation_method: "ai" | "sharpe_fallback";
  portfolio_thesis:  string;
  risk_notes?:       string;
  items:             RunItem[];
}

interface CycleLog { ts: string; level: string; msg: string; }

interface AutoTraderItem {
  symbol:           string;
  best_strategy:    string | null;
  current_price:    number;
  weight:           number;
  weight_pct:       number;
  capital:          number;
  shares:           number;
  weight_reasoning: string;
  price_stats:      Record<string, number>;
  ai_analysis:      Record<string, any>;
  strategy_scores:  any[];
  error?:           string;
  excluded?:        boolean;
  exclusion_reason?: string;
}

interface AutoTraderResult {
  items:             AutoTraderItem[];
  total_capital:     number;
  portfolio_thesis:  string;
  risk_notes:        string;
  allocation_method: "ai" | "sharpe_fallback";
  ran_at:            string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  moving_average_crossover: "MA Crossover",
  rsi:                      "RSI",
  bollinger_bands:          "Bollinger Bands",
  macd:                     "MACD",
  grid_trading:             "Grid Trading",
};

const REC_COLORS: Record<string, string> = {
  BUY:  "var(--green)",
  SELL: "var(--red)",
  HOLD: "var(--text-dim)",
};

function fmt(n: number | undefined, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function pct(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  pendingSymbols?:    string[];
  onPendingConsumed?: () => void;
}

export function AutoTraderPage({ pendingSymbols = [], onPendingConsumed }: Props) {
  // ── Tab ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"manual" | "cycles" | "backtest">("manual");

  // Persisted so navigation doesn't wipe results
  const [result, setResult]   = usePersistentState<AutoTraderResult | null>("qe_autotrader_result", null);
  const [capital, setCapital] = usePersistentState<number>("qe_autotrader_capital", 10000);

  // Transient UI state
  const [symbolInput, setSymbolInput] = useState("");
  const [symbols, setSymbols]         = useState<string[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Override shares per symbol before executing
  const [sharesOverride, setSharesOverride] = useState<Record<string, number>>({});
  const [deselected, setDeselected]         = useState<Set<string>>(new Set());

  const [executing, setExecuting]     = useState(false);
  const [execResults, setExecResults] = useState<any[] | null>(null);
  const [execError, setExecError]     = useState<string | null>(null);
  const [buyingPower, setBuyingPower] = useState<number | null>(null);
  // Load from Alpaca positions
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError]     = useState<string | null>(null);

  // ── Cycles tab state ──────────────────────────────────────────────────────
  const [cycles, setCycles]                   = useState<Cycle[]>([]);
  const [cyclesLoading, setCyclesLoading]     = useState(false);
  const [cyclesError, setCyclesError]         = useState<string | null>(null);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [cycleLogs, setCycleLogs]             = useState<CycleLog[]>([]);
  const [logsLoading, setLogsLoading]         = useState(false);
  const logsEndRef                            = useRef<HTMLDivElement>(null);
  const logsPollRef                           = useRef<ReturnType<typeof setInterval> | null>(null);

  // New / edit cycle form state
  const [showCreateForm, setShowCreateForm]   = useState(false);
  const [editingCycle, setEditingCycle]       = useState<Cycle | null>(null);
  const [cycleForm, setCycleForm]             = useState({
    name:                 "AutoTrader Cycle",
    symbolInput:          "",
    symbols:              [] as string[],
    total_capital:        10000,
    interval_minutes:     60,
    intervalUnit:         "minutes" as "minutes" | "hours" | "days",
    lookback_days:        365,
    auto_execute:         false,
    dry_run:              true,
    max_cycles:           "" as number | "",
    stop_loss_pct:        "" as number | "",
    stop_at:              "",
    daily_loss_limit_pct: "" as number | "",
  });
  const [cycleFormError, setCycleFormError]   = useState<string | null>(null);
  const [cycleActionLoading, setCycleActionLoading] = useState<Record<string, boolean>>({});
  const [runHistModal, setRunHistModal]             = useState<{
    cycleName:   string;
    runs:        RunEntry[];
    selectedIdx: number;
    loading:     boolean;
  } | null>(null);

  const [perfModal, setPerfModal] = useState<{
    cycleName: string;
    data:      any | null;
    loading:   boolean;
  } | null>(null);

  // ── Backtest tab state ────────────────────────────────────────────────────
  const [btSymbolInput, setBtSymbolInput] = useState("");
  const [btSymbols, setBtSymbols]         = useState<string[]>([]);
  const [btCapital, setBtCapital]         = useState(10000);
  const [btRebalanceDays, setBtRebalanceDays] = useState(7);
  const [btTotalDays, setBtTotalDays]     = useState(365);
  const [btLookbackDays, setBtLookbackDays] = useState(90);
  const [btLoading, setBtLoading]         = useState(false);
  const [btResult, setBtResult]           = useState<any>(null);
  const [btError, setBtError]             = useState<string | null>(null);

  // Merge symbols pushed from other pages (Screener)
  useEffect(() => {
    if (pendingSymbols.length === 0) return;
    setSymbols(prev => {
      const merged = [...prev];
      pendingSymbols.forEach(s => { if (!merged.includes(s)) merged.push(s); });
      return merged;
    });
    onPendingConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSymbols]);

  // ── Cycles helpers ────────────────────────────────────────────────────────

  const fetchCycles = useCallback(async () => {
    setCyclesLoading(true);
    setCyclesError(null);
    try {
      const data = await api.listCycles();
      setCycles(data.cycles ?? []);
    } catch (e: any) {
      setCyclesError(e.message);
    } finally {
      setCyclesLoading(false);
    }
  }, []);

  // Poll cycles list every 5 s while on Cycles tab
  useEffect(() => {
    if (tab !== "cycles") return;
    fetchCycles();
    const iv = setInterval(fetchCycles, 5000);
    return () => clearInterval(iv);
  }, [tab, fetchCycles]);

  // Poll logs for the selected cycle every 3 s
  useEffect(() => {
    if (logsPollRef.current) clearInterval(logsPollRef.current);
    if (!selectedCycleId) { setCycleLogs([]); return; }

    const poll = async () => {
      setLogsLoading(true);
      try {
        const data = await api.getCycleLogs(selectedCycleId);
        setCycleLogs(data.logs ?? []);
        setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } catch { /* ignore */ } finally {
        setLogsLoading(false);
      }
    };
    poll();
    logsPollRef.current = setInterval(poll, 3000);
    return () => { if (logsPollRef.current) clearInterval(logsPollRef.current); };
  }, [selectedCycleId]);

  const cycleAction = async (id: string, action: () => Promise<any>) => {
    setCycleActionLoading(p => ({ ...p, [id]: true }));
    try { await action(); await fetchCycles(); }
    catch (e: any) { setCyclesError(e.message); }
    finally { setCycleActionLoading(p => ({ ...p, [id]: false })); }
  };

  const openRunHistory = async (cycle: Cycle) => {
    setRunHistModal({ cycleName: cycle.name, runs: [], selectedIdx: 0, loading: true });
    try {
      const data = await api.getCycleRuns(cycle.id);
      const runs = [...(data.runs ?? [])].reverse(); // most recent first
      setRunHistModal({ cycleName: cycle.name, runs: runs as RunEntry[], selectedIdx: 0, loading: false });
    } catch {
      setRunHistModal(null);
    }
  };

  const openPerfModal = async (cycle: Cycle) => {
    setPerfModal({ cycleName: cycle.name, data: null, loading: true });
    try {
      const data = await api.getCyclePerformance(cycle.id);
      setPerfModal({ cycleName: cycle.name, data, loading: false });
    } catch (e: any) {
      setPerfModal({ cycleName: cycle.name, data: { error: e.message }, loading: false });
    }
  };

  const openCreateForm = (prefillSymbols?: string[]) => {
    setEditingCycle(null);
    setCycleForm({
      name: "AutoTrader Cycle",
      symbolInput: "",
      symbols: prefillSymbols ?? [...symbols],
      total_capital: capital,
      interval_minutes: 60,
      intervalUnit: "minutes",
      lookback_days: 365,
      auto_execute: false,
      dry_run: true,
      max_cycles: "",
      stop_loss_pct: "",
      stop_at: "",
      daily_loss_limit_pct: "",
    });
    setCycleFormError(null);
    setShowCreateForm(true);
  };

  const openEditForm = (cycle: Cycle) => {
    setEditingCycle(cycle);
    const im = cycle.interval_minutes;
    const iUnit: "minutes" | "hours" | "days" = im % 1440 === 0 ? "days" : im % 60 === 0 ? "hours" : "minutes";
    const iVal = iUnit === "days" ? im / 1440 : iUnit === "hours" ? im / 60 : im;
    setCycleForm({
      name:                 cycle.name,
      symbolInput:          "",
      symbols:              [...cycle.symbols],
      total_capital:        cycle.total_capital,
      interval_minutes:     iVal,
      intervalUnit:         iUnit,
      lookback_days:        cycle.lookback_days ?? 365,
      auto_execute:         cycle.auto_execute,
      dry_run:              cycle.dry_run,
      max_cycles:           cycle.max_cycles ?? "",
      stop_loss_pct:        cycle.stop_loss_pct ?? "",
      stop_at:              cycle.stop_at ?? "",
      daily_loss_limit_pct: cycle.daily_loss_limit_pct ?? "",
    });
    setCycleFormError(null);
    setShowCreateForm(true);
  };

  const addCycleFormSymbol = () => {
    const syms = cycleForm.symbolInput.toUpperCase().split(/[\s,]+/).filter(Boolean);
    setCycleForm(p => ({
      ...p,
      symbolInput: "",
      symbols: [...p.symbols, ...syms.filter(s => !p.symbols.includes(s))],
    }));
  };

  const submitCycleForm = async () => {
    setCycleFormError(null);
    if (!cycleForm.symbols.length) { setCycleFormError("Add at least one symbol."); return; }
    if (!cycleForm.total_capital || cycleForm.total_capital <= 0) { setCycleFormError("Capital must be positive."); return; }

    const unitMult = cycleForm.intervalUnit === "days" ? 1440 : cycleForm.intervalUnit === "hours" ? 60 : 1;
    const payload = {
      name:                 cycleForm.name,
      symbols:              cycleForm.symbols,
      total_capital:        cycleForm.total_capital,
      interval_minutes:     Math.max(1, cycleForm.interval_minutes * unitMult),
      lookback_days:        cycleForm.lookback_days,
      auto_execute:         cycleForm.auto_execute,
      dry_run:              cycleForm.dry_run,
      max_cycles:           cycleForm.max_cycles !== "" ? Number(cycleForm.max_cycles) : null,
      stop_loss_pct:        cycleForm.stop_loss_pct !== "" ? Number(cycleForm.stop_loss_pct) : null,
      stop_at:              cycleForm.stop_at || null,
      daily_loss_limit_pct: cycleForm.daily_loss_limit_pct !== "" ? Number(cycleForm.daily_loss_limit_pct) : null,
    };

    try {
      if (editingCycle) {
        await api.updateCycle(editingCycle.id, payload);
      } else {
        await api.createCycle(payload);
      }
      setShowCreateForm(false);
      setEditingCycle(null);
      await fetchCycles();
    } catch (e: any) {
      setCycleFormError(e.message);
    }
  };

  // ── Backtest helpers ──────────────────────────────────────────────────────

  const addBtSymbol = () => {
    const syms = btSymbolInput.toUpperCase().split(/[\s,]+/).filter(Boolean);
    setBtSymbols(prev => [...prev, ...syms.filter(s => !prev.includes(s))]);
    setBtSymbolInput("");
  };

  const runBacktest = async () => {
    if (!btSymbols.length) { setBtError("Add at least one symbol."); return; }
    setBtLoading(true);
    setBtError(null);
    setBtResult(null);
    try {
      const data = await api.autoTraderBacktest({
        symbols:              btSymbols,
        total_capital:        btCapital,
        rebalance_every_days: btRebalanceDays,
        total_days:           btTotalDays,
        lookback_days:        btLookbackDays,
      });
      setBtResult(data);
    } catch (e: any) {
      setBtError(e.message);
    } finally {
      setBtLoading(false);
    }
  };

  // ── Symbol input handlers ─────────────────────────────────────────────────

  const addSymbol = () => {
    const syms = symbolInput.toUpperCase().split(/[\s,]+/).filter(Boolean);
    setSymbols(prev => {
      const merged = [...prev];
      syms.forEach(s => { if (!merged.includes(s)) merged.push(s); });
      return merged;
    });
    setSymbolInput("");
  };

  const removeSymbol = (s: string) =>
    setSymbols(prev => prev.filter(x => x !== s));

  const loadFromPortfolio = async () => {
    setPosLoading(true);
    setPosError(null);
    try {
      const positions = await api.getPositions();
      if (!positions.length) {
        setPosError("No open positions found in your Alpaca account.");
        return;
      }
      const syms = positions.map((p: any) => (p.symbol as string).toUpperCase());
      setSymbols(prev => {
        const merged = [...prev];
        syms.forEach((s: string) => { if (!merged.includes(s)) merged.push(s); });
        return merged;
      });
    } catch (e: any) {
      setPosError(e.message);
    } finally {
      setPosLoading(false);
    }
  };

  const toggleDeselect = (sym: string) =>
    setDeselected(prev => {
      const next = new Set(prev);
      next.has(sym) ? next.delete(sym) : next.add(sym);
      return next;
    });

  // ── Run pipeline ──────────────────────────────────────────────────────────

  const analyze = async () => {
    if (symbols.length === 0) { setError("Add at least one symbol"); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    setExecResults(null);
    setSharesOverride({});
    setDeselected(new Set());
    try {
      const data = await api.autoTraderAnalyze({ symbols, total_capital: capital });
      setResult(data);
      // Fetch buying power for pre-execution sanity check
      try {
        const acct = await api.getAccount();
        setBuyingPower(parseFloat(acct.buying_power ?? "0"));
      } catch { /* non-fatal */ }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Execute ───────────────────────────────────────────────────────────────

  const execute = async (dryRun = false) => {
    if (!result) return;
    setExecuting(true);
    setExecError(null);
    setExecResults(null);
    try {
      const items = result.items
        .filter(i => !i.error && !deselected.has(i.symbol) && (sharesOverride[i.symbol] ?? i.shares) > 0)
        .map(i => ({
          symbol:   i.symbol,
          strategy: i.best_strategy,
          shares:   sharesOverride[i.symbol] ?? i.shares,
          side:     "buy",
          notional: sharesOverride[i.symbol] !== undefined
            ? sharesOverride[i.symbol] * i.current_price
            : i.capital,
        }));
      const data = await api.autoTraderExecute({ items, dry_run: dryRun });
      setExecResults(data.results);
    } catch (e: any) {
      setExecError(e.message);
    } finally {
      setExecuting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const validItems    = result?.items.filter(i => !i.error && !i.excluded) ?? [];
  const excludedItems = result?.items.filter(i => i.excluded && !i.error) ?? [];
  const errorItems    = result?.items.filter(i => !!i.error) ?? [];
  const activeItems = validItems.filter(i => !deselected.has(i.symbol));
  const totalAllocated = activeItems.reduce((s, i) => s + (sharesOverride[i.symbol] !== undefined
    ? (sharesOverride[i.symbol] * i.current_price)
    : i.capital), 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">AutoTrader</h1>
          <p className="page-sub">
            One-shot or continuous automated trading — LLM researches every asset, allocates capital, and optionally executes on a schedule.
          </p>
        </div>
        {tab === "manual" && result && (
          <button
            className="btn-secondary"
            style={{ color: "var(--text-dim)", fontSize: "11px" }}
            onClick={() => { setResult(null); setExecResults(null); setError(null); }}
          >
            ✕ Clear
          </button>
        )}
      </header>

      {/* ── Tab switcher ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: "1px solid var(--border)" }}>
        {(["manual", "backtest", "cycles"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 18px",
              fontSize: "13px",
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "var(--accent)" : "var(--text-dim)",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              cursor: "pointer",
              marginBottom: "-1px",
            }}
          >
            {t === "manual" ? "▶  One-Shot Run" : t === "backtest" ? "📊  Backtest" : "⟳  Scheduled Cycles"}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          MANUAL TAB
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "manual" && (
        <>
      {/* ── Input panel ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <h3 className="panel-title" style={{ marginBottom: "14px" }}>Configure Run</h3>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
          <input
            className="input"
            placeholder="Add symbols  e.g. AAPL, TSLA, BTC/USD"
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && addSymbol()}
            style={{ flex: 3, minWidth: "200px" }}
          />
          <button className="btn-secondary" onClick={addSymbol}>+ Add</button>
          <button
            className="btn-secondary"
            onClick={loadFromPortfolio}
            disabled={posLoading}
            title="Import symbols from your current Alpaca positions"
          >
            {posLoading ? "Loading…" : "⟡ Load Positions"}
          </button>
        </div>

        {posError && (
          <div className="error-banner" style={{ marginBottom: "10px", fontSize: "12px" }}>{posError}</div>
        )}

        {/* Symbol tags */}
        {symbols.length > 0 && (
          <div className="portfolio-tags" style={{ marginBottom: "14px" }}>
            {symbols.map(s => (
              <span key={s} className="portfolio-tag">
                {s}
                <button onClick={() => removeSymbol(s)}>×</button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Total Capital ($)</label>
            <input
              className="input"
              type="number"
              min={100}
              value={capital}
              onChange={e => setCapital(parseFloat(e.target.value) || 0)}
              style={{ width: "160px" }}
            />
          </div>

          <button
            className="btn-primary"
            onClick={analyze}
            disabled={loading || symbols.length === 0}
            style={{ marginTop: "18px" }}
          >
            {loading ? "Analyzing…" : "▶  Analyze"}
          </button>
        </div>

        <p className="config-hint" style={{ marginTop: "10px" }}>
          The LLM will research each symbol (price stats, backtests, news) and then decide
          how to split your capital based on Sharpe ratio, momentum, and AI confidence.
          You can override shares per row before executing.
        </p>
      </div>

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {loading && (
        <div className="card" style={{ textAlign: "center", padding: "40px", color: "var(--text-dim)" }}>
          <div style={{ fontSize: "28px", marginBottom: "12px" }}>⟳</div>
          <div style={{ marginBottom: "6px" }}>
            Running research on {symbols.length} symbol{symbols.length !== 1 ? "s" : ""}…
          </div>
          <div style={{ fontSize: "12px" }}>
            Fetching price data · running strategy backtests · pulling news · asking LLM to allocate capital
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="error-banner" style={{ marginBottom: "16px" }}>
          {error}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {result && !loading && (
        <>
          {/* Portfolio summary */}
          <div className="card" style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <div className="panel-title" style={{ marginBottom: "6px" }}>Allocation Plan</div>
                {result.portfolio_thesis && (
                  <p style={{ fontSize: "13px", color: "var(--text-dim)", maxWidth: "640px", margin: 0 }}>
                    {result.portfolio_thesis}
                  </p>
                )}
                {result.risk_notes && (
                  <p style={{ fontSize: "12px", color: "var(--orange)", marginTop: "6px", marginBottom: 0 }}>
                    ⚠ {result.risk_notes}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "20px", flexShrink: 0 }}>
                <div className="stat-block">
                  <span className="stat-label">Total Capital</span>
                  <span className="stat-value">${result.total_capital.toLocaleString()}</span>
                </div>
                <div className="stat-block">
                  <span className="stat-label">Allocated</span>
                  <span className="stat-value">${totalAllocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="stat-block">
                  <span className="stat-label">Method</span>
                  <span className="stat-value" style={{ color: result.allocation_method === "ai" ? "var(--green)" : "var(--orange)" }}>
                    {result.allocation_method === "ai" ? "AI" : "Sharpe Fallback"}
                  </span>
                </div>
                <div className="stat-block">
                  <span className="stat-label">Symbols</span>
                  <span className="stat-value">{validItems.length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Allocation table */}
          <div className="card" style={{ marginBottom: "16px", padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ minWidth: "900px" }}>
                <thead>
                  <tr>
                    <th style={{ width: "32px" }}></th>
                    <th>Symbol</th>
                    <th>Strategy</th>
                    <th style={{ textAlign: "right" }}>Price</th>
                    <th style={{ textAlign: "right" }}>Weight</th>
                    <th style={{ textAlign: "right" }}>Capital</th>
                    <th style={{ textAlign: "right" }}>Shares</th>
                    <th style={{ textAlign: "right" }}>Sharpe</th>
                    <th style={{ textAlign: "right" }}>Return (1Y)</th>
                    <th style={{ textAlign: "right" }}>MaxDD</th>
                    <th style={{ textAlign: "right" }}>AI Signal</th>
                    <th>Allocation Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  {validItems.map(item => {
                    const ai       = item.ai_analysis ?? {};
                    const ps       = item.price_stats ?? {};
                    const scores   = item.strategy_scores ?? [];
                    const bestS    = scores.find(s => s.strategy === item.best_strategy) ?? {};
                    const disabled = deselected.has(item.symbol);
                    const overrideShares = sharesOverride[item.symbol];

                    return (
                      <tr key={item.symbol} style={{ opacity: disabled ? 0.4 : 1 }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!disabled}
                            onChange={() => toggleDeselect(item.symbol)}
                            title={disabled ? "Include this symbol" : "Exclude this symbol"}
                          />
                        </td>
                        <td style={{ fontWeight: 600 }}>{item.symbol}</td>
                        <td style={{ color: "var(--text-dim)", fontSize: "12px" }}>
                          {STRATEGY_LABELS[item.best_strategy ?? ""] ?? item.best_strategy ?? "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>${fmt(item.current_price)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "var(--accent)" }}>
                          {fmt(item.weight_pct, 1)}%
                        </td>
                        <td style={{ textAlign: "right" }}>${item.capital.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            className="input"
                            min={0}
                            value={overrideShares ?? item.shares}
                            onChange={e => setSharesOverride(p => ({ ...p, [item.symbol]: parseInt(e.target.value) || 0 }))}
                            style={{ width: "70px", textAlign: "right", padding: "2px 6px", fontSize: "12px" }}
                            title="Override shares"
                          />
                        </td>
                        <td style={{ textAlign: "right", color: (bestS.sharpe_ratio ?? 0) >= 1 ? "var(--green)" : "var(--text-dim)" }}>
                          {fmt(bestS.sharpe_ratio)}
                        </td>
                        <td style={{ textAlign: "right", color: (bestS.total_return ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                          {pct(bestS.total_return)}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--red)" }}>
                          {pct(bestS.max_drawdown)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{ color: REC_COLORS[ai.recommendation] ?? "var(--text-dim)", fontWeight: 600, fontSize: "11px" }}>
                            {ai.recommendation ?? "—"}
                          </span>
                          {ai.confidence !== undefined && (
                            <span style={{ color: "var(--text-dim)", fontSize: "11px", marginLeft: "4px" }}>
                              {pct(ai.confidence)}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: "11px", color: "var(--text-dim)", maxWidth: "260px" }}>
                          {item.weight_reasoning || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ranked-out / excluded symbols */}
          {excludedItems.length > 0 && (
            <div className="card" style={{ marginBottom: "16px", borderColor: "var(--border-bright)", borderStyle: "solid", borderWidth: "1px" }}>
              <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--text-dim)", fontSize: "12px" }}>
                ⬇ Ranked out — below selection threshold ({excludedItems.length})
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Symbol", "AI Signal", "Sharpe", "90d Return", "Reason"].map(h => (
                        <th key={h} style={{ padding: "4px 8px", textAlign: "left", color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {excludedItems.map(item => {
                      const ai      = item.ai_analysis ?? {};
                      const scores  = item.strategy_scores ?? [];
                      const bestS   = scores.filter((s: any) => !s.error && s.total_trades > 0);
                      const sharpe  = bestS.length ? Math.max(...bestS.map((s: any) => s.sharpe_ratio ?? 0)) : null;
                      const ret90   = item.price_stats?.return_90d;
                      return (
                        <tr key={item.symbol} style={{ borderBottom: "1px solid var(--border)", opacity: 0.6 }}>
                          <td style={{ padding: "5px 8px", fontWeight: 600 }}>{item.symbol}</td>
                          <td style={{ padding: "5px 8px" }}>
                            <span style={{ color: REC_COLORS[ai.recommendation] ?? "var(--text-dim)", fontWeight: 600 }}>
                              {ai.recommendation ?? "—"}
                            </span>
                            {ai.confidence !== undefined && (
                              <span style={{ color: "var(--text-dim)", marginLeft: "4px" }}>{pct(ai.confidence)}</span>
                            )}
                          </td>
                          <td style={{ padding: "5px 8px", color: (sharpe ?? 0) < 0 ? "var(--red)" : "var(--text-dim)" }}>
                            {sharpe !== null ? sharpe.toFixed(2) : "—"}
                          </td>
                          <td style={{ padding: "5px 8px", color: (ret90 ?? 0) < 0 ? "var(--red)" : "var(--text-dim)" }}>
                            {ret90 !== undefined ? pct(ret90) : "—"}
                          </td>
                          <td style={{ padding: "5px 8px", color: "var(--text-dim)", maxWidth: "280px" }}>{item.exclusion_reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error symbols */}
          {errorItems.length > 0 && (
            <div className="card" style={{ marginBottom: "16px", borderColor: "var(--red)", borderStyle: "solid", borderWidth: "1px" }}>
              <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--red)" }}>
                Failed to load ({errorItems.length})
              </div>
              {errorItems.map(i => (
                <div key={i.symbol} style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "4px" }}>
                  <strong style={{ color: "var(--text)" }}>{i.symbol}</strong>: {i.error}
                </div>
              ))}
            </div>
          )}

          {/* Execute controls */}
          <div className="card" style={{ marginBottom: "16px" }}>
            {buyingPower !== null && !isNaN(totalAllocated) && totalAllocated > buyingPower && (
              <div className="error-banner" style={{ marginBottom: "12px" }}>
                ⚠ Insufficient buying power — allocation requires ${totalAllocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} but your account only has ${buyingPower.toLocaleString(undefined, { maximumFractionDigits: 2 })} available. Reduce capital, override share counts, or deselect positions.
              </div>
            )}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn-primary"
                onClick={() => execute(false)}
                disabled={executing || activeItems.length === 0}
              >
                {executing ? "Placing orders…" : `⟡  Execute ${activeItems.length} position${activeItems.length !== 1 ? "s" : ""}`}
              </button>
              <button
                className="btn-secondary"
                onClick={() => execute(true)}
                disabled={executing || activeItems.length === 0}
              >
                Dry Run (simulate)
              </button>
              <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>
                Uncheck rows to exclude from execution. Edit shares to override the AI allocation.
              </span>
            </div>
            {execError && (
              <div className="error-banner" style={{ marginTop: "12px" }}>{execError}</div>
            )}
          </div>

          {/* Execution results */}
          {execResults && (
            <div className="card">
              <div className="panel-title" style={{ marginBottom: "12px" }}>
                Execution Results
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {execResults.map((r: any) => (
                  <div
                    key={r.symbol}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      background: r.success ? "rgba(0,200,100,0.07)" : "rgba(255,80,80,0.07)",
                      fontSize: "13px",
                    }}
                  >
                    <span style={{ color: r.success ? "var(--green)" : "var(--red)", fontWeight: 600, width: "16px" }}>
                      {r.success ? "✓" : "✗"}
                    </span>
                    <span style={{ fontWeight: 600, minWidth: "80px" }}>{r.symbol}</span>
                    <span style={{ color: "var(--text-dim)" }}>{r.side?.toUpperCase()} {r.shares} shares</span>
                    {r.strategy && <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>{STRATEGY_LABELS[r.strategy] ?? r.strategy}</span>}
                    {r.dry_run && <span style={{ color: "var(--orange)", fontSize: "11px" }}>SIMULATED</span>}
                    {!r.success && r.error && <span style={{ color: "var(--red)", fontSize: "11px" }}>{r.error}</span>}
                    {r.success && r.order_result?.id && (
                      <span style={{ color: "var(--text-dim)", fontSize: "11px", marginLeft: "auto" }}>
                        Order #{r.order_result.id}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
        </> /* end manual tab */
      )}

      {/* ════════════════════════════════════════════════════════════════════
          BACKTEST TAB
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "backtest" && (
        <div>
          {/* ── Config card ──────────────────────────────────────────────── */}
          <div className="card" style={{ marginBottom: "20px" }}>
            <h3 className="panel-title" style={{ marginBottom: "14px" }}>Cycle Backtest Configuration</h3>
            <p style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "16px" }}>
              Simulates your AutoTrader cycle over historical data using a <strong>walk-forward</strong> methodology — at each rebalance point,
              the allocator only sees data available up to that date (no look-ahead bias).
              Sharpe-weighted allocation is used for every rebalance. Compare strategy vs equal-weight buy &amp; hold.
            </p>

            {/* Symbols */}
            <div className="form-group" style={{ marginBottom: "14px" }}>
              <label>Symbols (max 10)</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input className="input" placeholder="AAPL, BTC/USD…"
                  value={btSymbolInput}
                  onChange={e => setBtSymbolInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === "Enter" && addBtSymbol()}
                  style={{ flex: 1 }} />
                <button className="btn-secondary" onClick={addBtSymbol}>+ Add</button>
                {symbols.length > 0 && (
                  <button className="btn-secondary" onClick={() => setBtSymbols(prev => [...new Set([...prev, ...symbols])])}>
                    ← From Manual
                  </button>
                )}
              </div>
              {btSymbols.length > 0 && (
                <div className="portfolio-tags" style={{ marginTop: "8px" }}>
                  {btSymbols.map(s => (
                    <span key={s} className="portfolio-tag">
                      {s}
                      <button onClick={() => setBtSymbols(p => p.filter(x => x !== s))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Params grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "14px", marginBottom: "16px" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Capital ($)</label>
                <input className="input" type="number" min={100}
                  value={btCapital} onChange={e => setBtCapital(parseFloat(e.target.value) || 10000)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Rebalance every (days)</label>
                <input className="input" type="number" min={1} max={90}
                  value={btRebalanceDays} onChange={e => setBtRebalanceDays(parseInt(e.target.value) || 7)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Simulation window (days)</label>
                <input className="input" type="number" min={30} max={1825}
                  value={btTotalDays} onChange={e => setBtTotalDays(parseInt(e.target.value) || 365)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Strategy lookback (days)</label>
                <input className="input" type="number" min={10} max={365}
                  value={btLookbackDays} onChange={e => setBtLookbackDays(parseInt(e.target.value) || 90)} />
              </div>
            </div>

            <button className="btn-primary" onClick={runBacktest} disabled={btLoading || btSymbols.length === 0}>
              {btLoading ? "Running backtest…" : "▶  Run Backtest"}
            </button>
          </div>

          {btError && <div className="error-banner" style={{ marginBottom: "16px" }}>{btError}</div>}

          {btLoading && (
            <div className="card" style={{ textAlign: "center", padding: "40px", color: "var(--text-dim)" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>📊</div>
              <div style={{ marginBottom: "6px" }}>Running walk-forward backtest…</div>
              <div style={{ fontSize: "12px" }}>
                Fetching historical candles · running strategy evaluations per rebalance period · building equity curve
              </div>
            </div>
          )}

          {btResult && !btLoading && (() => {
            const m  = btResult.metrics ?? {};
            const bm = btResult.benchmark_metrics ?? {};
            const ec = btResult.equity_curve ?? [];
            const re = btResult.rebalance_events ?? [];
            const fmt2 = (n: number) => isNaN(n) ? "—" : n.toFixed(2);
            const pctFmt = (n: number) => `${(n * 100).toFixed(1)}%`;
            const better = (key: string) => m[key] !== undefined && bm[key] !== undefined && m[key] > bm[key];
            const betterDD = m.max_drawdown !== undefined && bm.max_drawdown !== undefined && m.max_drawdown > bm.max_drawdown; // less negative = better

            return (
              <>
                {/* ── Headline metrics comparison ─────────────────────── */}
                <div className="card" style={{ marginBottom: "16px" }}>
                  <div className="panel-title" style={{ marginBottom: "14px" }}>Results vs Buy &amp; Hold</div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ minWidth: "700px" }}>
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th style={{ textAlign: "right", color: "var(--accent)" }}>AutoTrader Cycle</th>
                          <th style={{ textAlign: "right", color: "var(--text-dim)" }}>Equal-Weight B&amp;H</th>
                          <th style={{ textAlign: "right" }}>Edge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: "Total Return",       k: "total_return",      fmt: pctFmt },
                          { label: "Annualised Return",  k: "annualized_return", fmt: pctFmt },
                          { label: "Sharpe Ratio",       k: "sharpe_ratio",      fmt: fmt2  },
                          { label: "Max Drawdown",       k: "max_drawdown",      fmt: pctFmt, higher_is_worse: true },
                          { label: "Final Equity ($)",   k: "final_equity",      fmt: (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                        ].map(row => {
                          const isBetter = row.higher_is_worse ? betterDD : better(row.k);
                          const mv = m[row.k] ?? 0;
                          const bv = bm[row.k] ?? 0;
                          const edge = row.higher_is_worse
                            ? ((bv - mv) * 100).toFixed(1) + "pp"
                            : row.k === "final_equity"
                              ? `$${(mv - bv).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              : row.k === "sharpe_ratio"
                                ? (mv - bv).toFixed(2)
                                : `${((mv - bv) * 100).toFixed(1)}pp`;
                          return (
                            <tr key={row.k}>
                              <td style={{ color: "var(--text-dim)" }}>{row.label}</td>
                              <td style={{ textAlign: "right", fontWeight: 600, color: isBetter ? "var(--green)" : "var(--red)" }}>
                                {row.fmt(mv)}
                              </td>
                              <td style={{ textAlign: "right", color: "var(--text-dim)" }}>{row.fmt(bv)}</td>
                              <td style={{ textAlign: "right", color: isBetter ? "var(--green)" : "var(--text-dim)", fontSize: "12px" }}>
                                {isBetter ? "▲ +" : "▼ "}{edge}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--text-dim)" }}>
                    {m.total_rebalances} rebalances over {m.trading_days} trading days ·
                    symbols: {(btResult.symbols_used ?? []).join(", ")}
                    {Object.keys(btResult.symbols_errored ?? {}).length > 0 && (
                      <span style={{ color: "var(--orange)" }}>
                        {" "}· failed: {Object.keys(btResult.symbols_errored).join(", ")}
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Equity curve (text table — no chart dep) ─────────── */}
                <div className="card" style={{ marginBottom: "16px" }}>
                  <div className="panel-title" style={{ marginBottom: "12px" }}>Equity Curve (monthly snapshots)</div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th style={{ textAlign: "right", color: "var(--accent)" }}>Cycle Equity</th>
                          <th style={{ textAlign: "right", color: "var(--text-dim)" }}>B&amp;H Equity</th>
                          <th style={{ textAlign: "right" }}>Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Sample ~monthly: every 21 trading days */}
                        {ec.filter((_: any, i: number) => i === 0 || i % 21 === 0 || i === ec.length - 1).map((row: any) => {
                          const diff = row.equity - row.benchmark_equity;
                          return (
                            <tr key={row.date}>
                              <td style={{ color: "var(--text-dim)" }}>{row.date}</td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>${row.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td style={{ textAlign: "right", color: "var(--text-dim)" }}>${row.benchmark_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td style={{ textAlign: "right", color: diff >= 0 ? "var(--green)" : "var(--red)", fontSize: "12px" }}>
                                {diff >= 0 ? "+" : ""}${diff.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Rebalance history ─────────────────────────────────── */}
                {re.length > 0 && (
                  <div className="card" style={{ marginBottom: "16px" }}>
                    <div className="panel-title" style={{ marginBottom: "12px" }}>Rebalance History ({re.length} events)</div>
                    <div style={{ overflowX: "auto", maxHeight: "320px", overflowY: "auto" }}>
                      <table className="data-table" style={{ minWidth: "600px" }}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th style={{ textAlign: "right" }}>Portfolio Value</th>
                            <th>Allocations (symbol → weight)</th>
                            <th>Best Strategies</th>
                          </tr>
                        </thead>
                        <tbody>
                          {re.map((ev: any) => (
                            <tr key={ev.date}>
                              <td style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{ev.date}</td>
                              <td style={{ textAlign: "right" }}>${ev.portfolio_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td style={{ fontSize: "11px" }}>
                                {Object.entries(ev.weights ?? {}).map(([s, w]: [string, any]) => (
                                  <span key={s} style={{ marginRight: "10px", whiteSpace: "nowrap" }}>
                                    <strong>{s}</strong>{" "}
                                    <span style={{ color: "var(--accent)" }}>{(w * 100).toFixed(1)}%</span>
                                    {ev.sharpes?.[s] !== undefined && (
                                      <span style={{ color: "var(--text-dim)", marginLeft: "3px" }}>
                                        (Sh {ev.sharpes[s]})
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </td>
                              <td style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                                {Object.entries(ev.best_strategies ?? {}).map(([s, st]: [string, any]) => (
                                  <span key={s} style={{ marginRight: "8px" }}>
                                    {s}: {STRATEGY_LABELS[st] ?? st}
                                  </span>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          CYCLES TAB
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "cycles" && (
        <div>
          {/* ── Header row ───────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: "15px" }}>Scheduled Cycles</span>
              <span style={{ color: "var(--text-dim)", fontSize: "12px", marginLeft: "10px" }}>
                {cycles.length} cycle{cycles.length !== 1 ? "s" : ""}
              </span>
            </div>
            <button className="btn-primary" onClick={() => openCreateForm()}>+ New Cycle</button>
          </div>

          {cyclesError && (
            <div className="error-banner" style={{ marginBottom: "14px" }}>{cyclesError}</div>
          )}

          {cyclesLoading && cycles.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: "13px", padding: "20px" }}>Loading cycles…</div>
          )}

          {/* ── Create / Edit form modal ──────────────────────────────────── */}
          {showCreateForm && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{
                width: "min(640px, 95vw)", maxHeight: "90vh", overflowY: "auto", position: "relative",
                background: "#0d1117", border: "1px solid var(--border-bright)", borderRadius: "10px",
                padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
                  <span style={{ fontWeight: 700, fontSize: "15px" }}>
                    {editingCycle ? "Edit Cycle" : "New AutoTrader Cycle"}
                  </span>
                  <button className="btn-secondary" style={{ padding: "4px 10px" }} onClick={() => setShowCreateForm(false)}>✕</button>
                </div>

                {/* Name */}
                <div className="form-group" style={{ marginBottom: "14px" }}>
                  <label>Cycle Name</label>
                  <input className="input" value={cycleForm.name}
                    onChange={e => setCycleForm(p => ({ ...p, name: e.target.value }))} />
                </div>

                {/* Symbols */}
                <div className="form-group" style={{ marginBottom: "14px" }}>
                  <label>Symbols</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input className="input" placeholder="AAPL, BTC/USD…" value={cycleForm.symbolInput}
                      onChange={e => setCycleForm(p => ({ ...p, symbolInput: e.target.value.toUpperCase() }))}
                      onKeyDown={e => e.key === "Enter" && addCycleFormSymbol()}
                      style={{ flex: 1 }} />
                    <button className="btn-secondary" onClick={addCycleFormSymbol}>+ Add</button>
                  </div>
                  {cycleForm.symbols.length > 0 && (
                    <div className="portfolio-tags" style={{ marginTop: "8px" }}>
                      {cycleForm.symbols.map(s => (
                        <span key={s} className="portfolio-tag">
                          {s}
                          <button onClick={() => setCycleForm(p => ({ ...p, symbols: p.symbols.filter(x => x !== s) }))}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Capital · Rebalance Interval · Lookback */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Total Capital ($)</label>
                    <input className="input" type="number" min={100}
                      value={cycleForm.total_capital}
                      onChange={e => setCycleForm(p => ({ ...p, total_capital: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Rebalance Interval</label>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input className="input" type="number" min={1} style={{ flex: 1, minWidth: 0 }}
                        value={cycleForm.interval_minutes}
                        onChange={e => setCycleForm(p => ({ ...p, interval_minutes: parseInt(e.target.value) || 1 }))} />
                      <select className="input" style={{ flex: "none", width: "70px", padding: "0 6px" }}
                        value={cycleForm.intervalUnit}
                        onChange={e => setCycleForm(p => ({ ...p, intervalUnit: e.target.value as any }))}>
                        <option value="minutes">min</option>
                        <option value="hours">hr</option>
                        <option value="days">day</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Research Lookback (days)</label>
                    <input className="input" type="number" min={90} max={1825}
                      value={cycleForm.lookback_days}
                      onChange={e => setCycleForm(p => ({ ...p, lookback_days: Math.max(90, parseInt(e.target.value) || 365) }))} />
                    <span style={{ fontSize: "10px", color: "var(--text-dim)", marginTop: "3px", display: "block" }}>
                      min 90 days (~63 trading days needed for strategy analysis)
                    </span>
                  </div>
                </div>

                {/* Checkboxes */}
                <div style={{ display: "flex", gap: "24px", marginBottom: "14px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                    <input type="checkbox" checked={cycleForm.auto_execute}
                      onChange={e => setCycleForm(p => ({ ...p, auto_execute: e.target.checked }))} />
                    Auto-Execute orders
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                    <input type="checkbox" checked={cycleForm.dry_run}
                      onChange={e => setCycleForm(p => ({ ...p, dry_run: e.target.checked }))} />
                    Dry Run (simulate)
                  </label>
                </div>

                {/* Stop conditions */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "14px", marginBottom: "14px" }}>
                  <div style={{ fontWeight: 600, fontSize: "12px", color: "var(--text-dim)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Stop Conditions (optional)
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Max Runs (then stop)</label>
                      <input className="input" type="number" min={1} placeholder="unlimited"
                        value={cycleForm.max_cycles}
                        onChange={e => setCycleForm(p => ({ ...p, max_cycles: e.target.value === "" ? "" : parseInt(e.target.value) }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Stop-Loss % (portfolio drawdown)</label>
                      <input className="input" type="number" min={0} step={0.5} placeholder="e.g. 5"
                        value={cycleForm.stop_loss_pct}
                        onChange={e => setCycleForm(p => ({ ...p, stop_loss_pct: e.target.value === "" ? "" : parseFloat(e.target.value) }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Daily Loss Limit %</label>
                      <input className="input" type="number" min={0} step={0.5} placeholder="e.g. 2"
                        value={cycleForm.daily_loss_limit_pct}
                        onChange={e => setCycleForm(p => ({ ...p, daily_loss_limit_pct: e.target.value === "" ? "" : parseFloat(e.target.value) }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Stop At (datetime, optional)</label>
                      <input className="input" type="datetime-local"
                        value={cycleForm.stop_at}
                        onChange={e => setCycleForm(p => ({ ...p, stop_at: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {cycleFormError && (
                  <div className="error-banner" style={{ marginBottom: "12px" }}>{cycleFormError}</div>
                )}

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button className="btn-secondary" onClick={() => setShowCreateForm(false)}>Cancel</button>
                  <button className="btn-primary" onClick={submitCycleForm}>
                    {editingCycle ? "Save Changes" : "Create Cycle"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Cycles list ──────────────────────────────────────────────── */}
          {cycles.length === 0 && !cyclesLoading && (
            <div className="card" style={{ textAlign: "center", padding: "40px", color: "var(--text-dim)" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>⟳</div>
              <div style={{ marginBottom: "6px", fontWeight: 600 }}>No cycles yet</div>
              <div style={{ fontSize: "12px" }}>
                Click <strong>+ New Cycle</strong> above to set up a 24/7 automated trading loop.
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {cycles.map(cycle => {
              const isBusy   = cycleActionLoading[cycle.id];
              const isSelected = selectedCycleId === cycle.id;
              const statusColor =
                cycle.status === "running" ? "var(--green)" :
                cycle.status === "error"   ? "var(--red)" :
                cycle.status === "stopped" ? "var(--text-dim)" : "var(--orange)";

              return (
                <div key={cycle.id} className="card" style={{
                  borderLeft: `3px solid ${statusColor}`,
                  padding: "16px 18px",
                }}>
                  {/* ── Cycle header ────────────────────────────── */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: "180px" }}>
                      <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "3px" }}>{cycle.name}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                        {cycle.symbols.join(", ")} · ${cycle.total_capital.toLocaleString()}
                        · every {cycle.interval_minutes >= 60
                          ? `${(cycle.interval_minutes / 60).toFixed(cycle.interval_minutes % 60 === 0 ? 0 : 1)}h`
                          : `${cycle.interval_minutes}m`}
                        {cycle.dry_run && " · DRY RUN"}
                        {cycle.auto_execute && " · AUTO-EXECUTE"}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      padding: "3px 10px", borderRadius: "12px",
                      background: `${statusColor}22`,
                      fontSize: "11px", fontWeight: 700, color: statusColor,
                      textTransform: "uppercase",
                    }}>
                      {cycle.status === "running" && <span style={{ animation: "spin 1.2s linear infinite", display: "inline-block" }}>⟳</span>}
                      {cycle.status}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                      {cycle.status !== "running" && (
                        <button className="btn-primary" style={{ fontSize: "11px", padding: "4px 12px" }}
                          disabled={isBusy}
                          onClick={() => cycleAction(cycle.id, () => api.startCycle(cycle.id))}>
                          {isBusy ? "…" : "▶ Start"}
                        </button>
                      )}
                      {cycle.status === "running" && (
                        <>
                          <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 12px" }}
                            disabled={isBusy}
                            onClick={() => cycleAction(cycle.id, () => api.runCycleNow(cycle.id))}>
                            {isBusy ? "…" : "⚡ Run Now"}
                          </button>
                          <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 12px", color: "var(--red)" }}
                            disabled={isBusy}
                            onClick={() => cycleAction(cycle.id, () => api.stopCycle(cycle.id))}>
                            ⏹ Stop
                          </button>
                        </>
                      )}
                      {cycle.status !== "running" && (
                        <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 12px" }}
                          disabled={isBusy}
                          onClick={() => openEditForm(cycle)}>
                          ✎ Edit
                        </button>
                      )}
                      {cycle.runs_completed > 0 && (
                        <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 12px" }}
                          onClick={() => openRunHistory(cycle)}
                          title="View run history">
                          📊
                        </button>
                      )}
                      <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 12px" }}
                        onClick={() => openPerfModal(cycle)}
                        title="View performance stats">
                        📈
                      </button>
                      <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 12px", color: "var(--text-dim)" }}
                        disabled={isBusy}
                        onClick={() => { if (confirm(`Delete cycle "${cycle.name}"?`)) cycleAction(cycle.id, () => api.deleteCycle(cycle.id)); }}>
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* ── Stats row ───────────────────────────────── */}
                  <div style={{ display: "flex", gap: "20px", marginTop: "10px", flexWrap: "wrap" }}>
                    <div className="stat-block">
                      <span className="stat-label">Runs</span>
                      <span className="stat-value">{cycle.runs_completed}{cycle.max_cycles ? ` / ${cycle.max_cycles}` : ""}</span>
                    </div>
                    {cycle.last_run_at && (
                      <div className="stat-block">
                        <span className="stat-label">Last Run</span>
                        <span className="stat-value" style={{ fontSize: "11px" }}>
                          {new Date(cycle.last_run_at).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {cycle.next_run_at && cycle.status === "running" && (
                      <div className="stat-block">
                        <span className="stat-label">Next Run</span>
                        <span className="stat-value" style={{ fontSize: "11px" }}>
                          {new Date(cycle.next_run_at).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {cycle.stop_reason && (
                      <div className="stat-block">
                        <span className="stat-label">Stop Reason</span>
                        <span className="stat-value" style={{ fontSize: "11px", color: "var(--orange)" }}>{cycle.stop_reason}</span>
                      </div>
                    )}
                    {cycle.last_result_summary && (
                      <div className="stat-block">
                        <span className="stat-label">Last Allocation</span>
                        <span className="stat-value" style={{ fontSize: "11px", color: cycle.last_result_summary.allocation_method === "ai" ? "var(--green)" : "var(--orange)" }}>
                          {cycle.last_result_summary.allocation_method === "ai" ? "AI" : "Sharpe"} · {cycle.last_result_summary.item_count} symbols
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Stop conditions summary */}
                  {(cycle.stop_loss_pct || cycle.daily_loss_limit_pct || cycle.stop_at || cycle.max_cycles) && (
                    <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-dim)" }}>
                      Stop conditions:
                      {cycle.max_cycles ? ` max ${cycle.max_cycles} runs` : ""}
                      {cycle.stop_loss_pct ? ` · portfolio loss >${cycle.stop_loss_pct}%` : ""}
                      {cycle.daily_loss_limit_pct ? ` · daily loss >${cycle.daily_loss_limit_pct}%` : ""}
                      {cycle.stop_at ? ` · stop at ${new Date(cycle.stop_at).toLocaleString()}` : ""}
                    </div>
                  )}

                  {/* ── Log toggle ──────────────────────────────── */}
                  <div style={{ marginTop: "10px" }}>
                    <button
                      style={{ fontSize: "11px", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      onClick={() => setSelectedCycleId(isSelected ? null : cycle.id)}
                    >
                      {isSelected ? "▲ Hide Logs" : "▼ Show Logs"}
                    </button>
                  </div>

                  {/* ── Log panel ───────────────────────────────── */}
                  {isSelected && (
                    <div style={{
                      marginTop: "10px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      padding: "10px 12px",
                      fontFamily: "monospace",
                      fontSize: "11px",
                      maxHeight: "260px",
                      overflowY: "auto",
                    }}>
                      {logsLoading && cycleLogs.length === 0 && (
                        <span style={{ color: "var(--text-dim)" }}>Loading logs…</span>
                      )}
                      {cycleLogs.length === 0 && !logsLoading && (
                        <span style={{ color: "var(--text-dim)" }}>No logs yet</span>
                      )}
                      {cycleLogs.map((entry, i) => (
                        <div key={i} style={{
                          marginBottom: "3px",
                          color: entry.level === "error" ? "var(--red)" :
                                 entry.level === "warn"  ? "var(--orange)" : "var(--text-dim)",
                        }}>
                          <span style={{ color: "var(--text-dim)", marginRight: "8px" }}>
                            {new Date(entry.ts).toLocaleTimeString()}
                          </span>
                          <span style={{ color: entry.level === "error" ? "var(--red)" : entry.level === "warn" ? "var(--orange)" : "var(--green)", marginRight: "8px", fontSize: "10px", textTransform: "uppercase" }}>
                            [{entry.level}]
                          </span>
                          {entry.msg}
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Performance Modal ────────────────────────────────────────────── */}
      {perfModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1200,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: "min(900px, 96vw)", maxHeight: "92vh", overflowY: "auto", position: "relative",
            background: "#0d1117", border: "1px solid var(--border-bright)", borderRadius: "10px",
            padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.78)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontWeight: 700, fontSize: "15px" }}>📈 Performance — {perfModal.cycleName}</span>
              <button className="btn-secondary" style={{ padding: "4px 10px" }} onClick={() => setPerfModal(null)}>✕</button>
            </div>

            {perfModal.loading && (
              <div style={{ textAlign: "center", padding: "48px", color: "var(--text-dim)" }}>
                <div style={{ fontSize: "26px", marginBottom: "10px" }}>⟳</div>
                Loading performance data…
              </div>
            )}

            {!perfModal.loading && perfModal.data?.error && (
              <div className="error-banner">{perfModal.data.error}</div>
            )}

            {!perfModal.loading && perfModal.data && !perfModal.data.error && (() => {
              const CHART_COLORS = ["#4a9eff", "#00d4a3", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#10b981", "#f97316"];
              const rs   = perfModal.data.run_stats    as Record<string, any>;
              const acct = perfModal.data.live_account as Record<string, any> | null;
              const pos  = (perfModal.data.live_positions ?? []) as any[];
              const totalUPL = perfModal.data.total_unrealized_pl as number;

              const methodPie = [
                { name: "AI Allocation",    value: rs.ai_runs    },
                { name: "Sharpe Fallback",  value: rs.sharpe_runs },
              ].filter(d => d.value > 0);

              const symBarData = Object.entries(rs.strategy_frequency ?? {})
                .sort((a: any, b: any) => b[1] - a[1])
                .slice(0, 8)
                .map(([name, count]) => ({ name: STRATEGY_LABELS[name] ?? name, count }));

              const symFreqData = Object.entries(rs.symbol_frequency ?? {})
                .sort((a: any, b: any) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, count]) => ({ name, count }));

              return (
                <>
                  {/* ── Top stat cards ─────────────────────────────────────── */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px", marginBottom: "22px" }}>
                    {[
                      { label: "Runs Completed",        value: rs.runs_completed,    color: "var(--accent)" },
                      { label: "Capital Deployed",       value: `$${(rs.total_capital_deployed / 1000).toFixed(1)}k`, color: "var(--text)" },
                      { label: "Budget / Cycle",         value: `$${rs.total_capital?.toLocaleString()}`, color: "var(--text-sub)" },
                      { label: "AI Allocation",          value: `${rs.ai_pct}%`,      color: "var(--green)" },
                      { label: "Avg Sharpe / Run",       value: rs.avg_sharpe_per_run != null ? rs.avg_sharpe_per_run.toFixed(2) : "—", color: (rs.avg_sharpe_per_run ?? 0) >= 1 ? "var(--green)" : "var(--text-dim)" },
                      { label: "Mode",                   value: rs.dry_run ? "Dry Run" : rs.auto_execute ? "Live Execute" : "Manual", color: rs.dry_run ? "var(--orange)" : rs.auto_execute ? "var(--green)" : "var(--text-dim)" },
                    ].map(card => (
                      <div key={card.label} style={{
                        background: "var(--bg-elevated)", borderRadius: "8px", padding: "12px 14px",
                        border: "1px solid var(--border)",
                      }}>
                        <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-dim)", marginBottom: "5px" }}>
                          {card.label}
                        </div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: card.color }}>{card.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── Account equity cards ─────────────────────────────── */}
                  {acct && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "10px", marginBottom: "22px" }}>
                      {[
                        { label: "Portfolio Value",   value: `$${acct.portfolio_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: "var(--text)" },
                        { label: "Cash",              value: `$${acct.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: "var(--text-sub)" },
                        { label: "Buying Power",      value: `$${acct.buying_power.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: "var(--text-sub)" },
                        { label: "Total Unrealized P&L", value: `${totalUPL >= 0 ? "+" : ""}$${totalUPL.toFixed(2)}`, color: totalUPL >= 0 ? "var(--green)" : "var(--red)" },
                        { label: "Day P&L (equity Δ)", value: `${acct.day_pnl >= 0 ? "+" : ""}$${acct.day_pnl.toFixed(2)}`, color: acct.day_pnl >= 0 ? "var(--green)" : "var(--red)" },
                      ].map(card => (
                        <div key={card.label} style={{
                          background: "rgba(74,158,255,0.06)", borderRadius: "8px", padding: "10px 14px",
                          border: "1px solid rgba(74,158,255,0.15)",
                        }}>
                          <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-dim)", marginBottom: "5px" }}>
                            {card.label}
                          </div>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: card.color }}>{card.value}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Charts row ───────────────────────────────────────── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "22px" }}>
                    {/* Allocation method breakdown */}
                    <div style={{ background: "var(--bg-elevated)", borderRadius: "8px", padding: "14px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", marginBottom: "8px" }}>
                        Allocation Method Split
                      </div>
                      {methodPie.length > 0 ? (
                        <ResponsiveContainer width="100%" height={170}>
                          <PieChart>
                            <Pie data={methodPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62}
                              label={({ name, value }: any) => `${name.split(" ")[0]} ${value}`} labelLine={false}>
                              <Cell fill="var(--green)" />
                              <Cell fill="var(--orange)" />
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: "#0d1117", border: "1px solid var(--border)", fontSize: "12px", color: "#e6edf3" }}
                              labelStyle={{ color: "#e6edf3" }}
                              itemStyle={{ color: "#e6edf3" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div style={{ color: "var(--text-dim)", fontSize: "12px", textAlign: "center", paddingTop: "40px" }}>No runs yet</div>
                      )}
                    </div>

                    {/* Strategy usage bar */}
                    <div style={{ background: "var(--bg-elevated)", borderRadius: "8px", padding: "14px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", marginBottom: "8px" }}>
                        Strategy Usage (runs)
                      </div>
                      {symBarData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={170}>
                          <BarChart data={symBarData} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
                            <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-dim)" } as any} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--text-sub)" } as any} width={90} />
                            <Tooltip
                              contentStyle={{ background: "#0d1117", border: "1px solid var(--border)", fontSize: "11px", color: "#e6edf3" }}
                              labelStyle={{ color: "#e6edf3" }}
                              itemStyle={{ color: "#e6edf3" }}
                            />
                            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                              {symBarData.map((_: any, i: number) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div style={{ color: "var(--text-dim)", fontSize: "12px", textAlign: "center", paddingTop: "40px" }}>No runs yet</div>
                      )}
                    </div>
                  </div>

                  {/* ── Symbol frequency bar ─────────────────────────────── */}
                  {symFreqData.length > 0 && (
                    <div style={{ background: "var(--bg-elevated)", borderRadius: "8px", padding: "14px", border: "1px solid var(--border)", marginBottom: "22px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", marginBottom: "8px" }}>
                        Symbol Appearances Across Runs
                      </div>
                      <ResponsiveContainer width="100%" height={130}>
                        <BarChart data={symFreqData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-sub)" } as any} />
                          <YAxis tick={{ fontSize: 10, fill: "var(--text-dim)" } as any} />
                          <Tooltip
                            contentStyle={{ background: "#0d1117", border: "1px solid var(--border)", fontSize: "11px", color: "#e6edf3" }}
                            labelStyle={{ color: "#e6edf3" }}
                            itemStyle={{ color: "#e6edf3" }}
                          />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {symFreqData.map((_: any, i: number) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* ── Live positions table ─────────────────────────────── */}
                  {pos.length > 0 ? (
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", marginBottom: "10px" }}>
                        Open Positions — Live P&L
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                              {["Symbol", "Side", "Qty", "Avg Entry", "Current", "Market Value", "Cost Basis", "Unrealized P&L", "P&L %", "In Cycle"].map(h => (
                                <th key={h} style={{
                                  textAlign: "right", padding: "6px 10px", fontSize: "10px",
                                  textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", fontWeight: 600,
                                  ...(h === "Symbol" || h === "Side" || h === "In Cycle" ? { textAlign: "left" } : {}),
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pos.map((p: any) => {
                              const pl     = p.unrealized_pl as number;
                              const plPct  = p.unrealized_plpc as number;
                              const plColor = pl >= 0 ? "var(--green)" : "var(--red)";
                              return (
                                <tr key={p.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                                  <td style={{ padding: "7px 10px", fontWeight: 700 }}>{p.symbol}</td>
                                  <td style={{ padding: "7px 10px", color: p.side === "long" ? "var(--green)" : "var(--red)", fontSize: "11px", textTransform: "uppercase" }}>{p.side}</td>
                                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{p.qty}</td>
                                  <td style={{ padding: "7px 10px", textAlign: "right" }}>${p.avg_entry_price.toFixed(2)}</td>
                                  <td style={{ padding: "7px 10px", textAlign: "right" }}>${p.current_price.toFixed(2)}</td>
                                  <td style={{ padding: "7px 10px", textAlign: "right" }}>${p.market_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                  <td style={{ padding: "7px 10px", textAlign: "right", color: "var(--text-dim)" }}>${p.cost_basis.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: plColor }}>
                                    {pl >= 0 ? "+" : ""}${pl.toFixed(2)}
                                  </td>
                                  <td style={{ padding: "7px 10px", textAlign: "right", color: plColor, fontSize: "11px" }}>
                                    {pl >= 0 ? "+" : ""}{(plPct * 100).toFixed(2)}%
                                  </td>
                                  <td style={{ padding: "7px 10px" }}>
                                    {p.in_cycle
                                      ? <span style={{ color: "var(--green)", fontSize: "11px" }}>✓</span>
                                      : <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>—</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: "1px solid var(--border-bright)" }}>
                              <td colSpan={7} style={{ padding: "7px 10px", fontWeight: 600, fontSize: "12px" }}>Total</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: totalUPL >= 0 ? "var(--green)" : "var(--red)" }}>
                                {totalUPL >= 0 ? "+" : ""}${totalUPL.toFixed(2)}
                              </td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: "24px", color: "var(--text-dim)", fontSize: "12px", background: "var(--bg-elevated)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      No open positions in your Alpaca account.
                      {rs.dry_run && " (Cycle is running in dry-run mode — no real orders placed.)"}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Run History Modal ─────────────────────────────────────────────── */}      {runHistModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: "min(840px, 96vw)", maxHeight: "90vh", overflowY: "auto", position: "relative",
            background: "#0d1117", border: "1px solid var(--border-bright)", borderRadius: "10px",
            padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.78)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontWeight: 700, fontSize: "15px" }}>📊 Run History — {runHistModal.cycleName}</span>
              <button className="btn-secondary" style={{ padding: "4px 10px" }} onClick={() => setRunHistModal(null)}>✕</button>
            </div>

            {runHistModal.loading && (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-dim)" }}>Loading run history…</div>
            )}
            {!runHistModal.loading && runHistModal.runs.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-dim)" }}>
                <div style={{ fontSize: "28px", marginBottom: "10px" }}>📋</div>
                No runs recorded yet. Runs are saved after each cycle execution.
              </div>
            )}
            {!runHistModal.loading && runHistModal.runs.length > 0 && (() => {
              const CHART_COLORS = ["#4a9eff", "#00d4a3", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#10b981", "#f97316"];
              const run = runHistModal.runs[runHistModal.selectedIdx];
              const pieData = run ? run.items.map(i => ({ name: i.symbol, value: i.weight_pct ?? 0 })) : [];
              const barData = run ? run.items.map(i => ({ name: i.symbol, capital: i.capital ?? 0 })) : [];
              return (
                <>
                  {/* Run selector chips */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "18px" }}>
                    {runHistModal.runs.map((r, idx) => (
                      <button key={idx}
                        style={{
                          padding: "5px 12px", fontSize: "11px", borderRadius: "14px", cursor: "pointer",
                          border: "1px solid", background: idx === runHistModal.selectedIdx ? "var(--accent)" : "transparent",
                          borderColor: idx === runHistModal.selectedIdx ? "var(--accent)" : "var(--border)",
                          color: idx === runHistModal.selectedIdx ? "#fff" : "var(--text-sub)",
                        }}
                        onClick={() => setRunHistModal(p => p ? { ...p, selectedIdx: idx } : null)}>
                        Run #{r.run_number}
                        <span style={{ opacity: 0.6, fontSize: "10px", marginLeft: "4px" }}>
                          {new Date(r.ran_at).toLocaleDateString()}
                        </span>
                      </button>
                    ))}
                  </div>

                  {run && (
                    <div>
                      {/* Meta row */}
                      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", fontSize: "12px" }}>
                        <span style={{ fontWeight: 700 }}>Run #{run.run_number}</span>
                        <span style={{ color: "var(--text-dim)" }}>·</span>
                        <span style={{ color: run.allocation_method === "ai" ? "var(--green)" : "var(--orange)", fontWeight: 600 }}>
                          {run.allocation_method === "ai" ? "🤖 AI Allocation" : "📐 Sharpe Weighted"}
                        </span>
                        <span style={{ color: "var(--text-dim)" }}>·</span>
                        <span style={{ color: "var(--text-dim)" }}>{new Date(run.ran_at).toLocaleString()}</span>
                      </div>

                      {run.portfolio_thesis && (
                        <div style={{
                          background: "var(--bg-elevated)", borderRadius: "6px", padding: "10px 14px",
                          fontSize: "12px", color: "var(--text-sub)", marginBottom: "16px",
                          borderLeft: "3px solid var(--accent)",
                        }}>
                          {run.portfolio_thesis}
                        </div>
                      )}

                      {/* Charts */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", marginBottom: "8px" }}>
                            Weight Distribution
                          </div>
                          <ResponsiveContainer width="100%" height={190}>
                            <PieChart>
                              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                                label={({ name, value }: any) => `${name} ${Number(value).toFixed(0)}%`} labelLine={false}>
                                {pieData.map((_: any, i: number) => (
                                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(v: any) => `${Number(v).toFixed(1)}%`}
                                contentStyle={{ background: "#0d1117", border: "1px solid var(--border)", fontSize: "12px", color: "#e6edf3" }}
                                labelStyle={{ color: "#e6edf3" }}
                                itemStyle={{ color: "#e6edf3" }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", marginBottom: "8px" }}>
                            Capital Allocation
                          </div>
                          <ResponsiveContainer width="100%" height={190}>
                            <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 16, top: 4, bottom: 4 }}>
                              <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-dim)" } as any}
                                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--text-sub)" } as any} width={48} />
                              <Tooltip
                                formatter={(v: any) => `$${Number(v).toLocaleString()}`}
                                contentStyle={{ background: "#0d1117", border: "1px solid var(--border)", fontSize: "12px", color: "#e6edf3" }}
                                labelStyle={{ color: "#e6edf3" }}
                                itemStyle={{ color: "#e6edf3" }}
                              />
                              <Bar dataKey="capital" radius={[0, 4, 4, 0]}>
                                {barData.map((_: any, i: number) => (
                                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Position table */}
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            {["Symbol", "Weight", "Capital", "Shares", "Price", "Strategy", "Sharpe"].map(h => (
                              <th key={h} style={{
                                textAlign: "left", padding: "6px 8px",
                                fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em",
                                color: "var(--text-dim)", fontWeight: 600,
                              }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {run.items.map((item, idx) => (
                            <tr key={item.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "7px 8px", fontWeight: 700, color: CHART_COLORS[idx % CHART_COLORS.length] }}>{item.symbol}</td>
                              <td style={{ padding: "7px 8px" }}>{item.weight_pct?.toFixed(1)}%</td>
                              <td style={{ padding: "7px 8px" }}>${item.capital?.toLocaleString()}</td>
                              <td style={{ padding: "7px 8px" }}>{item.shares}</td>
                              <td style={{ padding: "7px 8px" }}>${item.current_price?.toFixed(2)}</td>
                              <td style={{ padding: "7px 8px", color: "var(--text-dim)", fontSize: "11px" }}>
                                {STRATEGY_LABELS[item.best_strategy ?? ""] ?? item.best_strategy ?? "—"}
                              </td>
                              <td style={{
                                padding: "7px 8px",
                                color: (item.sharpe_ratio ?? 0) > 1 ? "var(--green)"
                                     : (item.sharpe_ratio ?? 0) > 0 ? "var(--text-sub)"
                                     : "var(--text-dim)",
                              }}>
                                {item.sharpe_ratio !== null && item.sharpe_ratio !== undefined
                                  ? item.sharpe_ratio.toFixed(2) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
