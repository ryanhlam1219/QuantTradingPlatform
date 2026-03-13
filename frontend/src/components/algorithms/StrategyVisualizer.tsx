/**
 * StrategyVisualizer — interactive Recharts demonstrations for each algorithm.
 * Uses deterministic synthetic price data so every load looks consistent.
 * No API calls needed — purely educational.
 */
import { useMemo, useState } from "react";
import {
  ComposedChart, Line, Area, Bar, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

// ── Synthetic price generator (seeded random walk) ────────────────────────

function syntheticPrice(seed = 42, n = 120, base = 100, vol = 0.012, trend = 0.0003) {
  let price = base;
  let r = seed;
  const lcg = () => { r = (1664525 * r + 1013904223) & 0xffffffff; return (r >>> 0) / 0xffffffff; };
  return Array.from({ length: n }, (_, i) => {
    const change = (lcg() - 0.499) * vol + trend;
    price = price * (1 + change);
    return { i, price: +price.toFixed(2) };
  });
}

function sma(data: number[], period: number): (number | null)[] {
  return data.map((_, i) =>
    i < period - 1 ? null : +(data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period).toFixed(2)
  );
}

function ema(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(period - 1).fill(null);
  let prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(+prev.toFixed(2));
  for (let i = period; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    out.push(+prev.toFixed(2));
  }
  return out;
}

function computeRsi(data: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(period).fill(null);
  const deltas = data.slice(1).map((v, i) => v - data[i]);
  let ag = deltas.slice(0, period).filter(d => d > 0).reduce((a, b) => a + b, 0) / period;
  let al = -deltas.slice(0, period).filter(d => d < 0).reduce((a, b) => a + b, 0) / period;
  out.push(al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(1));
  for (let i = period; i < deltas.length; i++) {
    const g = deltas[i] > 0 ? deltas[i] : 0;
    const l = deltas[i] < 0 ? -deltas[i] : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    out.push(al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(1));
  }
  return out;
}

function computeMacd(data: number[], fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(data, fast);
  const slowEma = ema(data, slow);
  const macdLine = data.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? +(fastEma[i]! - slowEma[i]!).toFixed(4) : null
  );
  const validMacd = macdLine.filter(v => v !== null) as number[];
  const signalRaw = ema(validMacd, signal);
  const signalLine: (number | null)[] = new Array(macdLine.length).fill(null);
  let si = 0;
  macdLine.forEach((v, i) => { if (v !== null) { signalLine[i] = signalRaw[si++] ?? null; } });
  const histogram = macdLine.map((v, i) =>
    v !== null && signalLine[i] !== null ? +(v - signalLine[i]!).toFixed(4) : null
  );
  return { macdLine, signalLine, histogram };
}

// ── Shared chart theme ────────────────────────────────────────────────────

const CHART_STYLE = {
  background: "transparent",
  fontSize: 11,
};

const tooltipStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-bright)",
  borderRadius: 8,
  fontSize: 11,
  color: "var(--text)",
};

const axisStyle = { fill: "var(--text-dim)", fontSize: 10 };
const gridStyle = { stroke: "var(--border)", strokeDasharray: "3 3" };

const BUY_COLOR  = "#00d4a0";
const SELL_COLOR = "#ff4f6d";
const PRICE_COLOR = "#4a9eff";

// ── Signal dot helper ────────────────────────────────────────────────────

