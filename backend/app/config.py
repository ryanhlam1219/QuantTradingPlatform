from pydantic_settings import BaseSettings
from pydantic import ConfigDict
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from backend directory
_backend_dir = Path(__file__).parent.parent
_env_file = _backend_dir / ".env"
if _env_file.exists():
    load_dotenv(_env_file)


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

    # Gemini
    gemini_api_key: Optional[str] = None
    gemini_secret_key: Optional[str] = None

    # Telegram Webhooks (for alerts)
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None

    # Ollama (local LLM for market research)
    # Start with: ollama serve  then  ollama pull llama3
    # Swap model for any you have: mistral, qwen2.5, phi3, etc.
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"

    # App
    app_env: str = "development"
    app_name: str = "Trading Platform"
    app_version: str = "1.0.0"

    model_config = ConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore"  # Ignore extra fields from .env (e.g., VITE_* from frontend)
    )


settings = Settings()
