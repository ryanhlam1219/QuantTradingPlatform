# app/observability/ — Logging & Metrics
**Roadmap Phase: p6 (Structured Logging) + p7 (Monitoring)**

## Sub-directories

### logging/
Structured logging configuration and log group definitions.
- `config.py`     — central logging setup, LogGroup enum, get_logger() factory — **p6t1**
- `research.py`   — Research log group instrumentation — **p6t2**
- `alpha.py`      — Alpha scoring log group (composite scorer funnel) — **p6t3**
- `execution.py`  — Execution log group (orders, fills, slippage) — **p6t4**
- `autotrader.py` — AutoTrader job lifecycle log group (job_id correlation) — **p6t5**
- `api.py`        — API request/response + Alpaca connectivity log group — **p6t6**

Logs write to `logs/<group>.log` with daily rotation and 30-day retention. — **p6t7**

### metrics/
Prometheus metrics registry and custom metric definitions.
- `registry.py`   — central prometheus_client metrics registry — **p7t1**
- `middleware.py` — FastAPI prometheus-fastapi-instrumentator setup — **p7t1**

Expose `/metrics` endpoint. Scraped by Prometheus every 15s. — **p7t1/p7t2**
