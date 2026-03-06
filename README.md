# QuantEdge Trading Platform

A full-stack algorithmic trading platform with multi-broker support, a backtesting engine, and live order execution via Alpaca. Built with Python/FastAPI on the backend and React/TypeScript on the frontend.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2 |
| Frontend | React 18, TypeScript, Vite, Recharts |
| Primary Broker | Alpaca (paper + live) |
| Additional Brokers | Kraken, Binance.US |
| Containerisation | Docker + Docker Compose |

---

## Quick Start

### 1. Get Alpaca API credentials

Sign up for a free paper trading account at https://alpaca.markets and copy your **Paper Trading** API key and secret.

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in:

```
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_FEED=iex
```

> **`ALPACA_DATA_FEED`** — free and paper-trading accounts must use `iex`. Paid subscribers with a live account can set this to `sip` for full real-time market data.

### 3. Start the platform

```bash
chmod +x start.sh
./start.sh
```

| URL | Description |
|---|---|
| http://localhost:3000 | Frontend UI |
| http://localhost:8000 | Backend API |
| http://localhost:8000/docs | Interactive API docs (Swagger) |

### 4. Stop

```bash
./start.sh stop
```

---

## Startup Script

`start.sh` is the single entry point for managing the platform.

```
./start.sh              # Start both servers (default)
./start.sh stop         # Stop all running servers
./start.sh status       # Show running status and health check
./start.sh logs         # Tail logs for both servers
./start.sh logs backend # Tail backend logs only
./start.sh logs frontend# Tail frontend logs only
./start.sh test         # Run the full backend test suite
./start.sh help         # Show all commands
```

On first run, `start.sh` will:
- Create a Python virtual environment in `backend/venv/`
- Install all Python dependencies from `requirements.txt`
- Install all Node dependencies via `npm install`
- Copy `.env.example` → `.env` if no `.env` exists yet

On subsequent runs it skips the install steps unless `requirements.txt` or `package.json` have changed.

---

## Running Without Docker

**Backend:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## Running Tests

```bash
cd backend
source venv/bin/activate

# All tests with coverage report
pytest tests/ -v --cov=app --cov-report=term-missing

# Unit tests only
pytest tests/unit/ -v

# Integration tests only (mocks broker calls — no live API needed)
pytest tests/integration/ -v

# Single file
pytest tests/unit/test_algorithms.py -v
```

---

## Project Structure

```
trading-platform/
├── start.sh                          # Start / stop / logs / test
├── docker-compose.yml
│
├── backend/
│   ├── .env.example                  # Copy to .env and fill in credentials
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py                   # FastAPI app entry point, CORS config
│   │   ├── config.py                 # Pydantic settings (reads from .env)
│   │   │
│   │   ├── models/
│   │   │   ├── candlestick.py        # Unified broker-agnostic OHLCV schema
│   │   │   ├── signal.py             # Trade signal (BUY / SELL / HOLD)
│   │   │   └── backtest.py           # BacktestConfig, Trade, BacktestResult
│   │   │
│   │   ├── brokers/
│   │   │   ├── base.py               # Abstract BaseBroker interface
│   │   │   ├── alpaca.py             # Alpaca — stocks + crypto, IEX/SIP feeds
│   │   │   ├── kraken.py             # Kraken — crypto
│   │   │   └── binance_us.py         # Binance.US — crypto
│   │   │
│   │   ├── algorithms/
│   │   │   ├── base.py               # Abstract BaseStrategy interface
│   │   │   ├── moving_average.py     # MA Crossover (Golden / Death Cross)
│   │   │   ├── rsi.py                # RSI mean-reversion
│   │   │   ├── bollinger_bands.py    # Bollinger Bands
│   │   │   ├── macd.py               # MACD momentum
│   │   │   └── grid_trading.py       # Grid trading
│   │   │
│   │   ├── backtesting/
│   │   │   ├── engine.py             # Simulation engine (see notes below)
│   │   │   └── metrics.py            # Sharpe, Sortino, drawdown, etc.
│   │   │
│   │   ├── executor/
│   │   │   └── alpaca_executor.py    # Places real / paper orders via Alpaca
│   │   │
│   │   └── api/routes/
│   │       ├── health.py             # GET /health, GET /health/ready
│   │       ├── market_data.py        # GET /market-data/candles, /symbols
│   │       ├── algorithms.py         # GET /algorithms, POST /signals
│   │       ├── backtest.py           # POST /backtest/run, /backtest/compare
│   │       └── trades.py             # GET/POST /trades/account, /orders, etc.
│   │
│   └── tests/
│       ├── conftest.py               # Shared fixtures (trending, oscillating series)
│       ├── unit/
│       │   ├── test_algorithms.py    # Signal generation for all 5 strategies
│       │   ├── test_backtesting.py   # Engine correctness + edge cases
│       │   └── test_models.py        # Candle properties, config defaults
│       └── integration/
│           └── test_api.py           # FastAPI endpoints (broker calls mocked)
│
└── frontend/
    └── src/
        ├── App.tsx                   # Root component + page routing
        ├── index.css                 # Global styles (dark terminal theme)
        ├── services/api.ts           # Typed API client (all backend calls)
        ├── hooks/useCandles.ts       # Data-fetching hook with cancel-on-unmount
        ├── types/index.ts            # Shared TypeScript interfaces
        ├── pages/
        │   ├── Dashboard.tsx         # Live candlestick chart + signal feed
        │   ├── BacktestPage.tsx      # Single strategy + compare-all backtest UI
        │   ├── AlgorithmsPage.tsx    # Strategy explorer with descriptions
        │   └── TradingPage.tsx       # Account, positions, order form
        └── components/
            ├── charts/               # CandlestickChart, EquityCurve, CompareChart
            ├── dashboard/            # MetricCard, SignalFeed
            ├── backtest/             # MetricsGrid, TradesTable
            └── layout/               # Sidebar navigation
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health/` | Liveness check |
| GET | `/health/ready` | Readiness — checks broker connectivity |
| GET | `/market-data/candles/{symbol}` | OHLCV candles. Params: `timeframe`, `broker`, `limit` |
| GET | `/market-data/symbols` | All tradeable symbols for a broker |
| GET | `/algorithms/` | List all strategies with descriptions |
| GET | `/algorithms/{name}` | Single strategy detail |
| POST | `/algorithms/{name}/signals` | Run strategy on live data, return signals |
| POST | `/backtest/run` | Run a backtest. Body: `BacktestConfig` |
| POST | `/backtest/compare` | Run all strategies on the same asset |
| GET | `/trades/account` | Alpaca account info |
| GET | `/trades/positions` | Open positions |
| GET | `/trades/orders` | Orders by status |
| POST | `/trades/order` | Place a market or limit order |
| DELETE | `/trades/order/{id}` | Cancel an order |
| DELETE | `/trades/positions/{symbol}` | Close a position |

