"""
Unit tests for AlpacaBroker data structures and logic.
HTTP-based async tests are covered in integration tests.
"""
import pytest
from app.brokers.alpaca import AlpacaBroker, AccountInfo, Position
from app.models.candlestick import Timeframe
from app.models.trade import Order, OrderType, OrderSide
from app.config import settings


@pytest.fixture
def broker():
    """Create a broker instance for testing."""
    return AlpacaBroker()


def test_broker_initialization(broker):
    """Test broker initializes with correct config."""
    assert broker.headers["APCA-API-KEY-ID"] == settings.alpaca_api_key
    assert broker.headers["APCA-API-SECRET-KEY"] == settings.alpaca_secret_key
    assert broker.data_feed in ["iex", "sip"]


def test_timeframe_mapping(broker):
    """Test TimeFrame to Alpaca string mapping."""
    assert broker._map_timeframe(Timeframe.M1) == "1Min"
    assert broker._map_timeframe(Timeframe.M5) == "5Min"
    assert broker._map_timeframe(Timeframe.H1) == "1Hour"
    assert broker._map_timeframe(Timeframe.D1) == "1Day"
    assert broker._map_timeframe(Timeframe.W1) == "1Week"


def test_is_crypto_detection(broker):
    """Test crypto asset detection logic."""
    # Crypto symbols contain / or are long USD codes
    assert broker._is_crypto("BTC/USD") is True
    assert broker._is_crypto("ETH/USD") is True
    assert broker._is_crypto("AAPL") is False
    assert broker._is_crypto("GOOGL") is False


def test_account_info_structure():
    """Test AccountInfo dataclass."""
    acct = AccountInfo(
        buying_power=50000.0, portfolio_value=150000.0, cash=75000.0
    )
    assert acct.buying_power == 50000.0
    assert acct.portfolio_value == 150000.0
    assert acct.cash == 75000.0


def test_position_structure():
    """Test Position dataclass."""
    pos = Position(
        symbol="AAPL",
        quantity=100.0,
        avg_fill_price=150.25,
        current_price=152.50,
        side="long",
    )
    assert pos.symbol == "AAPL"
    assert pos.quantity == 100.0
    assert pos.side == "long"


def test_position_side_long():
    """Test Position records long positions correctly."""
    pos = Position(
        symbol="AAPL",
        quantity=100.0,
        avg_fill_price=150.0,
        current_price=152.0,
        side="long",
    )
    assert pos.side == "long"


def test_position_side_short():
    """Test Position records short positions correctly."""
    pos = Position(
        symbol="AAPL",
        quantity=-50.0,
        avg_fill_price=150.0,
        current_price=152.0,
        side="short",
    )
    assert pos.side == "short"


def test_broker_headers_structure(broker):
    """Test broker sets correct headers for Alpaca API calls."""
    headers = broker.headers
    assert "APCA-API-KEY-ID" in headers
    assert "APCA-API-SECRET-KEY" in headers


def test_buy_order_structure():
    """Test Order structure for buy orders."""
    order = Order(
        symbol="AAPL",
        side=OrderSide.BUY,
        order_type=OrderType.MARKET,
        quantity=100.0,
        strategy_name="test_strategy",
        paper=True,
    )

    assert order.symbol == "AAPL"
    assert order.side == OrderSide.BUY
    assert order.order_type == OrderType.MARKET
    assert order.quantity == 100.0
    assert order.strategy_name == "test_strategy"
    assert order.paper is True
    assert order.side.value.lower() == "buy"


def test_sell_order_structure():
    """Test Order structure for sell orders."""
    order = Order(
        symbol="AAPL",
        side=OrderSide.SELL,
        order_type=OrderType.MARKET,
        quantity=50.0,
        strategy_name="test_strategy",
        paper=True,
    )

    assert order.symbol == "AAPL"
    assert order.side == OrderSide.SELL
    assert order.quantity == 50.0
    assert order.side.value.lower() == "sell"


def test_crypto_order():
    """Test Order works with crypto symbols."""
    order = Order(
        symbol="BTC/USD",
        side=OrderSide.BUY,
        order_type=OrderType.MARKET,
        quantity=0.5,
        strategy_name="crypto_strategy",
        paper=True,
    )

    assert order.symbol == "BTC/USD"
    assert order.quantity == 0.5
    assert order.side == OrderSide.BUY