function SignalDot(props: any) {
  const { cx, cy, payload, dataKey, signals } = props;
  if (!cx || !cy) return null;
  const sig = signals?.[payload.i];
  if (!sig) return null;
  const color = sig === "BUY" ? BUY_COLOR : SELL_COLOR;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={color} stroke="var(--bg)" strokeWidth={2} opacity={0.9} />
      <text x={cx} y={cy - 12} textAnchor="middle" fill={color} fontSize={9} fontWeight={700}>
        {sig}
      </text>
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// INDIVIDUAL STRATEGY CHARTS
// ─────────────────────────────────────────────────────────────────────────

function MaVisualizer() {
  const [fastP, setFastP] = useState(20);
  const [slowP, setSlowP] = useState(50);

  const data = useMemo(() => {
    const raw = syntheticPrice(7, 120, 100, 0.015, 0.0004);
    const closes = raw.map(d => d.price);
    const fastMa = ema(closes, fastP);
    const slowMa = ema(closes, slowP);

    const signals: (string | null)[] = new Array(closes.length).fill(null);
    for (let i = 1; i < closes.length; i++) {
      if (fastMa[i] !== null && slowMa[i] !== null && fastMa[i - 1] !== null && slowMa[i - 1] !== null) {
        if (fastMa[i]! > slowMa[i]! && fastMa[i - 1]! <= slowMa[i - 1]!) signals[i] = "BUY";
        if (fastMa[i]! < slowMa[i]! && fastMa[i - 1]! >= slowMa[i - 1]!) signals[i] = "SELL";
      }
    }
    return raw.map((d, i) => ({
      ...d, fastMa: fastMa[i], slowMa: slowMa[i],
      signalPrice: signals[i] ? d.price : null, signal: signals[i],
    }));
  }, [fastP, slowP]);

  const buyCount  = data.filter(d => d.signal === "BUY").length;
  const sellCount = data.filter(d => d.signal === "SELL").length;
  const signals: Record<number, string> = {};
  data.forEach(d => { if (d.signal) signals[d.i] = d.signal; });

  return (
    <div className="viz-container">
      <div className="viz-controls">
        <label>Fast MA: <strong>{fastP}</strong>
          <input type="range" min={5} max={30} value={fastP}
            onChange={e => setFastP(+e.target.value)} className="viz-slider" />
        </label>
        <label>Slow MA: <strong>{slowP}</strong>
          <input type="range" min={20} max={100} value={slowP}
            onChange={e => setSlowP(+e.target.value)} className="viz-slider" />
        </label>
        <span className="viz-stat green">▲ {buyCount} BUY</span>
        <span className="viz-stat red">▼ {sellCount} SELL</span>
      </div>
      <div className="viz-callout">
        Golden Cross (BUY): fast MA crosses <em>above</em> slow MA &nbsp;·&nbsp;
        Death Cross (SELL): fast MA crosses <em>below</em> slow MA
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} style={CHART_STYLE}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="i" tick={axisStyle} tickLine={false} interval={19} tickFormatter={i => `Day ${i}`} />
          <YAxis domain={["auto", "auto"]} tick={axisStyle} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={44} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => [`$${(+v).toFixed(2)}`, name]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area dataKey="price" fill={`${PRICE_COLOR}10`} stroke={PRICE_COLOR} strokeWidth={1.5} dot={false} name="Price" />
          <Line dataKey="fastMa" stroke="#f59e0b" strokeWidth={2} dot={false} name={`Fast EMA (${fastP})`} connectNulls />
          <Line dataKey="slowMa" stroke="#c084fc" strokeWidth={2} dot={false} name={`Slow EMA (${slowP})`} connectNulls />
          <Line dataKey="signalPrice" stroke="transparent" dot={<SignalDot signals={signals} />} name="Signals" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="viz-note">Drag the sliders to see how shorter/longer periods change signal frequency.</p>
    </div>
  );
}

