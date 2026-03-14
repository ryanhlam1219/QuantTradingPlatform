"""
Unit tests for AlpacaExecutor.
Tests execution logic, position sizing, and safety guards with mocked broker.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

from app.execution.alpaca_executor import AlpacaExecutor
from app.brokers.alpaca import Position, AccountInfo
from app.models.trade import TradeSignal, OrderSide, OrderResult, OrderType
from app.models.candlestick import AssetClass
from app.config import settings


@pytest.fixture
def mock_broker():
    """Create a mocked broker."""
    broker = AsyncMock()
    broker.is_market_open = AsyncMock(return_value=True)
    broker.get_account_cash = AsyncMock(return_value=50000.0)
    broker.get_account_info = AsyncMock(
        return_value=AccountInfo(
            buying_power=50000.0, portfolio_value=150000.0, cash=50000.0
        )
    )
    broker.get_positions = AsyncMock(return_value=[])
    broker.submit_order = AsyncMock()
    return broker


@pytest.fixture
def executor(mock_broker):
    """Create an executor with mocked broker."""
    return AlpacaExecutor(broker=mock_broker)


@pytest.fixture
def buy_signal():
    """Create a buy signal."""
    return TradeSignal(
        symbol="AAPL",
        side=OrderSide.BUY,
        strategy_name="ma_crossover",
        confidence=0.85,
        reason="50MA crossed above 200MA",
        timestamp=datetime.now(timezone.utc),
        metadata={"close": 150.0, "ma50": 149.5, "ma200": 148.0},
    )


@pytest.fixture
def sell_signal():
    """Create a sell signal."""
    return TradeSignal(
        symbol="AAPL",
        side=OrderSide.SELL,
        strategy_name="ma_crossover",
        confidence=0.75,
        reason="50MA crossed below 200MA",
        timestamp=datetime.now(timezone.utc),
        metadata={"close": 150.0, "ma50": 149.5, "ma200": 150.5},
    )


def test_is_paper_trading(executor):
    """Test is_paper property reflects config."""
    assert executor.is_paper == settings.paper_trading


@pytest.mark.asyncio
async def test_get_account_success(executor, mock_broker):
    """Test get_account returns account info."""
    result = await executor.get_account()

    assert result["buying_power"] == 50000.0
    assert result["portfolio_value"] == 150000.0
    assert result["cash"] == 50000.0
    mock_broker.get_account_info.assert_called_once()


@pytest.mark.asyncio
async def test_get_account_error_handling(executor, mock_broker):
    """Test get_account handles broker errors."""
    mock_broker.get_account_info.side_effect = Exception("API error")

    with pytest.raises(Exception) as exc_info:
        await executor.get_account()
    assert "API error" in str(exc_info.value)


@pytest.mark.asyncio
async def test_place_order_buy(executor, mock_broker, buy_signal):
    """Test placing a buy order."""
    mock_broker.submit_order.return_value = MagicMock(
        id="order-123", status="pending_new", symbol="AAPL", qty=100
    )

    result = await executor.place_order(
        symbol="AAPL", qty=100, side="buy", order_type="market"
    )

    assert result["id"] == "order-123"
    assert result["status"] == "pending_new"
    assert result["symbol"] == "AAPL"
    mock_broker.submit_order.assert_called_once()


@pytest.mark.asyncio
async def test_place_order_sell(executor, mock_broker):
    """Test placing a sell order."""
    mock_broker.submit_order.return_value = MagicMock(
        id="order-124", status="pending_new", symbol="AAPL", qty=50
    )

    result = await executor.place_order(
        symbol="AAPL", qty=50, side="sell", order_type="market"
    )

    assert result["symbol"] == "AAPL"
    assert result["qty"] == 50
    call_args = mock_broker.submit_order.call_args
    order = call_args[0][0]
    assert order.side == OrderSide.SELL


@pytest.mark.asyncio
async def test_execute_signal_buy_success(executor, mock_broker, buy_signal):
    """Test successful buy signal execution."""
    mock_broker.get_positions.return_value = []
    mock_broker.submit_order.return_value = MagicMock(
        id="order-123", status="filled"
    )

    result = await executor.execute_signal(buy_signal, asset_class=AssetClass.STOCK)

    assert result is not None
    assert result.status == "filled"
    mock_broker.is_market_open.assert_called_once()
    mock_broker.get_account_cash.assert_called_once()
    mock_broker.submit_order.assert_called_once()


@pytest.mark.asyncio
async def test_execute_signal_market_closed(executor, mock_broker, buy_signal):
    """Test signal skipped when market is closed."""
    mock_broker.is_market_open.return_value = False

    result = await executor.execute_signal(buy_signal, asset_class=AssetClass.STOCK)

    assert result is None
    mock_broker.is_market_open.assert_called_once()
    mock_broker.submit_order.assert_not_called()


@pytest.mark.asyncio
async def test_execute_signal_crypto_no_market_check(executor, mock_broker, buy_signal):
    """Test signal crypto doesn't require market hours check."""
    buy_signal.symbol = "BTC/USD"
    mock_broker.submit_order.return_value = MagicMock(
        id="order-999", status="filled"
    )

    result = await executor.execute_signal(buy_signal, asset_class=AssetClass.CRYPTO)

    # Should not check is_market_open for crypto
    mock_broker.is_market_open.assert_not_called()
    assert result is not None


