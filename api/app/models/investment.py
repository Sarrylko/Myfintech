import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Holding(Base):
    __tablename__ = "holdings"

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
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
