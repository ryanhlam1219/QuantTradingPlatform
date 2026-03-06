import { useState } from "react";
import { useAlgoParams, DEFAULT_PARAMS } from "../hooks/useAlgoParams";

const ALGO_COLORS: Record<string, string> = {
  moving_average_crossover: "#4a9eff",
  rsi:                      "#00d4a0",
  bollinger_bands:          "#ff9f40",
  macd:                     "#c084fc",
  grid_trading:             "#ff4f6d",
};

const ALGO_ICONS: Record<string, string> = {
  moving_average_crossover: "〜",
  rsi:                      "◉",
  bollinger_bands:          "⊃",
  macd:                     "⊿",
  grid_trading:             "⊞",
};

interface ParamMeta {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  type: "int" | "float" | "select";
  options?: string[];
}

// Deep documentation and param constraints per strategy
const STRATEGY_DOCS: Record<string, {
  eli5: string;
  analogy: string;
  howItWorks: string[];
  example: string;
  whenToUse: string;
  whenNotToUse: string;
  paramMeta: Record<string, ParamMeta>;
  tuningTips: string[];
}> = {
  moving_average_crossover: {
    eli5: "Imagine tracking the average price of a stock over the last 20 days vs the last 50 days. When the short average climbs above the long one, it's a sign momentum is shifting upward — buy. When it falls below — sell.",
    analogy: "Think of it like a car's speedometer vs GPS speed. When your current speed (fast MA) goes above your average highway speed (slow MA), you're accelerating — that's the golden cross buy signal.",
    howItWorks: [
      "The strategy calculates two moving averages (MA) of the closing price: a fast one (e.g. 20-day) and a slow one (e.g. 50-day).",
      "A 'Golden Cross' occurs when the fast MA crosses above the slow MA — this signals that recent momentum is stronger than the long-term trend, triggering a BUY.",
      "A 'Death Cross' occurs when the fast MA crosses below the slow MA — momentum is weakening relative to the long-term trend, triggering a SELL.",
      "EMA (Exponential Moving Average) gives more weight to recent prices than SMA (Simple Moving Average), making it more responsive to new data.",
    ],
    example: "On Jan 5th, AAPL's 20-day EMA crosses above its 50-day EMA for the first time in months. The strategy buys. Over the next 6 weeks AAPL rallies 12%. When the 20-day EMA eventually falls back below the 50-day EMA, the strategy sells, locking in the gain.",
    whenToUse: "Strong trending markets — works best when assets move in clear, sustained directional trends like bull markets or sector breakouts.",
    whenNotToUse: "Sideways or choppy markets — when price oscillates without direction, the MAs will repeatedly cross each other causing many small losing trades ('whipsaws').",
    tuningTips: [
      "Shorter fast period (e.g. 10) = more signals, more noise. Better for volatile assets.",
      "Longer slow period (e.g. 100/200) = fewer but stronger signals. Better for long-term investing.",
      "Classic combo: fast=50, slow=200 is the legendary 'Golden Cross' watched by institutional traders.",
      "Use EMA over SMA for crypto and fast-moving stocks; SMA for slower index funds.",
    ],
    paramMeta: {
      fast_period: { label: "Fast Period", description: "Number of candles for the fast moving average. Lower = reacts quicker to price changes.", min: 5, max: 50, step: 1, type: "int" },
      slow_period: { label: "Slow Period", description: "Number of candles for the slow moving average. Must be larger than fast period.", min: 20, max: 300, step: 1, type: "int" },
      ma_type:     { label: "MA Type",     description: "EMA weights recent prices more (better for trending). SMA treats all candles equally.", min: 0, max: 0, step: 0, type: "select", options: ["ema","sma"] },
    },
  },
  rsi: {
    eli5: "RSI measures whether a stock has been bought too much (overbought) or sold too much (oversold). When everyone has been selling and it hits a low RSI score, it's likely to bounce — that's your buy signal.",
    analogy: "It's like a rubber band. The more it gets stretched in one direction (heavy selling → low RSI), the more likely it is to snap back. You buy when the band is stretched down and starting to return.",
    howItWorks: [
      "RSI is calculated by comparing average gains to average losses over the last N candles (default 14) and expressing it as a 0-100 score.",
      "RSI below 30 means the asset has been heavily sold relative to its gains — it's 'oversold' and may be due for a bounce. When RSI climbs back above 30, a BUY signal fires.",
      "RSI above 70 means the asset has been heavily bought — it's 'overbought' and may be due for a pullback. When RSI drops back below 70, a SELL signal fires.",
      "This is a mean-reversion strategy: it bets that extreme moves in price will eventually correct back toward the average.",
    ],
    example: "TSLA drops 18% in a week and RSI falls to 24. As selling pressure eases and RSI climbs back above 30, the strategy buys. Over the next 2 weeks TSLA recovers 11% as short sellers take profits. RSI reaches 74 — the strategy sells.",
    whenToUse: "Range-bound markets where prices oscillate between support and resistance levels. Also effective after sharp, news-driven drops that aren't fundamental changes.",
    whenNotToUse: "Strong trending markets — in a genuine downtrend, RSI can stay below 30 for weeks. Buying every dip will accumulate losses.",
    tuningTips: [
      "Period 14 is the standard — don't change it unless you have a specific reason.",
      "Tighten bands (oversold=40, overbought=60) for more frequent signals but lower conviction.",
      "Widen bands (oversold=20, overbought=80) for fewer but higher-conviction signals.",
      "Works especially well on crypto which has large oscillations compared to equities.",
    ],
    paramMeta: {
      period:     { label: "RSI Period",        description: "Number of candles to calculate RSI over. Standard is 14. Lower = more sensitive, noisier.", min: 5, max: 50, step: 1, type: "int" },
      oversold:   { label: "Oversold Threshold", description: "RSI below this = oversold. BUY signal fires when RSI rises back above this level.", min: 10, max: 45, step: 1, type: "int" },
      overbought: { label: "Overbought Threshold", description: "RSI above this = overbought. SELL signal fires when RSI drops back below this level.", min: 55, max: 90, step: 1, type: "int" },
    },
  },
  bollinger_bands: {
    eli5: "Bollinger Bands draw a 'normal range' channel around the price. When price drops below the bottom of the channel, it's unusually cheap and likely to bounce back up. When it goes above the top, it's unusually expensive.",
    analogy: "Think of price as a ball bouncing between two rubber walls. The walls stretch wider when the market is volatile and tighten when it's calm. Buy when the ball hits the bottom wall and bounces back in.",
    howItWorks: [
      "A 20-day Simple Moving Average (middle band) is calculated.",
      "The upper band = SMA + 2 standard deviations. The lower band = SMA − 2 standard deviations.",
      "Statistically, ~95% of price action stays within the 2σ bands. A break outside is unusual.",
      "A BUY signal fires when price breaks below the lower band and then re-enters — suggesting the extreme selling is exhausted.",
      "A SELL signal fires when price breaks above the upper band and then re-enters — suggesting overbought conditions are reversing.",
      "The 'bandwidth' indicator (how wide the bands are) measures current volatility — tight bands often precede large moves.",
    ],
    example: "SPY drops sharply during a market correction and closes below its lower Bollinger Band for 3 days. On day 4, it closes back inside the band — the strategy buys, expecting reversion to the 20-day mean. Over the next 10 days SPY recovers 5% toward the middle band.",
    whenToUse: "Volatile assets that tend to mean-revert: indices, large-cap stocks after earnings overreactions, and crypto during consolidation phases.",
    whenNotToUse: "During a genuine breakout (trending phase). In strong uptrends, price can 'ride the upper band' for weeks without reverting. The strategy will repeatedly sell too early.",
    tuningTips: [
      "Wider bands (std_dev=2.5) = fewer signals, only extreme conditions trigger. More reliable.",
      "Tighter bands (std_dev=1.5) = more signals, more false positives in trending markets.",
      "Combine with RSI — only take the Bollinger BUY signal when RSI is also below 40 for higher conviction.",
      "Longer period (30) smooths the middle band, better for slower-moving assets like indices.",
    ],
    paramMeta: {
      period:  { label: "Period",            description: "Number of candles for the middle band SMA and standard deviation calculation.", min: 10, max: 50, step: 1, type: "int" },
      std_dev: { label: "Std Dev Multiplier", description: "How wide the bands are. 2.0 = 95% of price stays inside. Higher = fewer signals.", min: 1.0, max: 3.5, step: 0.1, type: "float" },
    },
  },
  macd: {
    eli5: "MACD looks at whether the short-term momentum of a stock is speeding up or slowing down compared to its medium-term momentum. When short-term energy is rising faster than medium-term, that's a buy signal.",
    analogy: "It's like comparing your current walking speed to your average speed over the last hour. If you're suddenly walking faster than your hourly average — and your pace is accelerating — that's a MACD buy signal.",
    howItWorks: [
      "The MACD Line = 12-period EMA minus 26-period EMA. It measures the gap between short and medium-term momentum.",
      "The Signal Line = 9-period EMA of the MACD Line itself — a smoothed version of the MACD.",
      "When the MACD Line crosses above the Signal Line, momentum is accelerating upward → BUY.",
      "When the MACD Line crosses below the Signal Line, momentum is slowing or reversing → SELL.",
      "The Histogram shows the distance between MACD and Signal — growing bars = strengthening signal, shrinking bars = signal weakening.",
      "A MACD crossover above the zero line is more bullish than one below it.",
    ],
    example: "NVDA consolidates after a big rally. MACD drops below its signal line and the histogram turns negative (bearish cross) — the strategy sells. After a 3-week pullback, MACD crosses back above the signal line near zero — the strategy buys the re-entry. NVDA then rallies another 20%.",
    whenToUse: "Trending markets with clear momentum cycles. Excellent for technology stocks, growth names, and crypto during trending phases.",
    whenNotToUse: "Low-volatility, sideways markets. MACD will produce many crossovers with no follow-through in range-bound conditions.",
    tuningTips: [
      "Standard settings (12/26/9) are battle-tested and used by most traders — start here.",
      "Faster settings (8/17/9) work better on intraday charts or highly volatile assets.",
      "Slower settings (19/39/9) filter noise better for weekly charts or slow-moving assets.",
      "Only trade MACD crossovers that happen above the zero line for bullish setups (below zero for short setups).",
    ],
    paramMeta: {
      fast_period:   { label: "Fast EMA Period",   description: "Short-term momentum period. Standard is 12.", min: 5, max: 30, step: 1, type: "int" },
      slow_period:   { label: "Slow EMA Period",   description: "Medium-term momentum period. Standard is 26. Must be larger than fast.", min: 15, max: 60, step: 1, type: "int" },
      signal_period: { label: "Signal Period",     description: "Smoothing period for the signal line. Standard is 9.", min: 3, max: 20, step: 1, type: "int" },
    },
  },
  grid_trading: {
    eli5: "Grid trading sets up a ladder of buy orders below the current price and sell orders above it. Every time price drops to a rung on the ladder, you buy. Every time it rises to the next rung up, you sell for a small profit.",
    analogy: "Imagine you're a market maker at a fruit stall. You always buy oranges at $1.00 and sell them at $1.02. Every time prices move between those levels you make 2 cents. You don't care about direction — you just profit from the back-and-forth.",
    howItWorks: [
      "A center price is calculated from the average of the last N candles (lookback period).",
      "Grid levels are placed above and below the center at equal intervals (grid_spacing_pct apart).",
      "When price drops through a grid level going DOWN — a BUY order fires (buying the dip).",
      "When price rises through the next grid level UP — a SELL order fires (taking the profit).",
      "This repeats continuously as long as price oscillates within the grid range.",
      "The more grid levels and the tighter the spacing, the more trades — but each trade makes less profit.",
    ],
    example: "BTC/USD is ranging between $60,000 and $65,000. Grid center = $62,500. Grid spacing = 2%. At $61,250 (one level down), the strategy buys. When BTC rises back to $63,750 (one level up from entry), it sells for a ~2% gain. This can repeat multiple times during the ranging period.",
    whenToUse: "Crypto markets during consolidation/ranging phases. Also works well for forex pairs that oscillate. Best with high-liquidity assets that have predictable ranges.",
    whenNotToUse: "Trending markets are dangerous — if BTC falls from $62,500 to $40,000, the strategy will keep buying all the way down, accumulating a large losing position with no SELL signal to exit.",
    tuningTips: [
      "Tighter spacing (1%) = more trades, more commissions, smaller profit per trade. Good for very liquid assets.",
      "Wider spacing (3-5%) = fewer trades, more profit per trade, but fewer opportunities.",
      "More grid levels = larger potential position. Watch your total capital at risk carefully.",
      "Use a shorter lookback (20-30) in fast-moving markets so the center price tracks recent action.",
      "Always set a hard stop-loss outside your grid range manually to avoid catastrophic drawdown in a strong trend.",
    ],
    paramMeta: {
      grid_levels:      { label: "Grid Levels",       description: "Number of buy/sell levels above and below center. More levels = larger total position.", min: 2, max: 20, step: 1, type: "int" },
      grid_spacing_pct: { label: "Grid Spacing (%)",  description: "Percentage distance between each grid level. E.g. 0.02 = 2% between each rung.", min: 0.005, max: 0.10, step: 0.005, type: "float" },
      lookback:         { label: "Lookback Candles",  description: "How many recent candles to use to calculate the grid center price.", min: 10, max: 200, step: 5, type: "int" },
    },
  },
};



