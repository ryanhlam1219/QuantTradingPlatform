from app.algorithms.moving_average import MovingAverageCrossover
from app.algorithms.rsi import RSIStrategy
from app.algorithms.bollinger_bands import BollingerBandsStrategy
from app.algorithms.macd import MACDStrategy
from app.algorithms.grid_trading import GridTradingStrategy

STRATEGY_REGISTRY = {
    "moving_average_crossover": MovingAverageCrossover,
    "rsi": RSIStrategy,
    "bollinger_bands": BollingerBandsStrategy,
    "macd": MACDStrategy,
    "grid_trading": GridTradingStrategy,
}

def get_strategy(name: str, params: dict = None):
    cls = STRATEGY_REGISTRY.get(name)
    if not cls:
        raise ValueError(f"Unknown strategy: {name}. Available: {list(STRATEGY_REGISTRY.keys())}")
    return cls(params)

def list_strategies() -> list[dict]:
    return [cls().describe() for cls in STRATEGY_REGISTRY.values()]
