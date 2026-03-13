/**
 * Shared algo parameter store backed by localStorage.
 * Any page that imports this hook reads and writes the same values,
 * so params configured in AlgorithmsPage are automatically used
 * in BacktestPage and TradingPage.
 */
import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "qe_algo_params_v1";

export const DEFAULT_PARAMS: Record<string, Record<string, number | string>> = {
  moving_average_crossover: { fast_period: 20, slow_period: 50, ma_type: "ema" },
  rsi:                      { period: 14, oversold: 30, overbought: 70 },
  bollinger_bands:          { period: 20, std_dev: 2.0 },
  macd:                     { fast_period: 12, slow_period: 26, signal_period: 9 },
  grid_trading:             { grid_levels: 10, grid_spacing_pct: 0.02, lookback: 50 },
};

function loadFromStorage(): Record<string, Record<string, number | string>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_PARAMS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_PARAMS };
}

function saveToStorage(params: Record<string, Record<string, number | string>>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch {}
}

// Module-level state so all hook instances share the same object
let _params = loadFromStorage();
const _listeners = new Set<() => void>();

function notify() { _listeners.forEach(fn => fn()); }

export function useAlgoParams() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);

  const setParam = useCallback((strategy: string, key: string, value: number | string) => {
    _params = { ..._params, [strategy]: { ..._params[strategy], [key]: value } };
    saveToStorage(_params);
    notify();
  }, []);

  const setStrategyParams = useCallback((strategy: string, newParams: Record<string, number | string>) => {
    _params = { ..._params, [strategy]: newParams };
    saveToStorage(_params);
    notify();
  }, []);

  const resetStrategy = useCallback((strategy: string) => {
    _params = { ..._params, [strategy]: { ...DEFAULT_PARAMS[strategy] } };
    saveToStorage(_params);
    notify();
  }, []);

  const getParams = useCallback((strategy: string) => {
    return _params[strategy] ?? DEFAULT_PARAMS[strategy] ?? {};
  }, []);

  return { params: _params, getParams, setParam, setStrategyParams, resetStrategy };
}