Full interactive docs are available at http://localhost:8000/docs when the backend is running.

---

## Trading Strategies

| Strategy | Type | Best For | Key Params |
|---|---|---|---|
| Moving Average Crossover | Trend-following | Strong trending markets | `fast_period=20`, `slow_period=50`, `ma_type=ema` |
| RSI | Mean-reversion | Range-bound markets | `period=14`, `oversold=30`, `overbought=70` |
| Bollinger Bands | Volatility / mean-reversion | Volatile, oscillating markets | `period=20`, `std_dev=2.0` |
| MACD | Momentum | Trending markets with clear momentum | `fast=12`, `slow=26`, `signal=9` |
| Grid Trading | Range / oscillation | Sideways markets | `grid_levels=10`, `grid_spacing_pct=0.02` |

### Adding a New Strategy

1. Create `backend/app/algorithms/my_strategy.py` extending `BaseStrategy`
2. Implement `generate_signals(series) -> list[Signal]` and `describe() -> dict`
3. Register it in `backend/app/algorithms/__init__.py`
4. Add unit tests in `tests/unit/test_algorithms.py`

### Adding a New Broker

1. Create `backend/app/brokers/my_broker.py` extending `BaseBroker`
2. Implement `get_candles()`, `get_latest_candle()`, `get_symbols()`, `health_check()`
3. Add the broker enum value to `app/models/candlestick.py`
4. Register it in `backend/app/brokers/__init__.py`

---

## Backtesting Engine

The engine simulates a simple long-only strategy:

- On a **BUY** signal, 95% of available capital is used to enter a position (with slippage applied)
- On the next **SELL** signal, the position is closed (with slippage applied)
- Open positions at the end of the date range are closed at the last available price
- Commission is applied as a fraction of trade value (default: 0, i.e. free)
- Default slippage is 0.1% per trade

The equity curve is built by accumulating P&L at the date each trade closes. All performance metrics are then computed from the resulting daily equity series.

**Limitations to be aware of:**
- Long-only (no short selling)
- One position at a time per strategy
- Market-order simulation only (no limit/stop orders in simulation)
- No portfolio-level position sizing across multiple symbols

---

## Performance Metrics

| Metric | Description | Healthy Range |
|---|---|---|
| Total Return | Overall % gain/loss | Positive |
| Annualised Return | Return normalised to 1 year | > 10% |
| Sharpe Ratio | Risk-adjusted return (vs 4% risk-free rate) | > 1.0 |
| Sortino Ratio | Sharpe but only penalises downside volatility | > 1.5 |
| Max Drawdown | Worst peak-to-trough decline | > −20% |
| Calmar Ratio | Annualised return ÷ max drawdown | > 1.0 |
| Profit Factor | Gross profit ÷ gross loss | > 1.5 |
| Win Rate | % of trades that were profitable | > 50% |
| Volatility | Annualised std dev of daily returns | Lower is better |

---

## Known Limitations & Future Work

- **No database persistence** — backtest results and signal history are not stored between server restarts. Adding SQLAlchemy persistence with PostgreSQL is the natural next step.
- **No authentication** — the API has no auth layer. Do not expose the backend port publicly without adding API key or JWT authentication first.
- **Paper trading only validated** — live trading via Alpaca is implemented but has not been extensively tested with real funds. Use with caution.
- **No walk-forward testing** — the backtester uses a simple in-sample test. Walk-forward testing would give more reliable out-of-sample results.
- **No alert system** — signals are generated on request only. A background scheduler (e.g. APScheduler) could run strategies on a cron and push alerts via email or Slack.
