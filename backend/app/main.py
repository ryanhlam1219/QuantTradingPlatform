"""
Trading Platform - FastAPI Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes import health, market_data, algorithms, backtest, trades

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Algorithmic trading platform with backtesting, multi-broker support, and live execution.",
    docs_url="/docs",
    redoc_url="/redoc",
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


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "paper_trading": settings.paper_trading,
        "env": settings.app_env,
    }