function RsiVisualizer() {
  const [period, setPeriod] = useState(14);
  const [overbought, setOverbought] = useState(70);
  const [oversold, setOversold] = useState(30);

  const { priceData, rsiData, signals } = useMemo(() => {
    const raw = syntheticPrice(3, 120, 100, 0.018, 0.0001);
    const closes = raw.map(d => d.price);
    const rsi = computeRsi(closes, period);
    const sigs: (string | null)[] = new Array(closes.length).fill(null);
    for (let i = 1; i < closes.length; i++) {
      if (rsi[i] !== null && rsi[i - 1] !== null) {
        if (rsi[i]! >= oversold && rsi[i - 1]! < oversold) sigs[i] = "BUY";
        if (rsi[i]! <= overbought && rsi[i - 1]! > overbought) sigs[i] = "SELL";
      }
    }
    const sigMap: Record<number, string> = {};
    raw.forEach((d, i) => { if (sigs[i]) sigMap[d.i] = sigs[i]!; });
    const priceData = raw.map((d, i) => ({
      ...d, signalPrice: sigs[i] ? d.price : null,
    }));
    const rsiData = raw.map((d, i) => ({
      i: d.i, rsi: rsi[i], signalRsi: sigs[i] ? rsi[i] : null,
    }));
    return { priceData, rsiData, signals: sigMap };
  }, [period, overbought, oversold]);

  const buyCount  = Object.values(signals).filter(s => s === "BUY").length;
  const sellCount = Object.values(signals).filter(s => s === "SELL").length;

  return (
    <div className="viz-container">
      <div className="viz-controls">
        <label>RSI Period: <strong>{period}</strong>
          <input type="range" min={7} max={30} value={period} onChange={e => setPeriod(+e.target.value)} className="viz-slider" />
        </label>
        <label>Oversold: <strong>{oversold}</strong>
          <input type="range" min={15} max={45} value={oversold} onChange={e => setOversold(+e.target.value)} className="viz-slider" />
        </label>
        <label>Overbought: <strong>{overbought}</strong>
          <input type="range" min={55} max={85} value={overbought} onChange={e => setOverbought(+e.target.value)} className="viz-slider" />
        </label>
        <span className="viz-stat green">▲ {buyCount} BUY</span>
        <span className="viz-stat red">▼ {sellCount} SELL</span>
      </div>
      <div className="viz-callout">
        BUY when RSI crosses back <em>above</em> the oversold line &nbsp;·&nbsp;
        SELL when RSI crosses back <em>below</em> the overbought line
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={priceData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="i" tick={false} />
          <YAxis tick={axisStyle} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={44} />
          <Area dataKey="price" fill={`${PRICE_COLOR}10`} stroke={PRICE_COLOR} strokeWidth={1.5} dot={false} name="Price" />
          <Line dataKey="signalPrice" stroke="transparent" dot={<SignalDot signals={signals} />} legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={rsiData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="i" tick={axisStyle} tickLine={false} interval={19} tickFormatter={i => `Day ${i}`} />
          <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} width={44} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v?.toFixed(1), "RSI"]} />
          <ReferenceLine y={overbought} stroke={SELL_COLOR} strokeDasharray="4 2" label={{ value: `OB ${overbought}`, fill: SELL_COLOR, fontSize: 9 }} />
          <ReferenceLine y={oversold}   stroke={BUY_COLOR}  strokeDasharray="4 2" label={{ value: `OS ${oversold}`, fill: BUY_COLOR, fontSize: 9 }} />
          <ReferenceLine y={50} stroke="var(--border-bright)" strokeDasharray="2 2" />
          <Area dataKey="rsi" fill="rgba(74,158,255,0.08)" stroke="#4a9eff" strokeWidth={1.5} dot={false} name="RSI" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="viz-note">The price chart and RSI panel are linked. Signals fire when RSI crosses the threshold lines — not when it's merely above/below them.</p>
    </div>
  );
}

function BollingerVisualizer() {
  const [period, setPeriod] = useState(20);
  const [stdDevMult, setStdDevMult] = useState(2);

  const data = useMemo(() => {
    const raw = syntheticPrice(11, 120, 100, 0.014, 0.0002);
    const closes = raw.map(d => d.price);
    const signals: (string | null)[] = new Array(closes.length).fill(null);
    const result = raw.map((d, i) => {
      if (i < period - 1) return { ...d, upper: null, middle: null, lower: null, bandwidth: null, signalPrice: null };
      const slice = closes.slice(i - period + 1, i + 1);
      const mid = slice.reduce((a, b) => a + b, 0) / period;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
      const upper = +(mid + stdDevMult * std).toFixed(2);
      const lower = +(mid - stdDevMult * std).toFixed(2);
      const bw = +((upper - lower) / mid * 100).toFixed(2);
      if (i > 0 && signals[i - 1] !== "HOLD") {
        if (d.price < lower) signals[i] = "BUY";
        else if (d.price > upper) signals[i] = "SELL";
      }
      return { ...d, upper, middle: +mid.toFixed(2), lower, bandwidth: bw, signalPrice: signals[i] ? d.price : null };
    });
    return result;
  }, [period, stdDevMult]);

  const sigMap: Record<number, string> = {};
  data.forEach(d => { if (d.signalPrice) sigMap[d.i] = d.price > (d.upper ?? 0) ? "SELL" : "BUY"; });

  return (
    <div className="viz-container">
      <div className="viz-controls">
        <label>Period: <strong>{period}</strong>
          <input type="range" min={10} max={40} value={period} onChange={e => setPeriod(+e.target.value)} className="viz-slider" />
        </label>
        <label>Std Dev: <strong>{stdDevMult}σ</strong>
          <input type="range" min={1} max={3} step={0.5} value={stdDevMult} onChange={e => setStdDevMult(+e.target.value)} className="viz-slider" />
        </label>
      </div>
      <div className="viz-callout">
        BUY when price closes <em>below</em> the lower band &nbsp;·&nbsp;
        SELL when price closes <em>above</em> the upper band
        &nbsp;·&nbsp; Bands widen in high volatility, narrow when calm
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="i" tick={axisStyle} tickLine={false} interval={19} tickFormatter={i => `Day ${i}`} />
          <YAxis domain={["auto", "auto"]} tick={axisStyle} tickLine={false} tickFormatter={v => `$${v?.toFixed(0)}`} width={44} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => [`$${(+v).toFixed(2)}`, name]} />
          {/* Shaded band between upper and lower */}
          <Area dataKey="upper" fill="rgba(255,159,64,0.08)" stroke="rgba(255,159,64,0.5)" strokeWidth={1.5} dot={false} name="Upper Band" connectNulls />
          <Area dataKey="lower" fill="var(--bg)" stroke="rgba(255,159,64,0.5)" strokeWidth={1.5} dot={false} name="Lower Band" connectNulls />
          <Line dataKey="middle" stroke="rgba(255,159,64,0.6)" strokeWidth={1} strokeDasharray="4 2" dot={false} name="Middle (SMA)" connectNulls />
          <Line dataKey="price"  stroke={PRICE_COLOR} strokeWidth={2} dot={false} name="Price" />
          <Line dataKey="signalPrice" stroke="transparent" dot={<SignalDot signals={sigMap} />} legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="viz-note">Wider bands (higher σ) = fewer signals. 2σ is the classic setting — statistically ~95% of price action stays inside.</p>
    </div>
  );
}

