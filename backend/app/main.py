"""
Trading Platform - FastAPI Application
"""
import logging
import logging.handlers
import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes import health, market_data, algorithms, backtest, trades, screener, research, portfolio, autotrader, risk
from app.api.routes import cycles, admin
from app.services.cycle_manager import cycle_manager

# ── File logging ─────────────────────────────────────────────────────────────
_LOG_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "logs")
_LOG_DIR = os.path.normpath(_LOG_DIR)
os.makedirs(_LOG_DIR, exist_ok=True)
APP_LOG_FILE = os.path.join(_LOG_DIR, "app.log")

_file_handler = logging.handlers.RotatingFileHandler(
    APP_LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))

# Attach to root so every logger in the app writes to the file
logging.getLogger().setLevel(logging.DEBUG)
logging.getLogger().addHandler(_file_handler)

# Keep uvicorn / httpx noise at INFO in the file; DEBUG for our own services
logging.getLogger("uvicorn").setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.INFO)
logging.getLogger("httpcore").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log = logging.getLogger("startup")

    # ── Banner ──────────────────────────────────────────────────────────────
    log.info("=" * 64)
    log.info("  QuantEdge Trading Platform — starting up")
    log.info("  Python  : %s", sys.version.split()[0])
    log.info("  PID     : %d", os.getpid())
    log.info("  CWD     : %s", os.getcwd())
    log.info("  Log file: %s", APP_LOG_FILE)
    log.info("=" * 64)

    # ── Config validation ───────────────────────────────────────────────────
    log.info("[config] app_name=%s  version=%s  env=%s",
             settings.app_name, settings.app_version, settings.app_env)
    log.info("[config] paper_trading=%s  data_feed=%s", settings.paper_trading, settings.alpaca_data_feed)
    log.info("[config] alpaca_base_url=%s", settings.alpaca_base_url)

    key_ok  = settings.alpaca_api_key  not in ("", "demo", None)
    sec_ok  = settings.alpaca_secret_key not in ("", "demo", None)
    if key_ok and sec_ok:
        log.info("[config] Alpaca credentials: SET (key=...%s)", settings.alpaca_api_key[-4:])
    else:
        log.warning("[config] Alpaca credentials MISSING or demo — market data and order execution will fail.")
        log.warning("[config] Set ALPACA_API_KEY and ALPACA_SECRET_KEY in backend/.env")

    log.info("[config] ollama_url=%s  model=%s", settings.ollama_url, settings.ollama_model)

    # ── Optional dependency probes (non-blocking) ───────────────────────────
    import httpx, asyncio

    async def _probe(name: str, url: str, timeout: float = 3.0) -> bool:
        try:
            async with httpx.AsyncClient(timeout=timeout) as c:
                r = await c.get(url)
                log.info("[probe] %-12s reachable  (%s → HTTP %d)", name, url, r.status_code)
                return True
        except httpx.ConnectError:
            log.warning("[probe] %-12s UNREACHABLE (%s) — features depending on this will be degraded", name, url)
        except Exception as e:
            log.warning("[probe] %-12s error: %s", name, e)
        return False

    probes = [
        _probe("Alpaca API",  f"{settings.alpaca_base_url}/v2/clock"),
        _probe("Ollama",      f"{settings.ollama_url}/api/tags"),
    ]
    await asyncio.gather(*probes)

    # ── Routes registered ───────────────────────────────────────────────────
    route_paths = sorted({r.path for r in app.routes})
    log.info("[routes] %d routes registered", len(route_paths))
    for p in route_paths:
        log.debug("[routes]   %s", p)

    # ── Cycle manager startup ───────────────────────────────────────────────
    try:
        log.info("[cycles] Starting cycle manager…")
        await cycle_manager.startup()
        log.info("[cycles] Cycle manager started OK")
    except Exception as exc:
        log.error("[cycles] Cycle manager startup FAILED: %s", exc, exc_info=True)

    log.info("[startup] ✓ Server ready on http://0.0.0.0:8000")
    log.info("=" * 64)

    yield

    # ── Shutdown ────────────────────────────────────────────────────────────
    log.info("[shutdown] Stopping cycle manager…")
    try:
        await cycle_manager.shutdown()
        log.info("[shutdown] Cycle manager stopped OK")
    except Exception as exc:
        log.error("[shutdown] Cycle manager shutdown error: %s", exc)
    log.info("[shutdown] Server stopped.")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Algorithmic trading platform with backtesting, multi-broker support, and live execution.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(market_data.router)
app.include_router(algorithms.router)
app.include_router(backtest.router)
app.include_router(trades.router)
app.include_router(screener.router)
app.include_router(research.router)
app.include_router(portfolio.router)
app.include_router(autotrader.router)
app.include_router(cycles.router)
app.include_router(admin.router)
app.include_router(risk.router)


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "paper_trading": settings.paper_trading,
        "env": settings.app_env,
    }
