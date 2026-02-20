import uuid
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Loan(Base):
    __tablename__ = "loans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id", ondelete="CASCADE"), index=True
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    lender_name: Mapped[str | None] = mapped_column(String(255))
    loan_type: Mapped[str] = mapped_column(
        String(50), default="mortgage"
    )  # mortgage | heloc | second_mortgage | other
    original_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    current_balance: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    interest_rate: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 4)
    )  # e.g. 6.8750 = 6.875%
    monthly_payment: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 2)
    )  # total P&I (or PITI if escrow included)
    payment_due_day: Mapped[int | None] = mapped_column(Integer)  # day of month 1-31
    escrow_included: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa.text("false")
    )
    escrow_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 2)
    )  # monthly escrow portion
    origination_date: Mapped[date | None] = mapped_column(Date)
    maturity_date: Mapped[date | None] = mapped_column(Date)
    term_months: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class PropertyCost(Base):
    __tablename__ = "property_costs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(
        String(50), default="other"
    )  # hoa | property_tax | insurance | maintenance | utility | other
    label: Mapped[str | None] = mapped_column(String(255))  # e.g. "HOA - Lakeside Commons"
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    frequency: Mapped[str] = mapped_column(
        String(20), default="monthly"
    )  # monthly | quarterly | annual | one_time
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=sa.text("true")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class MaintenanceExpense(Base):
    __tablename__ = "maintenance_expenses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id", ondelete="CASCADE"), index=True
    )
    expense_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    category: Mapped[str] = mapped_column(
        String(50), default="other"
    )  # repair | appliance | landscaping | cleaning | inspection | plumbing | electrical | roofing | hvac | other
    description: Mapped[str] = mapped_column(String(500))
    vendor: Mapped[str | None] = mapped_column(String(255))
    is_capex: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa.text("false")
    )  # True = capital expenditure (excluded from NOI), False = operating expense
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
