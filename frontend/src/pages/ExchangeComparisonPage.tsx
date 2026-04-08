'use client';

import React, { useEffect, useState } from 'react';
import { BinanceWSClient } from '../services/websocket/BinanceWSClient';
import { KrakenWSClient } from '../services/websocket/KrakenWSClient';
import { GeminiWSClient } from '../services/websocket/GeminiWSClient';
import { NormalizedCandle, ExchangeCandles, ExchangeStatus, ConnectionStatus } from '../types/ExchangeComparison';
import { Timeframe } from '../types/Timeframe';
import { aggregateCandles } from '../utils/candleAggregator';
import '../styles/ExchangeComparisonPage.css';

const WATCHLIST = ['BTCUSD', 'ETHUSD', 'ADAUSD', 'SOLUSD'];

export function ExchangeComparisonPage() {
  const [symbol, setSymbol] = useState<string>('BTCUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>(Timeframe.M1);
  const [enabledExchanges, setEnabledExchanges] = useState<Record<string, boolean>>({
    binance: true,
    kraken: false, // Disabled: WS connection drops immediately — TODO: debug API format
    gemini: false, // Disabled: WS connection drops immediately — TODO: debug API format
  });

  const [candles, setCandles] = useState<ExchangeCandles>({
    binance: [],
    kraken: [],
    gemini: [],
  });

  const [status, setStatus] = useState<ExchangeStatus>({
    binance: 'disconnected',
    kraken: 'disconnected',
    gemini: 'disconnected',
  });

  const [clients] = useState<Record<string, any>>({
    binance: new BinanceWSClient(),
    kraken: new KrakenWSClient(),
    gemini: new GeminiWSClient(),
  });

  // Handle incoming candle from any exchange
  const handleCandle = (exchange: keyof ExchangeCandles) => (candle: NormalizedCandle) => {
    console.log(`📊 Candle received [${exchange}]:`, candle);
    setCandles((prev) => {
      const updated = {
        ...prev,
        [exchange]: [...prev[exchange], candle],
      };
      console.log(`📈 Candles updated for ${exchange}:`, updated[exchange].length, 'total');
      return updated;
    });
  };

  // Debug: log whenever candles change
  useEffect(() => {
    const total = candles.binance.length + candles.kraken.length + candles.gemini.length;
    console.log(`🔍 Total candles in state: ${total}`, candles);
  }, [candles]);

  // Connect to exchanges when symbol or enabledExchanges change
  useEffect(() => {
    const connectExchanges = async () => {
      console.log(`[ExchangeComparison] 🔄 Connecting to exchanges...`, enabledExchanges);

      // Disconnect all first
      Object.entries(clients).forEach(([ex, client]) => {
        if (client.isConnected?.()) {
          console.log(`[ExchangeComparison] Disconnecting ${ex}`);
          client.disconnect();
          setStatus((prev) => ({ ...prev, [ex]: 'disconnected' }));
        }
      });

      // Clear candles
      setCandles({ binance: [], kraken: [], gemini: [] });

      // Connect enabled exchanges
      for (const [ex, enabled] of Object.entries(enabledExchanges)) {
        if (enabled && (ex === 'binance' || ex === 'kraken' || ex === 'gemini')) {
          setStatus((prev) => ({ ...prev, [ex]: 'connecting' }));
          try {
            // Map symbol format: BTCUSD -> BTCUSDT (Binance), XBT/USD (Kraken), btcusd (Gemini)
            let exchangeSymbol = symbol;
            if (ex === 'binance') {
              exchangeSymbol = symbol.replace('BTCUSD', 'BTCUSDT').replace('ETHUSD', 'ETHUSDT').replace('ADAUSD', 'ADAUSDT').replace('SOLUSD', 'SOLUSDT');
            } else if (ex === 'kraken') {
              exchangeSymbol = symbol.replace('BTCUSD', 'XBT/USD').replace('ETHUSD', 'ETH/USD').replace('ADAUSD', 'ADA/USD').replace('SOLUSD', 'SOL/USD');
            } else if (ex === 'gemini') {
              exchangeSymbol = symbol.toLowerCase();
            }

            const exchangeKey = ex as keyof ExchangeCandles;
            const callback = handleCandle(exchangeKey);
            console.log(`[ExchangeComparison] 🎯 Connecting ${ex} with symbol: ${exchangeSymbol}. Callback: ${typeof callback}`);
            await clients[exchangeKey].connect(exchangeSymbol, callback);
            setStatus((prev) => ({ ...prev, [exchangeKey]: 'connected' }));
            console.log(`[ExchangeComparison] ✅ ${ex} connected successfully`);
          } catch (err) {
            console.error(`[ExchangeComparison] Failed to connect ${ex}:`, err);
            setStatus((prev) => ({ ...prev, [ex]: 'error' }));
          }
        }
      }
    };

    connectExchanges();

    return () => {
      Object.values(clients).forEach((client) => {
        if (client.isConnected?.()) {
          client.disconnect();
        }
      });
    };
  }, [symbol, enabledExchanges, clients]);

  // Aggregate candles based on selected timeframe
  const aggregatedCandles = React.useMemo(() => {
    return {
      binance: aggregateCandles(candles.binance, timeframe),
      kraken: aggregateCandles(candles.kraken, timeframe),
      gemini: aggregateCandles(candles.gemini, timeframe),
    };
  }, [candles, timeframe]);

  // Get the latest candle for each exchange
  const latestCandles = {
    binance: aggregatedCandles.binance[aggregatedCandles.binance.length - 1],
    kraken: aggregatedCandles.kraken[aggregatedCandles.kraken.length - 1],
    gemini: aggregatedCandles.gemini[aggregatedCandles.gemini.length - 1],
  };

  const toggleExchange = (ex: string) => {
    setEnabledExchanges((prev) => ({ ...prev, [ex]: !prev[ex] }));
  };

  const statusColor: Record<ConnectionStatus, string> = {
    connected: 'green',
    connecting: 'yellow',
    disconnected: 'gray',
    error: 'red',
  };

  return (
    <div className="exchange-comparison-page">
      <h1>Exchange Comparison</h1>

      {/* Controls */}
      <div className="controls">
        <div className="control-group">
          <label htmlFor="symbol-select">Symbol:</label>
          <select id="symbol-select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {WATCHLIST.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="timeframe-select">Timeframe:</label>
          <select id="timeframe-select" value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
            <option value={Timeframe.M1}>1m</option>
            <option value={Timeframe.M5}>5m</option>
            <option value={Timeframe.M15}>15m</option>
            <option value={Timeframe.M30}>30m</option>
            <option value={Timeframe.H1}>1h</option>
            <option value={Timeframe.H4}>4h</option>
            <option value={Timeframe.D1}>1d</option>
          </select>
        </div>
      </div>

      {/* Debug Info */}
      <div style={{ padding: '12px', backgroundColor: '#1e3a8a', borderRadius: '6px', marginBottom: '20px', fontSize: '14px', fontFamily: 'monospace', color: '#00ff00', fontWeight: 'bold', border: '2px solid #00ff00' }}>
        🔍 DEBUG: Binance candles in state: <span style={{ color: '#ffff00' }}>{candles.binance.length}</span> | Kraken: <span style={{ color: '#ffff00' }}>{candles.kraken.length}</span> | Gemini: <span style={{ color: '#ffff00' }}>{candles.gemini.length}</span>
      </div>

      {/* Exchange toggles */}
      <div className="exchange-toggles">
        {Object.entries(enabledExchanges).map(([ex, enabled]) => (
          <label key={ex} className="toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => toggleExchange(ex)}
            />
            <span
              className="status-indicator"
              style={{ backgroundColor: statusColor[status[ex as keyof ExchangeStatus]] }}
            />
            {ex.charAt(0).toUpperCase() + ex.slice(1)}
          </label>
        ))}
      </div>

      {/* Candle grid */}
      <div className="candle-grid">
        {Object.entries(enabledExchanges).map(([ex, enabled]) => {
          if (!enabled) return null;
          const latest = latestCandles[ex as keyof typeof latestCandles];
          return (
            <div key={ex} className="candle-column">
              <div className="column-header">
                <h2>{ex.charAt(0).toUpperCase() + ex.slice(1)}</h2>
                <span className="status" style={{ color: statusColor[status[ex as keyof ExchangeStatus]] }}>
                  ●
                </span>
              </div>
              {latest ? (
                <div className="candle-data">
                  <div className="candle-row">
                    <span className="label">O</span>
                    <span className="value">{latest.open.toFixed(2)}</span>
                  </div>
                  <div className="candle-row">
                    <span className="label">H</span>
                    <span className="value">{latest.high.toFixed(2)}</span>
                  </div>
                  <div className="candle-row">
                    <span className="label">L</span>
                    <span className="value">{latest.low.toFixed(2)}</span>
                  </div>
                  <div className="candle-row">
                    <span className="label">C</span>
                    <span className="value">{latest.close.toFixed(2)}</span>
                  </div>
                  <div className="candle-row">
                    <span className="label">V</span>
                    <span className="value">{(latest.volume / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="candle-row">
                    <span className="label">T</span>
                    <span className="value">{latest.timestamp.toLocaleTimeString()}</span>
                  </div>
                </div>
              ) : (
                <div className="no-data">No candles yet</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