const STRATEGY_LIST = [
  { name: "moving_average_crossover", display_name: "MA Crossover",    best_for: "Trending markets" },
  { name: "rsi",                      display_name: "RSI",              best_for: "Range-bound markets" },
  { name: "bollinger_bands",          display_name: "Bollinger Bands",  best_for: "Volatile mean-reversion" },
  { name: "macd",                     display_name: "MACD",             best_for: "Momentum trends" },
  { name: "grid_trading",             display_name: "Grid Trading",     best_for: "Sideways / oscillating" },
];

export function AlgorithmsPage() {
  const [selected, setSelected]   = useState(STRATEGY_LIST[0].name);
  const [activeTab, setActiveTab] = useState<"overview"|"params"|"tips">("overview");
  const { params, setParam: _setParam, resetStrategy } = useAlgoParams();

  const doc      = STRATEGY_DOCS[selected];
  const color    = ALGO_COLORS[selected];
  const icon     = ALGO_ICONS[selected];
  const myParams = params[selected] ?? DEFAULT_PARAMS[selected];

  const setParam = (key: string, value: number | string) => _setParam(selected, key, value);
  const resetParams = () => resetStrategy(selected);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Algorithms</h1>
          <p className="page-sub">Understand, configure, and deploy each trading strategy</p>
        </div>
      </header>

      <div className="algo-layout">
        {/* Strategy list */}
        <div className="algo-list">
          {STRATEGY_LIST.map(s => (
            <button key={s.name}
              className={`algo-card ${selected === s.name ? "active" : ""}`}
              onClick={() => { setSelected(s.name); setActiveTab("overview"); }}
              style={{ "--accent": ALGO_COLORS[s.name] } as any}
            >
              <span className="algo-icon">{ALGO_ICONS[s.name]}</span>
              <div className="algo-card-body">
                <span className="algo-card-name">{s.display_name}</span>
                <span className="algo-card-sub">{s.best_for}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        <div className="algo-detail">
          {/* Header */}
          <div className="algo-detail-header" style={{ "--accent": color } as any}>
            <span className="algo-detail-icon">{icon}</span>
            <div>
              <h2 className="algo-detail-name">{STRATEGY_LIST.find(s=>s.name===selected)?.display_name}</h2>
              <span className="algo-detail-type">Quantitative Strategy</span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="algo-tabs">
            {(["overview","params","tips"] as const).map(t => (
              <button key={t}
                className={`algo-tab ${activeTab === t ? "active" : ""}`}
                style={activeTab===t ? {"--tab-accent": color} as any : undefined}
                onClick={() => setActiveTab(t)}
              >
                {t === "overview" ? "📖 Overview" : t === "params" ? "⚙ Parameters" : "💡 Tuning Tips"}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {activeTab === "overview" && (
            <div className="algo-tab-content">
              <div className="algo-section">
                <h4>Plain English</h4>
                <p className="algo-description">{doc.eli5}</p>
              </div>

              <div className="algo-section">
                <h4>The Analogy</h4>
                <div className="algo-analogy">{doc.analogy}</div>
              </div>

              <div className="algo-section">
                <h4>How It Works — Step by Step</h4>
                <ol className="algo-steps">
                  {doc.howItWorks.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>

              <div className="algo-section">
                <h4>Real-World Example</h4>
                <div className="algo-example">{doc.example}</div>
              </div>

              <div className="algo-stats">
                <div className="algo-stat">
                  <span className="algo-stat-label">✓ Best For</span>
                  <span className="algo-stat-value green">{doc.whenToUse}</span>
                </div>
                <div className="algo-stat">
                  <span className="algo-stat-label">✗ Avoid When</span>
                  <span className="algo-stat-value red">{doc.whenNotToUse}</span>
                </div>
              </div>
            </div>
          )}

          {/* Params tab */}
          {activeTab === "params" && (
            <div className="algo-tab-content">
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px"}}>
                <p style={{fontSize:"12px", color:"var(--text-dim)"}}>
                  Adjust parameters below. These values will be used when you run this strategy from the Backtest or Trading pages.
                </p>
                <button className="btn-secondary-sm" onClick={resetParams}>↺ Reset defaults</button>
              </div>

              <div className="params-detail-grid">
                {Object.entries(STRATEGY_DOCS[selected].paramMeta).map(([key, meta]) => (
                  <div key={key} className="param-detail-card">
                    <div className="param-detail-header">
                      <span className="param-detail-name">{meta.label}</span>
                      <span className="param-detail-val" style={{color}}>
                        {String(myParams[key])}
                      </span>
                    </div>
                    <p className="param-detail-desc">{meta.description}</p>

                    {meta.type === "select" ? (
                      <select className="select" value={String(myParams[key])}
                        onChange={e => setParam(key, e.target.value)}>
                        {meta.options!.map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <div className="param-slider-row">
                        <span className="param-range-label">{meta.min}</span>
                        <input type="range" className="param-slider"
                          min={meta.min} max={meta.max} step={meta.step}
                          value={Number(myParams[key])}
                          onChange={e => setParam(key, meta.type === "int" ? parseInt(e.target.value) : parseFloat(e.target.value))}
                          style={{"--slider-color": color} as any}
                        />
                        <span className="param-range-label">{meta.max}</span>
                        <input type="number" className="input param-number-input"
                          min={meta.min} max={meta.max} step={meta.step}
                          value={Number(myParams[key])}
                          onChange={e => setParam(key, meta.type === "int" ? parseInt(e.target.value) : parseFloat(e.target.value))}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tips tab */}
          {activeTab === "tips" && (
            <div className="algo-tab-content">
              <div className="algo-section">
                <h4>Optimisation Tips</h4>
                <ul className="algo-tips-list">
                  {doc.tuningTips.map((tip, i) => (
                    <li key={i}>
                      <span className="tip-bullet" style={{color}}>▸</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