@pytest.mark.asyncio
async def test_execute_signal_cooldown_deduplication(executor, mock_broker, buy_signal):
    """Test signal cooldown prevents duplicate trades."""
    mock_broker.get_positions.return_value = []
    mock_broker.submit_order.return_value = MagicMock(
        id="order-1", status="filled"
    )

    # Execute first signal
    result1 = await executor.execute_signal(buy_signal)
    assert result1 is not None

    # Try to execute same signal immediately
    result2 = await executor.execute_signal(buy_signal)
    assert result2 is None  # Skipped due to cooldown

    # Only one order should have been submitted
    assert mock_broker.submit_order.call_count == 1


@pytest.mark.asyncio
async def test_execute_signal_buy_already_holding(
    executor, mock_broker, buy_signal
):
    """Test buy signal skipped if already holding position."""
    existing_position = Position(
        symbol="AAPL",
        quantity=100.0,
        avg_fill_price=148.0,
        current_price=150.0,
        side="long",
    )
    mock_broker.get_positions.return_value = [existing_position]

    result = await executor.execute_signal(buy_signal)

    assert result is None
    mock_broker.submit_order.assert_not_called()


@pytest.mark.asyncio
async def test_execute_signal_sell_no_position(executor, mock_broker, sell_signal):
    """Test sell signal skipped if no position to sell."""
    mock_broker.get_positions.return_value = []

    result = await executor.execute_signal(sell_signal)

    assert result is None
    mock_broker.submit_order.assert_not_called()


@pytest.mark.asyncio
async def test_execute_signal_sell_success(executor, mock_broker, sell_signal):
    """Test successful sell signal execution."""
    existing_position = Position(
        symbol="AAPL",
        quantity=100.0,
        avg_fill_price=148.0,
        current_price=150.0,
        side="long",
    )
    mock_broker.get_positions.return_value = [existing_position]
    mock_broker.submit_order.return_value = MagicMock(status="filled")

    result = await executor.execute_signal(sell_signal)

    assert result is not None
    # Should sell entire position
    call_args = mock_broker.submit_order.call_args
    order = call_args[0][0]
    assert order.quantity == 100.0
    assert order.side == OrderSide.SELL


@pytest.mark.asyncio
async def test_execute_signal_position_sizing(executor, mock_broker, buy_signal):
    """Test position sizing calculations."""
    mock_broker.get_account_cash.return_value = 10000.0  # Lower cash
    mock_broker.get_positions.return_value = []
    mock_broker.submit_order.return_value = MagicMock(status="filled")

    result = await executor.execute_signal(
        buy_signal, position_size_pct=0.20
    )  # 20% of cash

    assert result is not None
    call_args = mock_broker.submit_order.call_args
    order = call_args[0][0]
    # Should buy approximately 10000 * 0.20 / 150 ≈ 13 shares
    assert 13 <= order.quantity <= 14


@pytest.mark.asyncio
async def test_execute_signal_no_price_metadata(executor, mock_broker, buy_signal):
    """Test signal skipped when price missing from metadata."""
    buy_signal.metadata = {}  # No price data
    mock_broker.get_positions.return_value = []

    result = await executor.execute_signal(buy_signal)

    assert result is None
    mock_broker.submit_order.assert_not_called()


@pytest.mark.asyncio
async def test_execute_signal_order_submission_failure(
    executor, mock_broker, buy_signal
):
    """Test order submission failure is handled."""
    mock_broker.get_positions.return_value = []
    mock_broker.submit_order.side_effect = Exception("Order submission failed")

    with pytest.raises(Exception) as exc_info:
        await executor.execute_signal(buy_signal)
    assert "Order submission failed" in str(exc_info.value)


def test_executor_paper_trading_guard():
    """Test executor respects paper_trading config."""
    executor = AlpacaExecutor()
    assert executor.is_paper == settings.paper_trading


@pytest.mark.asyncio
async def test_execute_signal_updates_cooldown(executor, mock_broker, buy_signal):
    """Test successful execution updates signal cooldown."""
    mock_broker.get_positions.return_value = []
    mock_broker.submit_order.return_value = MagicMock(status="filled")

    # Execute signal
    await executor.execute_signal(buy_signal)

    # Check that cooldown was recorded
    assert "AAPL" in executor._recent_signals
    assert executor._recent_signals["AAPL"] is not None


@pytest.mark.asyncio
async def test_different_symbols_bypass_cooldown(executor, mock_broker):
    """Test cooldown only applies to same symbol."""
    signal_aapl = TradeSignal(
        symbol="AAPL",
        side=OrderSide.BUY,
        strategy_name="test",
        confidence=0.9,
        reason="test",
        timestamp=datetime.now(timezone.utc),
        metadata={"close": 150.0},
    )
    signal_googl = TradeSignal(
        symbol="GOOGL",
        side=OrderSide.BUY,
        strategy_name="test",
        confidence=0.9,
        reason="test",
        timestamp=datetime.now(timezone.utc),
        metadata={"close": 140.0},
    )

    mock_broker.get_positions.return_value = []
    mock_broker.submit_order.return_value = MagicMock(status="filled")

    # Execute AAPL signal
    result1 = await executor.execute_signal(signal_aapl)
    assert result1 is not None

    # Execute GOOGL signal immediately (different symbol, no cooldown)
    result2 = await executor.execute_signal(signal_googl)
    assert result2 is not None

    # Both orders submitted
    assert mock_broker.submit_order.call_count == 2
