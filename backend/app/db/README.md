# app/db/ — Database Layer
**Roadmap Phase: p8 (Database Migration)**

## Sub-directories

### repos/
Repository pattern — one file per domain entity:
- `candles.py`    — cache-first OHLCV candle fetch/store (TimescaleDB hypertable) — **p8t4**
- `signals.py`    — signal_outcomes table CRUD + forward-return resolver — **p8t5**
- `fills.py`      — fill_history table (actual execution records) — **p8t5**
- `runs.py`       — AutoTrader job run history with pagination — **p8t6**
- `snapshots.py`  — daily portfolio snapshots — **p8t6**

### migrations/
Alembic version-controlled schema migrations.
Run with: `alembic upgrade head`

## Key files (planned)
- `connection.py`  — async SQLAlchemy engine + session factory (asyncpg) — **p8t3**
- `init.py`        — schema creation on first startup — **p8t3**
- `schema.sql`     — canonical schema reference — **p8t2**

## Investigation
See `backend/docs/database_decision.md` for the DB selection rationale — **p8t1**
