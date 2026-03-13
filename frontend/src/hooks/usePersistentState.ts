/**
 * usePersistentState — drop-in replacement for useState that reads the initial
 * value from localStorage and writes every update back to it.
 *
 * Works with any JSON-serialisable type.
 * Silently falls back to the defaultValue if localStorage is unavailable
 * or the stored value is corrupt.
 *
 * Usage:
 *   const [queue, setQueue] = usePersistentState<string[]>('research_queue', []);
 */
import { useState, useCallback } from "react";

export function usePersistentState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  // Lazy initializer — only runs once on mount
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateRaw(prev => {
        const next =
          typeof value === "function"
            ? (value as (p: T) => T)(prev)
            : value;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // localStorage full or disabled — still update React state
        }
        return next;
      });
    },
    [key],
  );

  return [state, setState];
}

/** Helper to clear all QuantEdge persistent state (useful for a "reset" button) */
export function clearAllPersistentState() {
  const prefix = "qe_";
  Object.keys(localStorage)
    .filter(k => k.startsWith(prefix))
    .forEach(k => localStorage.removeItem(k));
}
