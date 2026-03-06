from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Alpaca
    alpaca_api_key: str = "demo"
    alpaca_secret_key: str = "demo"
    alpaca_base_url: str = "https://paper-api.alpaca.markets"
    paper_trading: bool = True
    # "iex" = free/paper accounts  |  "sip" = paid subscription (full market data)
    alpaca_data_feed: str = "iex"

    # Database
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/trading_db"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Kraken
    kraken_api_key: Optional[str] = None
    kraken_secret_key: Optional[str] = None

    # Binance.US
    binance_api_key: Optional[str] = None
    binance_secret_key: Optional[str] = None

    # App
    app_env: str = "development"
    app_name: str = "Trading Platform"
    app_version: str = "1.0.0"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
