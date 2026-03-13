"""
Integration tests for FastAPI endpoints.
Uses TestClient to test without external broker connections.
"""
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from datetime import datetime, timezone, timedelta
from app.main import app
from app.models.candlestick import CandleSeries, Timeframe, Broker
from tests.conftest import make_candle
import math


@pytest.fixture
def client():
    return TestClient(app)


def mock_series(symbol="AAPL", n=300):
    base = datetime(2022, 1, 1, tzinfo=timezone.utc)
    candles = [make_candle(100 + 15 * math.sin(i * 0.2), base + timedelta(days=i), symbol) for i in range(n)]
    return CandleSeries(symbol=symbol, timeframe=Timeframe.D1, broker=Broker.MOCK, candles=candles)


class TestHealthEndpoints:
    def test_health_ok(self, client):
        resp = client.get("/health/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data

    def test_root_returns_app_info(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "name" in data
        assert "version" in data


class TestAlgorithmEndpoints:
    def test_list_algorithms(self, client):
        resp = client.get("/algorithms/")
        assert resp.status_code == 200
        data = resp.json()
        assert "strategies" in data
        assert len(data["strategies"]) == 5

    def test_get_algorithm_rsi(self, client):
        resp = client.get("/algorithms/rsi")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "rsi"

    def test_get_unknown_algorithm_404(self, client):
        resp = client.get("/algorithms/unknown_algo_xyz")
        assert resp.status_code == 404

    def test_all_strategy_names_accessible(self, client):
        strategies = ["moving_average_crossover", "rsi", "bollinger_bands", "macd", "grid_trading"]
        for name in strategies:
            resp = client.get(f"/algorithms/{name}")
            assert resp.status_code == 200


class TestBacktestEndpoints:
    def test_run_backtest(self, client):
        with patch("app.api.routes.backtest.get_broker") as mock_get_broker:
            broker = AsyncMock()
            broker.get_candles = AsyncMock(return_value=mock_series())
            mock_get_broker.return_value = broker

            resp = client.post("/backtest/run", json={
                "symbol": "AAPL",
                "strategy": "rsi",
                "start_date": "2022-01-01T00:00:00Z",
                "end_date": "2023-01-01T00:00:00Z",
                "initial_capital": 10000.0,
                "timeframe": "1d",
                "broker": "alpaca",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert "total_return" in data
        assert "sharpe_ratio" in data
        assert "equity_curve" in data

    def test_backtest_unknown_strategy_400(self, client):
        resp = client.post("/backtest/run", json={
            "symbol": "AAPL",
            "strategy": "nonexistent",
            "start_date": "2022-01-01T00:00:00Z",
            "end_date": "2023-01-01T00:00:00Z",
        })
        assert resp.status_code == 400

    def test_compare_strategies(self, client):
        with patch("app.api.routes.backtest.get_broker") as mock_get_broker:
            broker = AsyncMock()
            broker.get_candles = AsyncMock(return_value=mock_series())
            mock_get_broker.return_value = broker

            resp = client.post("/backtest/compare", params={
                "symbol": "AAPL",
                "start_date": "2022-01-01T00:00:00",
                "end_date": "2023-01-01T00:00:00",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data
        assert len(data["results"]) > 0


class TestMarketDataEndpoints:
    def test_get_candles(self, client):
        with patch("app.api.routes.market_data.get_broker") as mock_get_broker:
            broker = AsyncMock()
            broker.get_candles = AsyncMock(return_value=mock_series())
            mock_get_broker.return_value = broker

            resp = client.get("/market-data/candles/AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert data["symbol"] == "AAPL"
        assert "candles" in data
        assert data["count"] > 0
