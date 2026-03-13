"""
Integration tests.

These tests hit real or mocked external services.
Mark with @pytest.mark.integration so they can be run separately:
  pytest tests/integration -m integration

Live Alpaca tests require ALPACA_API_KEY and ALPACA_SECRET_KEY env vars.
The default is to use mocks so the CI pipeline doesn't need credentials.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.models.candlestick import Broker, TimeFrame, AssetClass
from tests.conftest import make_series


pytestmark = pytest.mark.asyncio


# ================================================================== #
# FastAPI App — health endpoints
# ================================================================== #

class TestHealthEndpoints:

    async def test_health_returns_200(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/health/")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    async def test_health_has_timestamp(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/health/")
        assert "timestamp" in resp.json()


# ================================================================== #
# FastAPI App — strategies endpoint
# ================================================================== #

class TestStrategiesEndpoint:

    async def test_list_strategies_returns_all_five(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/strategies/")
        assert resp.status_code == 200
        names = {s["name"] for s in resp.json()}
        assert {"moving_average_crossover", "rsi", "bollinger_bands", "macd", "grid_trading"} == names

    async def test_get_single_strategy(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/strategies/rsi")
        assert resp.status_code == 200
        assert resp.json()["name"] == "rsi"

    async def test_unknown_strategy_returns_404(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/strategies/doesnotexist")
        assert resp.status_code == 404


# ================================================================== #
# FastAPI App — backtest endpoint (mocked broker)
# ================================================================== #

class TestBacktestEndpoint:

    @pytest.fixture
    def mock_candle_series(self):
        import math
        closes = [100 + 10 * math.sin(i * 0.1) for i in range(200)]
        return make_series(closes, symbol="AAPL")

    async def test_backtest_run_returns_result(self, mock_candle_series):
        with patch("app.api.routes.candlesticks._get_broker") as mock_get_broker:
            mock_broker = MagicMock()
            mock_broker.get_candles = AsyncMock(return_value=mock_candle_series)
            mock_get_broker.return_value = mock_broker

            payload = {
                "symbol": "AAPL",
                "broker": "mock",
                "timeframe": "1d",
                "strategy_name": "rsi",
                "strategy_params": {"period": 14},
                "start_date": "2020-01-01T00:00:00Z",
                "end_date": "2021-01-01T00:00:00Z",
                "initial_capital": 10000.0,
                "position_size_pct": 0.10,
                "commission_pct": 0.001,
            }
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.post("/api/v1/backtest/run", json=payload)

        assert resp.status_code == 200
        data = resp.json()
        assert "metrics" in data
        assert "equity_curve" in data
        assert "trades" in data

    async def test_backtest_invalid_strategy_returns_400(self):
        payload = {
            "symbol": "AAPL",
            "broker": "alpaca",
            "timeframe": "1d",
            "strategy_name": "definitely_not_real",
            "start_date": "2020-01-01T00:00:00Z",
            "end_date": "2021-01-01T00:00:00Z",
            "initial_capital": 10000.0,
        }
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/v1/backtest/run", json=payload)
        assert resp.status_code == 400


# ================================================================== #
# Alpaca broker (mocked SDK)
# ================================================================== #

class TestAlpacaBrokerMocked:

    @pytest.mark.integration
    async def test_get_candles_returns_series(self):
        """Test Alpaca broker with mocked SDK responses."""
        import pandas as pd
        from app.brokers.alpaca import AlpacaBroker

        mock_df = pd.DataFrame({
            "open":   [150.0, 151.0, 152.0],
            "high":   [155.0, 156.0, 157.0],
            "low":    [149.0, 150.0, 151.0],
            "close":  [153.0, 154.0, 155.0],
            "volume": [1e6, 1.1e6, 1.2e6],
            "vwap":   [152.0, 153.0, 154.0],
            "trade_count": [5000, 5100, 5200],
        }, index=pd.date_range("2021-01-01", periods=3, freq="D", tz="UTC"))

        with patch("app.brokers.alpaca.StockHistoricalDataClient") as mock_stock:
            with patch("app.brokers.alpaca.TradingClient"):
                with patch("app.brokers.alpaca.CryptoHistoricalDataClient"):
                    mock_stock.return_value.get_stock_bars.return_value.df = mock_df
                    broker = AlpacaBroker()
                    series = await broker.get_candles(
                        symbol="AAPL",
                        timeframe=TimeFrame.ONE_DAY,
                        start=datetime(2021, 1, 1, tzinfo=timezone.utc),
                        end=datetime(2021, 1, 3, tzinfo=timezone.utc),
                    )

        assert len(series.candles) == 3
        assert series.candles[0].close == 153.0
        assert series.broker == Broker.ALPACA