function MacdVisualizer() {
  const [fast, setFast]     = useState(12);
  const [slow, setSlow]     = useState(26);
  const [signal, setSignal] = useState(9);

  const data = useMemo(() => {
    const raw = syntheticPrice(17, 120, 100, 0.013, 0.0003);
    const closes = raw.map(d => d.price);
    const { macdLine, signalLine, histogram } = computeMacd(closes, fast, slow, signal);
    const signals: (string | null)[] = new Array(closes.length).fill(null);
    for (let i = 1; i < closes.length; i++) {
      if (macdLine[i] !== null && signalLine[i] !== null && macdLine[i - 1] !== null && signalLine[i - 1] !== null) {
        if (macdLine[i]! > signalLine[i]! && macdLine[i - 1]! <= signalLine[i - 1]!) signals[i] = "BUY";
        if (macdLine[i]! < signalLine[i]! && macdLine[i - 1]! >= signalLine[i - 1]!) signals[i] = "SELL";
      }
    }
    const sigMap: Record<number, string> = {};
    raw.forEach((d, i) => { if (signals[i]) sigMap[d.i] = signals[i]!; });
    return {
      priceData: raw.map((d, i) => ({ ...d, signalPrice: signals[i] ? d.price : null })),
      macdData:  raw.map((d, i) => ({ i: d.i, macd: macdLine[i], signal: signalLine[i], hist: histogram[i] })),
      sigMap,
    };
  }, [fast, slow, signal]);

  return (
    <div className="viz-container">
      <div className="viz-controls">
        <label>Fast: <strong>{fast}</strong>
          <input type="range" min={5} max={20} value={fast} onChange={e => setFast(+e.target.value)} className="viz-slider" />
        </label>
        <label>Slow: <strong>{slow}</strong>
          <input type="range" min={15} max={40} value={slow} onChange={e => setSlow(+e.target.value)} className="viz-slider" />
        </label>
        <label>Signal: <strong>{signal}</strong>
          <input type="range" min={5} max={15} value={signal} onChange={e => setSignal(+e.target.value)} className="viz-slider" />
        </label>
      </div>
      <div className="viz-callout">
        BUY when MACD line crosses <em>above</em> the signal line &nbsp;·&nbsp;
        SELL when MACD crosses <em>below</em> &nbsp;·&nbsp;
        Histogram shows the gap between them
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={data.priceData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="i" tick={false} />
          <YAxis tick={axisStyle} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={44} />
          <Area dataKey="price" fill={`${PRICE_COLOR}10`} stroke={PRICE_COLOR} strokeWidth={1.5} dot={false} name="Price" />
          <Line dataKey="signalPrice" stroke="transparent" dot={<SignalDot signals={data.sigMap} />} legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={data.macdData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="i" tick={axisStyle} tickLine={false} interval={19} tickFormatter={i => `Day ${i}`} />
          <YAxis tick={axisStyle} tickLine={false} width={44} tickFormatter={v => v?.toFixed(2)} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: string) => [v?.toFixed(4), n]} />
          <ReferenceLine y={0} stroke="var(--border-bright)" />
          <Bar dataKey="hist" name="Histogram" fill="rgba(192,132,252,0.4)"
            label={false}
            // positive bars green, negative red
          />
          <Line dataKey="macd"   stroke="#c084fc" strokeWidth={2} dot={false} name="MACD" connectNulls />
          <Line dataKey="signal" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Signal" connectNulls strokeDasharray="4 2" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="viz-note">The crossover works best when the histogram is transitioning from negative to positive (BUY) or positive to negative (SELL).</p>
    </div>
  );
}

