from fastapi import APIRouter, HTTPException
from app.models.backtest import BacktestConfig
from app.backtesting import BacktestEngine
from app.brokers import get_broker
from app.algorithms import STRATEGY_REGISTRY

router = APIRouter(prefix="/backtest", tags=["Backtest"])

engine = BacktestEngine()


@router.post("/run")
async def run_backtest(config: BacktestConfig):
    """Run a backtest for a strategy against historical data."""
    if config.strategy not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {config.strategy}")

    try:
        broker = get_broker(config.broker)
        series = await broker.get_candles(
            config.symbol.upper(), config.timeframe, config.start_date, config.end_date, limit=5000
        )
        if len(series.candles) < 50:
            raise HTTPException(status_code=400, detail="Not enough historical data (need at least 50 candles)")

        result = engine.run(config, series)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/compare")
async def compare_strategies(
    symbol: str,
    start_date: str,
    end_date: str,
    initial_capital: float = 10000.0,
    strategies: list[str] = None,
):
    """Run multiple strategies on the same asset and compare performance."""
    from datetime import datetime
    from app.models.candlestick import Timeframe, Broker

    strategies = strategies or list(STRATEGY_REGISTRY.keys())
    start = datetime.fromisoformat(start_date)
    end = datetime.fromisoformat(end_date)

    try:
        series = await get_broker(Broker.ALPACA).get_candles(
            symbol.upper(), Timeframe.D1, start, end, limit=5000
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    results = []
    for strat in strategies:
        if strat not in STRATEGY_REGISTRY:
            continue
        config = BacktestConfig(
            symbol=symbol, strategy=strat,
            start_date=start, end_date=end,
            initial_capital=initial_capital,
        )
        try:
            result = engine.run(config, series)
            results.append({
                "strategy": strat,
                "total_return": result.total_return,
                "annualized_return": result.annualized_return,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown": result.max_drawdown,
                "win_rate": result.win_rate,
                "total_trades": result.total_trades,
                "profit_factor": result.profit_factor,
                "equity_curve": result.equity_curve,
            })
        except Exception as e:
            results.append({"strategy": strat, "error": str(e)})

    return {"symbol": symbol, "period": f"{start_date} to {end_date}", "results": results}


# ── Portfolio Backtest ──────────────────────────────────────────────────────

from pydantic import BaseModel as PydanticModel

class PortfolioBacktestConfig(PydanticModel):
    symbols: list[str]
    strategy: str
    start_date: str          # ISO date string e.g. "2020-01-01"
    end_date: str
    total_capital: float = 10_000.0
    timeframe: str = "1d"
    commission: float = 0.0
    slippage: float = 0.001
    strategy_params: dict = {}


@router.post("/portfolio")
async def portfolio_backtest(config: PortfolioBacktestConfig):
    """Run one strategy across multiple symbols with equal capital allocation.
    
    Returns per-symbol results plus a combined equity curve and aggregate metrics.
    """
    from datetime import datetime
    from app.models.candlestick import Timeframe, Broker

    if config.strategy not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {config.strategy}")

    if not config.symbols:
        raise HTTPException(status_code=400, detail="At least one symbol is required")

    try:
        start = datetime.fromisoformat(config.start_date.replace("Z",""))
        end   = datetime.fromisoformat(config.end_date.replace("Z",""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    # Map timeframe string to enum
    tf_map = {"1d": Timeframe.D1, "1w": Timeframe.W1, "1h": Timeframe.H1, "4h": Timeframe.H4}
    timeframe = tf_map.get(config.timeframe, Timeframe.D1)

    capital_per_symbol = config.total_capital / len(config.symbols)
    broker = get_broker(Broker.ALPACA)
    results = []

    for symbol in config.symbols:
        sym = symbol.upper().strip()
        try:
            series = await broker.get_candles(sym, timeframe, start, end, limit=10000)
            if len(series.candles) < 30:
                results.append({"symbol": sym, "error": f"Not enough data ({len(series.candles)} candles)"})
                continue

            bt_config = BacktestConfig(
                symbol=sym,
                strategy=config.strategy,
                start_date=start,
                end_date=end,
                initial_capital=capital_per_symbol,
                timeframe=timeframe,
                commission=config.commission,
                slippage=config.slippage,
                strategy_params=config.strategy_params,
            )
            result = engine.run(bt_config, series)
            results.append({
                "symbol": sym,
                "total_return":      result.total_return,
                "annualized_return": result.annualized_return,
                "sharpe_ratio":      result.sharpe_ratio,
                "max_drawdown":      result.max_drawdown,
                "win_rate":          result.win_rate,
                "profit_factor":     result.profit_factor,
                "total_trades":      result.total_trades,
                "final_equity":      result.equity_curve[-1]["equity"] if result.equity_curve else capital_per_symbol,
                "equity_curve":      result.equity_curve,
            })
        except Exception as e:
            results.append({"symbol": sym, "error": str(e)})

    # Build combined equity curve by summing equity across all successful symbols per date
    successful = [r for r in results if "error" not in r]
    combined_curve: list[dict] = []
    if successful:
        from collections import defaultdict
        date_equity: dict[str, float] = defaultdict(float)
        date_counts: dict[str, int]   = defaultdict(int)
        for r in successful:
            for point in r["equity_curve"]:
                date_equity[point["timestamp"][:10]] += point["equity"]
                date_counts[point["timestamp"][:10]] += 1
        # Only include dates where all symbols reported
        n_syms = len(successful)
        for date_str in sorted(date_equity.keys()):
            if date_counts[date_str] == n_syms:
                combined_curve.append({"timestamp": date_str + "T00:00:00", "equity": round(date_equity[date_str], 2)})

    # Aggregate metrics
    if successful:
        avg_return   = sum(r["total_return"]      for r in successful) / len(successful)
        avg_sharpe   = sum(r["sharpe_ratio"]       for r in successful) / len(successful)
        avg_drawdown = sum(r["max_drawdown"]       for r in successful) / len(successful)
        total_final  = sum(r["final_equity"]       for r in successful)
        portfolio_return = (total_final - config.total_capital) / config.total_capital
    else:
        avg_return = avg_sharpe = avg_drawdown = portfolio_return = 0.0
        total_final = config.total_capital

    return {
        "strategy":          config.strategy,
        "symbols":           config.symbols,
        "period":            f"{config.start_date} to {config.end_date}",
        "total_capital":     config.total_capital,
        "capital_per_symbol": capital_per_symbol,
        "results":           results,
        "combined_equity_curve": combined_curve,
        "portfolio_return":  round(portfolio_return, 6),
        "avg_symbol_return": round(avg_return, 6),
        "avg_sharpe_ratio":  round(avg_sharpe, 4),
        "avg_max_drawdown":  round(avg_drawdown, 6),
        "final_portfolio_value": round(total_final, 2),
    }
