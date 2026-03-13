"""
Risk Management API routes.

POST /risk/position-size   — Fixed-fractional + Kelly position sizing
POST /risk/portfolio       — Full portfolio risk report (VaR, CVaR, correlation, sectors)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.risk_manager import (
    fixed_fractional_size,
    kelly_fraction,
    portfolio_risk_report,
)

router = APIRouter(prefix="/risk", tags=["Risk"])


class PositionSizeRequest(BaseModel):
    capital:            float           # total account capital ($)
    entry_price:        float           # planned entry price
    stop_loss_pct:      float           # e.g. 0.05 = 5% below entry
    risk_per_trade_pct: float = 0.02    # fraction of capital to risk (e.g. 0.02 = 2%)
    # optional Kelly inputs
    win_rate:           Optional[float] = None
    avg_win_pct:        Optional[float] = None
    avg_loss_pct:       Optional[float] = None


class HoldingItem(BaseModel):
    symbol:      str
    qty:         float
    entry_price: float


class PortfolioRiskRequest(BaseModel):
    holdings:     list[HoldingItem]
    lookback_days: int = 252


@router.post("/position-size")
async def calc_position_size(req: PositionSizeRequest):
    """
    Calculate position size using fixed-fractional sizing.
    Optionally returns a Kelly-criterion suggestion if win_rate/avg_win/avg_loss provided.
    """
    if req.capital <= 0:
        raise HTTPException(status_code=400, detail="capital must be positive.")
    if req.entry_price <= 0:
        raise HTTPException(status_code=400, detail="entry_price must be positive.")
    if not (0 < req.stop_loss_pct < 1):
        raise HTTPException(status_code=400, detail="stop_loss_pct must be between 0 and 1.")
    if not (0 < req.risk_per_trade_pct < 1):
        raise HTTPException(status_code=400, detail="risk_per_trade_pct must be between 0 and 1.")

    ff = fixed_fractional_size(
        capital=req.capital,
        price=req.entry_price,
        stop_loss_pct=req.stop_loss_pct,
        risk_per_trade_pct=req.risk_per_trade_pct,
    )

    kelly = None
    if req.win_rate is not None and req.avg_win_pct is not None and req.avg_loss_pct is not None:
        kf = kelly_fraction(req.win_rate, req.avg_win_pct, req.avg_loss_pct)
        ks = fixed_fractional_size(
            capital=req.capital,
            price=req.entry_price,
            stop_loss_pct=req.stop_loss_pct,
            risk_per_trade_pct=kf,
        )
        kelly = {"fraction": kf, **ks}

    return {
        "fixed_fractional": ff,
        "kelly":            kelly,
        "inputs": {
            "capital":            req.capital,
            "entry_price":        req.entry_price,
            "stop_loss_pct":      req.stop_loss_pct,
            "risk_per_trade_pct": req.risk_per_trade_pct,
        },
    }


@router.post("/portfolio")
async def portfolio_risk(req: PortfolioRiskRequest):
    """
    Full portfolio risk report.
    Fetches historical candles for each holding and returns:
      P&L per position, historical VaR (95%/99%), CVaR, max drawdown,
      Sharpe ratio, concentration, sector exposure, correlation matrix,
      and high-correlation pair warnings.
    """
    if not req.holdings:
        raise HTTPException(status_code=400, detail="Provide at least one holding.")
    if len(req.holdings) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 holdings.")
    if req.lookback_days < 30:
        raise HTTPException(status_code=400, detail="lookback_days must be >= 30.")

    report = await portfolio_risk_report(
        holdings=[h.dict() for h in req.holdings],
        lookback_days=min(req.lookback_days, 756),
    )

    if report.get("error") and not report.get("positions"):
        raise HTTPException(status_code=502, detail=report["error"])

    return report
