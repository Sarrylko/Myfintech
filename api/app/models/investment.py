import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (
        UniqueConstraint("account_id", "ticker_symbol", name="uq_holdings_account_ticker"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), index=True
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    security_id: Mapped[str | None] = mapped_column(String(255))
    ticker_symbol: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(255))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    cost_basis: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    current_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency_code: Mapped[str] = mapped_column(String(3), default="USD")
    asset_class: Mapped[str | None] = mapped_column(String(20), index=True)
    coingecko_id: Mapped[str | None] = mapped_column(String(100))
    previous_close: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    as_of_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class InvestmentTransaction(Base):
    __tablename__ = "investment_transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), index=True
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    plaid_investment_transaction_id: Mapped[str | None] = mapped_column(
        String(255), unique=True
    )
    security_id: Mapped[str | None] = mapped_column(String(255))
    ticker_symbol: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(500))
    type: Mapped[str] = mapped_column(String(50))  # buy, sell, dividend, etc.
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 8))
    price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    fees: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    currency_code: Mapped[str] = mapped_column(String(3), default="USD")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class InvestmentValueSnapshot(Base):
    """One row per investment account per day, written by the daily net worth
    snapshot task. The value history behind contributions-vs-growth and
    time-weighted returns; external cash flows are read from
    investment_transactions at query time, since Plaid delivers them late."""
    __tablename__ = "investment_value_snapshots"
    __table_args__ = (
        UniqueConstraint("account_id", "snapshot_date", name="uq_investment_value_snapshots_account_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    market_value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    # Sum of holdings' cost basis; NULL when no holding has one
    cost_basis: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency_code: Mapped[str] = mapped_column(String(3), default="USD")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class HoldingValueSnapshot(Base):
    """One row per holding per day, written alongside InvestmentValueSnapshot.
    Keeps the raw security fields rather than an allocation bucket, because
    buckets are classified in the frontend from asset_class, ticker and name;
    storing the inputs lets history be reclassified when that logic changes.
    No holding_id: SnapTrade re-creates holdings on every sync, so a position
    is followed across days by account_id + ticker_symbol (or name)."""
    __tablename__ = "holding_value_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    ticker_symbol: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(255))
    asset_class: Mapped[str | None] = mapped_column(String(20))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    market_value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    cost_basis: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency_code: Mapped[str] = mapped_column(String(3), default="USD")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
