from fastapi import APIRouter
from datetime import datetime, timezone
from app.config import settings
from app.brokers import get_broker
from app.models.candlestick import Broker

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("/")
async def health():
    """Basic health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat(), "version": settings.app_version}


@router.get("/ready")
async def readiness():
    """Readiness check — verifies broker connectivity."""
    broker_status = {}
    for broker_name in [Broker.ALPACA]:
        try:
            broker = get_broker(broker_name)
            ok = await broker.health_check()
            broker_status[broker_name] = "ok" if ok else "unreachable"
        except Exception as e:
            broker_status[broker_name] = f"error: {str(e)}"

    all_ok = all(v == "ok" for v in broker_status.values())
    return {
        "status": "ready" if all_ok else "degraded",
        "brokers": broker_status,
        "paper_trading": settings.paper_trading,
    }