function GridVisualizer() {
  const [gridSize, setGridSize]   = useState(2.5);
  const [gridLevels, setGridLevels] = useState(5);

  const data = useMemo(() => {
    const raw = syntheticPrice(23, 100, 100, 0.009, 0);   // flat/oscillating for grid
    const closes = raw.map(d => d.price);
    const anchor = closes[0];
    const levelPct = gridSize / 100;
    const levels = Array.from({ length: gridLevels }, (_, k) => anchor - (k + 1) * anchor * levelPct);
    const signals: (string | null)[] = new Array(closes.length).fill(null);
    const lastCrossing: Record<number, number | null> = {};
    levels.forEach((_, k) => { lastCrossing[k] = null; });
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1], curr = closes[i];
      for (let k = 0; k < levels.length; k++) {
        const lv = levels[k];
        if (prev > lv && curr <= lv) { signals[i] = "BUY"; lastCrossing[k] = i; }
        else if (prev < lv + anchor * levelPct && curr >= lv + anchor * levelPct && lastCrossing[k] !== null) {
          signals[i] = "SELL";
        }
      }
    }
    const sigMap: Record<number, string> = {};
    raw.forEach((d, i) => { if (signals[i]) sigMap[d.i] = signals[i]!; });
    return {
      chartData: raw.map((d, i) => ({ ...d, signalPrice: signals[i] ? d.price : null })),
      levels, sigMap,
    };
  }, [gridSize, gridLevels]);

  return (
    <div className="viz-container">
      <div className="viz-controls">
        <label>Grid Spacing: <strong>{gridSize}%</strong>
          <input type="range" min={1} max={5} step={0.5} value={gridSize} onChange={e => setGridSize(+e.target.value)} className="viz-slider" />
        </label>
        <label>Grid Levels: <strong>{gridLevels}</strong>
          <input type="range" min={2} max={8} value={gridLevels} onChange={e => setGridLevels(+e.target.value)} className="viz-slider" />
        </label>
      </div>
      <div className="viz-callout">
        Buy orders placed at each grid level below current price &nbsp;·&nbsp;
        Sell orders placed {gridSize}% above each buy &nbsp;·&nbsp;
        Profit captured on every oscillation
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data.chartData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="i" tick={axisStyle} tickLine={false} interval={19} tickFormatter={i => `Day ${i}`} />
          <YAxis domain={["auto", "auto"]} tick={axisStyle} tickLine={false} tickFormatter={v => `$${v.toFixed(1)}`} width={44} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`$${(+v).toFixed(2)}`]} />
          {/* Grid level reference lines */}
          {data.levels.map((lv, k) => (
            <ReferenceLine key={k} y={lv} stroke="rgba(255,159,64,0.4)" strokeDasharray="3 3"
              label={{ value: `Buy L${k + 1}`, position: "insideLeft", fill: "rgba(255,159,64,0.7)", fontSize: 8 }} />
          ))}
          <Area dataKey="price" fill={`${PRICE_COLOR}10`} stroke={PRICE_COLOR} strokeWidth={2} dot={false} name="Price" />
          <Line dataKey="signalPrice" stroke="transparent" dot={<SignalDot signals={data.sigMap} />} legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="viz-note">Grid trading thrives on sideways oscillation. In a strong trend it can accumulate losing positions — combine with a trend filter or wide stop-loss.</p>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────

const VISUALIZERS: Record<string, React.FC> = {
  moving_average_crossover: MaVisualizer,
  rsi:                      RsiVisualizer,
  bollinger_bands:          BollingerVisualizer,
  macd:                     MacdVisualizer,
  grid_trading:             GridVisualizer,
};

export function StrategyVisualizer({ strategy }: { strategy: string }) {
  const Viz = VISUALIZERS[strategy];
  if (!Viz) return <div className="viz-unavailable">No visualizer available for this strategy.</div>;
  return <Viz />;
}
