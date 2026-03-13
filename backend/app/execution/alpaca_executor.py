"""
Alpaca Trade Executor.

Converts TradeSignals into orders and submits them via the Alpaca broker.
Includes position sizing, paper/live mode guard, and signal deduplication.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.brokers.alpaca import AlpacaBroker
from app.models.trade import Order, OrderType, OrderSide, TradeSignal, OrderResult
from app.models.candlestick import AssetClass
from app.config import get_settings

log = logging.getLogger(__name__)


class AlpacaExecutor:

    def __init__(self, broker: Optional[AlpacaBroker] = None):
        self._broker = broker or AlpacaBroker()
        self._settings = get_settings()
        self._recent_signals: dict[str, datetime] = {}  # symbol → last signal time
        self._signal_cooldown = timedelta(minutes=5)    # Don't re-signal within 5 min

    @property
    def is_paper(self) -> bool:
        return self._settings.alpaca_paper_trading

    async def execute_signal(
        self,
        signal: TradeSignal,
        asset_class: AssetClass = AssetClass.STOCK,
        position_size_pct: float = 0.10,
    ) -> OrderResult | None:
        """
        Execute a trade signal.

        Returns None if the signal is skipped (market closed, duplicate, etc.).
        """
        symbol = signal.symbol

        # Safety: never execute live trades without explicit opt-in
        if not self.is_paper:
            log.warning("LIVE TRADING MODE — submitting real order for %s", symbol)

        # Deduplication: skip if same symbol was traded recently
        last = self._recent_signals.get(symbol)
        now  = datetime.now(timezone.utc)
        if last and (now - last) < self._signal_cooldown:
            log.info("Signal for %s skipped (cooldown, last=%s)", symbol, last)
            return None

        # Check market hours for stocks
        if asset_class == AssetClass.STOCK:
            if not await self._broker.is_market_open():
                log.info("Signal for %s skipped — market is closed", symbol)
                return None

        # Position sizing
        cash = await self._broker.get_account_cash()
        positions = await self._broker.get_positions()
        existing = next((p for p in positions if p.symbol == symbol), None)

        if signal.side == OrderSide.BUY and existing:
            log.info("Signal BUY %s skipped — already holding position", symbol)
            return None

        if signal.side == OrderSide.SELL and not existing:
            log.info("Signal SELL %s skipped — no position to sell", symbol)
            return None

        if signal.side == OrderSide.BUY:
            trade_value = cash * position_size_pct
            # Estimate qty from signal metadata or latest price
            latest_price = signal.metadata.get("close", None)
            if not latest_price:
                log.warning("No price in signal metadata for %s, cannot size order", symbol)
                return None
            qty = trade_value / latest_price
        else:
            # Sell entire position
            qty = existing.quantity

        if qty <= 0:
            return None

        order = Order(
            symbol=symbol,
            side=signal.side,
            order_type=OrderType.MARKET,
            quantity=round(qty, 6),
            strategy_name=signal.strategy_name,
            paper=self.is_paper,
        )

        try:
            result = await self._broker.submit_order(order)
            self._recent_signals[symbol] = now
            log.info(
                "Order submitted: %s %s %s qty=%.4f [%s]",
                result.status, order.side.value, symbol, qty,
                "PAPER" if self.is_paper else "LIVE",
            )
            return result
        except Exception as exc:
            log.error("Order submission failed for %s: %s", symbol, exc)
            raise
