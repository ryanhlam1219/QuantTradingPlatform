# QuantEdge Trading Platform

A full-stack algorithmic trading platform with AI-powered asset discovery, multi-strategy backtesting, Sharpe-weighted portfolio construction, live paper trading via Alpaca, and 24/7 scheduled AutoTrader cycles.

---

## What's Inside

| Feature | Description |
|---|---|
| **Asset Screener** | Scan 40+ symbols by momentum, volatility, RSI, and market condition |
| **AI Research** | Per-asset analysis using local Ollama LLM + Alpaca news + 5-strategy backtests |
| **Portfolio Builder** | Sharpe-weighted allocation with AI review and one-click execution |
| **Backtesting** | 5 strategies, single/compare/portfolio modes, full metrics suite |
| **Algorithm Lab** | Interactive strategy docs with parameter sliders and live signal visualizers |
| **Live Trading** | Paper trading via Alpaca — execute signals, monitor positions, manage orders |
| **AutoTrader** | One-shot analysis or 24/7 scheduled cycles with AI-driven capital allocation |
| **Scheduled Cycles** | Create persistent cycles that research, rank, allocate, and optionally execute on a schedule |
| **Run History** | Per-run charts (weight pie, capital bar) and allocation table stored for every cycle execution |
| **Performance Modal** | Aggregate stats across all runs — allocation method split, strategy usage, live Alpaca P&L |
| **Risk Manager** | Position sizing calculator and portfolio-level risk metrics |
| **Admin Logs** | Tail live server logs via REST API (`GET /admin/logs`) or SSE stream |

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11+, FastAPI, Pydantic v2, httpx, numpy |
| Frontend | React 18, TypeScript, Vite, Recharts |
| AI | Ollama (local LLM — llama3, mistral, or any compatible model) |
| Primary Broker | Alpaca (paper + live) |
| Data Feed | Alpaca IEX (free) or SIP (paid) |
| Containerisation | Docker + Docker Compose |

---

## Quick Start

### 1. Get Alpaca credentials

