from app.brokers.alpaca import AlpacaBroker
from app.brokers.kraken import KrakenBroker
from app.brokers.binance_us import BinanceUSBroker
from app.models.candlestick import Broker

BROKER_REGISTRY = {
    Broker.ALPACA: AlpacaBroker,
    Broker.KRAKEN: KrakenBroker,
    Broker.BINANCE_US: BinanceUSBroker,
}

def get_broker(broker: Broker):
    cls = BROKER_REGISTRY.get(broker)
    if not cls:
        raise ValueError(f"Unsupported broker: {broker}")
    return cls()