Sign up for a **free paper trading account** at [alpaca.markets](https://alpaca.markets). Copy your Paper Trading API key and secret.

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_FEED=iex
```

### 3. (Optional) Set up Ollama for AI features

```bash
# Install from https://ollama.com, then:
ollama serve              # start the server (runs on port 11434)
ollama pull llama3        # download default model (~4GB, one-time)
```

QuantEdge will auto-detect Ollama and attempt to start it if it's offline. All AI features degrade gracefully — price stats and backtests still work without Ollama.

You can change the model in `.env`:
```env
OLLAMA_MODEL=mistral       # or qwen2.5, phi3, llama3.1, etc.
```

### 4. Start everything

```bash
./start.sh
```

- Frontend: http://localhost:3000  
- API docs: http://localhost:8000/docs  
- Ollama: http://localhost:11434 (if running)

---

## Architecture

```
frontend (React/Vite :3000)
        │
        └─► backend (FastAPI :8000)
                │
                ├─► Alpaca Markets API   (price data + order execution)
                ├─► Alpaca News API      (headlines for Research page)
                └─► Ollama (:11434)      (local LLM for AI analysis)
```

### Backend structure

```
backend/app/
├── api/routes/
│   ├── screener.py        POST /screener/scan, /screener/suggest
│   ├── research.py        POST /research/{symbol}, /research/batch
│   ├── portfolio.py       POST /portfolio/build, /portfolio/execute, /portfolio/chat
│   ├── backtest.py        POST /backtest/run, /backtest/compare, /backtest/portfolio
│   ├── algorithms.py      GET  /algorithms/, POST /algorithms/{name}/signals
│   ├── trades.py          GET/POST /trades/account, /positions, /orders
│   ├── market_data.py     GET  /market-data/candles/{symbol}
│   ├── cycles.py          Full AutoTrader Cycles CRUD + run, history, performance
│   ├── risk.py            GET/POST /risk/metrics, /risk/position-size
│   └── admin.py           GET /admin/logs, /admin/logs/stream (SSE)
│
├── services/
│   ├── ollama.py          Ollama client with auto-start, auto-pull, AI allocation
│   ├── screener.py        Concurrent asset scanning, technical metrics
│   ├── research.py        Full analysis pipeline (price + backtests + news + AI)
│   ├── portfolio_builder.py  Sharpe-weighted allocation + execution
│   ├── autotrader.py      Full AutoTrader pipeline: research → rank → allocate → execute
│   ├── cycle_manager.py   Background scheduler for persistent AutoTrader cycles
│   └── risk_manager.py    Position sizing, portfolio-level risk metrics
│
├── backtesting/
│   ├── engine.py          Trade simulation with slippage and commission
│   └── metrics.py         Sharpe, Sortino, Calmar, max drawdown, profit factor
│
├── algorithms/
│   ├── ma_crossover.py    EMA/SMA crossover
│   ├── rsi.py             RSI with configurable thresholds
│   ├── bollinger_bands.py Bollinger Bands mean-reversion
│   ├── macd.py            MACD histogram + signal line crossover
│   └── grid_trading.py    Fixed-grid buy-low sell-high
│
├── brokers/
│   ├── alpaca.py          Bars, order placement, positions
│   ├── kraken.py          (stub — future integration)
│   └── binance.py         (stub — future integration)
│
└── config.py              Pydantic settings, reads from .env
```

> **Runtime file:** `backend/cycle_state.json` stores persisted cycle definitions and run history. It is auto-created at runtime and is excluded from version control via `.gitignore`.

### Frontend structure

```
frontend/src/
├── pages/
│   ├── Dashboard.tsx             Candlestick chart + live signals
│   ├── ScreenerPage.tsx          Watchlist scanner + AI suggestions
│   ├── ResearchPage.tsx          Per-asset AI analysis queue
│   ├── PortfolioBuilderPage.tsx  Allocation planner + execution
│   ├── BacktestPage.tsx          Single / compare / portfolio backtest
│   ├── AlgorithmsPage.tsx        Docs, visualizer, parameter lab
│   ├── TradingPage.tsx           Live order execution + monitoring
│   ├── AutoTraderPage.tsx        One-shot runs + scheduled cycles management
│   ├── RiskPage.tsx              Position sizing calculator + portfolio risk
│   └── GuidePage.tsx             User guide (10 sections)
│
├── components/
│   ├── algorithms/StrategyVisualizer.tsx  Interactive Recharts signal demos
│   ├── charts/CandlestickChart.tsx        Main price chart
│   ├── charts/EquityCurveChart.tsx        Backtest equity curve
│   └── common/OllamaStatus.tsx            Live Ollama health banner
│
├── hooks/
│   └── useAlgoParams.ts       Shared strategy parameters (persist to localStorage)
│
└── services/api.ts            Typed API client for all endpoints
```

---

## Pages and Features

### 🔍 Screener
Scan a watchlist of 40+ symbols simultaneously. Each scan fetches 120 days of daily data and computes:

- **Trend Score** — % price is above/below its 20-day MA
- **30d / 90d Momentum** — price return over 30 and 90 days
- **Annualised Volatility** — standard deviation of daily returns × √252
- **RSI (14)** — relative strength index
- **Volume Rank** — today's volume vs 20-day average
- **Market Condition** — trending_up / trending_down / ranging / volatile

Filter results and send candidates to Research with one click. The AI Suggestions panel asks Ollama to recommend assets that complement your selections.

**Pre-built watchlists:** S&P 100, Top Crypto, Growth Tech, ETFs

### 🔬 Research
Full AI analysis pipeline per asset:

1. Fetch 365 days of daily candles
2. Compute price statistics (price, returns, volatility, RSI, MA distance)  
3. Run a 1-year backtest for all 5 strategies
4. Fetch recent news headlines (Alpaca News API)
5. Send everything to Ollama for a structured recommendation

**Output:** BUY/SELL/HOLD with confidence score, market condition classification, best-fit strategy with reasoning, key support/resistance levels, and a risk summary.

### 📊 Portfolio Builder
Construct a multi-asset algorithmic portfolio:

1. **Add pairs** — (symbol, strategy) pairs from Research or manually
2. **Build plan** — runs 1-year backtest per pair, computes Sharpe-weighted allocation
3. **AI review** — Ollama rates the portfolio 0–10 and gives a GO/CAUTION/NO_GO verdict
4. **Execute** — fires all market orders simultaneously via Alpaca

**Allocation formula:**
```
weight_i = max(sharpe_i, 0.01) / sum(all_sharpes)
clamp each weight to [5%, 40%]
renormalise to 100%
```

### 📈 Backtesting
- **Single Strategy** — one symbol, one strategy, full metrics
- **Compare All** — all 5 strategies on the same symbol, ranked by Sharpe
- **Portfolio** — one strategy across multiple symbols with equal capital split

**Metrics:** Total Return, Annualised Return, Sharpe, Sortino, Calmar, Max Drawdown, Win Rate, Profit Factor, Avg Holding Days, Volatility.

### ⚙ Algorithm Lab
Five strategies, each with:
- **Overview** — plain-English explanation, analogy, step-by-step logic
- **Visualise** — interactive Recharts demo showing how signals are generated on synthetic data (drag sliders to change parameters live)
- **Parameters** — sliders connected to the shared parameter store used by backtests and live trading
- **Tuning Tips** — market-condition-specific advice

Parameters set here are automatically used in backtests and signal execution.

### ⟡ Live Trading
- Account overview (portfolio value, cash, buying power, P&L)
- Execute strategy signals — generates latest signal and places market order
- Manual order entry
- Open positions with one-click close
- Open orders with cancel
- Recent fills

---

### 🤖 AutoTrader
Automates the full research → rank → allocate → (optionally execute) pipeline.

#### One-Shot Run
Runs a single round of analysis on a user-defined watchlist and capital amount. Results appear live as each asset is processed.

**Smart Asset Selection pipeline:**
1. Research all assets in the watchlist (price stats + 5-strategy backtests + AI analysis)
2. Score each asset with a **composite score**: 50% best Sharpe (normalised vs 3.0) + 30% AI recommendation × confidence + 20% 90-day momentum (normalised vs ±50%)
3. Keep only the **top 60%** of assets by score (minimum 2, maximum 10)
4. Pass the selected assets to the AI allocator with instructions to concentrate capital (strongest 25–40%, moderate 10–25%, weakest ≥5%)
5. Fall back to a pure Sharpe-weighted allocation if AI is unavailable

**Ranked-out assets** (those eliminated in step 3) are displayed in a separate "Ranked out" panel with their AI signal, best Sharpe, 90d return, and the reason they were excluded.

#### Scheduled Cycles
Persist named AutoTrader configurations that run on a fixed schedule.

Each cycle has:

| Field | Description |
|---|---|
| **Name** | Human-readable label |
| **Watchlist** | Comma-separated symbols |
| **Capital** | Total budget in USD |
| **Lookback Days** | Historical data window (minimum 90 days; affects backtests and Sharpe calc) |
| **Rebalance Interval** | How often the cycle runs (e.g. 4 hours, 1 day, 1 week) |
| **Auto-Execute** | If enabled, fires live orders automatically after each run |
| **Dry Run** | If enabled, allocates capital but skips order placement |
| **Stop After N Runs** | Optional limit on total executions |
| **Stop After Loss** | Optional stop-loss threshold (0–100%) |

**Cycle actions:**
- `▶ Run Now` — trigger an immediate execution outside the schedule
- `📊` — open the **Run History** modal: per-run allocation table, weight pie chart, capital bar chart, AI thesis, timestamp
- `📈` — open the **Performance** modal: aggregate stats across all runs, live Alpaca account equity and P&L, unrealised P&L breakdown by position, allocation method split, strategy usage frequency, top symbols

#### AutoTrader Backtest
A walk-forward backtest across all assets in the watchlist using equal-weight allocation, available at `POST /autotrader/backtest`.

---

### 📐 Risk Manager
- **Position-size calculator** — enter account equity, risk % per trade, and stop-loss distance to get maximum safe share quantity
- **Portfolio risk metrics** — concentration, average correlation, total exposure

---

## Strategies

| Strategy | Best For | Key Parameters |
|---|---|---|
| MA Crossover | Trending markets | fast_period (20), slow_period (50), ma_type (EMA/SMA) |
| RSI | Range-bound markets | period (14), oversold (30), overbought (70) |
| Bollinger Bands | Volatile / mean-reverting | period (20), std_dev_multiplier (2.0) |
| MACD | Momentum trends | fast (12), slow (26), signal (9) |
| Grid Trading | Sideways / oscillating | grid_size (2%), num_grids (5), position_size |

---

## AI Features (Ollama)

All AI features use a locally-running Ollama model — no data is sent to external APIs.

| Feature | Where | What it does |
|---|---|---|
| Asset suggestions | Screener | Suggests 5 assets to complement your watchlist |
| Asset analysis | Research | BUY/SELL/HOLD + reasoning + strategy fit |
| Portfolio review | Portfolio Builder | Rates the plan 0–10, GO/CAUTION/NO_GO, improvement suggestions |
| Chat assistant | Portfolio Builder | Free-form Q&A about trading, strategies, and the platform |
| Capital allocation | AutoTrader | Concentrates capital toward highest-scored assets (25–40% for top picks) |

**Fallback behaviour:** If Ollama is offline, all AI methods return `is_fallback: true` with an error message. Price stats, backtests, Sharpe-weighted allocation, and order execution continue working normally.

**Auto-start:** On first AI request, if Ollama is unreachable, the backend attempts to launch `ollama serve` as a background process and waits up to 12 seconds for it to become responsive.

**Auto-pull:** If the configured model isn't downloaded, the backend attempts `ollama pull <model>` automatically.

---

## Admin Logs API

The backend exposes live log access for debugging without SSH access:

```
GET /admin/logs?n=200          # returns last N lines of logs/app.log as JSON
GET /admin/logs/stream         # Server-Sent Events stream of new log lines
```

Logs are also written to `logs/app.log` on disk. The startup sequence logs:

- Python version, PID, working directory
- All loaded config values (keys redacted)
- Alpaca credential check (explicit `WARNING` if key is empty or `"demo"`)
- Connectivity probe to Alpaca `/v2/clock` and Ollama `/api/tags`
- Total registered route count
- Cycle manager start/failure (full traceback on error)

If the backend fails to start, check `logs/app.log` first:
```bash
tail -f logs/app.log
```

---

## Configuration Reference

All settings are read from `backend/.env` (or environment variables):

```env
# Alpaca (required)
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets  # change to https://api.alpaca.markets for live
ALPACA_DATA_FEED=iex   # "sip" for paid full-market-data subscription

# Ollama (optional — defaults work if Ollama is running locally)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3    # any pulled model: mistral, qwen2.5, phi3, llama3.1, etc.

# App
APP_ENV=development
APP_NAME=Trading Platform
APP_VERSION=1.0.0
```

---

## Development

### Backend only
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend only
```bash
cd frontend
npm install
npm run dev
```

### Run tests
```bash
cd backend
pytest
```

### Docker Compose
```bash
docker compose up --build
```

---

## Session Persistence

The Screener, Research, and Portfolio Builder pages automatically save their state to **browser localStorage**. This means:

- **Page refresh**: your filters, screener results, research queue, analysis results, portfolio pairs, and validation results all survive a refresh.
- **Tab close/reopen**: same — state is restored from localStorage on mount.
- **Navigation**: switching between pages never resets state. Research results for all symbols remain available when you come back.

What is saved:

| Page | What persists |
|---|---|
| Screener | Active watchlist, all filters, scan results, AI suggestions |
| Research | Symbol queue, all analysis results (price stats, backtests, AI recommendations) |
| Portfolio Builder | Asset-strategy pairs, capital amount, built plan, walk-forward validation results |
| AutoTrader | Last watchlist, capital amount, run results for the current session |

**Cycle state** (scheduled cycles and their run history) is persisted server-side in `backend/cycle_state.json`, not in the browser. Cycles survive backend restarts.

What is **not** saved (transient):
- Loading/spinning state (in-flight API calls reset on refresh)
- Backtest page results (fast to re-run, not worth persisting)
- Trading page live data (always fresh from Alpaca)

To clear saved data, use the **✕ Clear all** button in the Research or Portfolio Builder header, or clear `localStorage` in your browser's developer tools (filter by keys starting with `qe_`).

---

## Limitations and Disclaimers

- **Paper trading only by default.** The platform is configured for Alpaca paper trading. Do not switch to live trading without thoroughly understanding the code, strategies, and risks.
- **IEX data feed.** Free Alpaca accounts use the IEX feed: 15-minute delayed, intraday data limited to 30 days, history back to 2016.
- **Backtest simplifications.** The engine simulates long-only strategies with market orders, no partial fills, and simplified slippage. Real trading performance will differ.
- **AutoTrader auto-execute.** When enabled, the cycle will place real orders in your Alpaca account (paper or live depending on `ALPACA_BASE_URL`). Review and test thoroughly with dry-run mode before enabling auto-execute.
- **Minimum lookback.** AutoTrader cycles require at least 90 days of historical data to compute meaningful Sharpe ratios. Shorter values are silently increased to 90.
- **Not financial advice.** This is educational software. Nothing in the platform constitutes a recommendation to buy or sell any security.
