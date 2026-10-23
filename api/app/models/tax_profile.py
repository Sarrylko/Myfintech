import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TaxProfile(Base):
    """What the tax projection can't derive from accounts: one row per household and year.

    Money fields left NULL mean "derive it" (estimated payments from
    transactions, mortgage interest from loans, property tax from property costs).
    """
    __tablename__ = "tax_profiles"
    __table_args__ = (UniqueConstraint("household_id", "year", name="uq_tax_profiles_household_year"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    year: Mapped[int] = mapped_column(Integer)

    filing_status: Mapped[str] = mapped_column(String(10), server_default="mfj")  # single | mfj | mfs | hoh
    state: Mapped[str | None] = mapped_column(String(2))
    taxpayer_birthdate: Mapped[date | None] = mapped_column(Date)
    spouse_birthdate: Mapped[date | None] = mapped_column(Date)
    dependents_under_17: Mapped[int] = mapped_column(Integer, server_default="0")
    other_dependents: Mapped[int] = mapped_column(Integer, server_default="0")

    # Last year's return, for the safe harbor
    prior_year_agi: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    prior_year_tax: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    # Income the accounts don't show
    expected_bonus: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    other_ordinary_income: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))  # RSU, 1099-NEC/MISC
    capital_loss_carryover: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    # Above-the-line: deductible IRA, HSA outside payroll, student loan interest
    above_line_adjustments: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    # Itemized deductions; NULL derives from loans / property costs
    mortgage_interest_override: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    property_tax_override: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    charitable_cash: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    charitable_noncash: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    medical_expenses: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    other_itemized: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    # Estimated payments; NULL derives from "Taxes" transactions
    estimated_payments_federal: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    estimated_payments_state: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    # Rentals
    real_estate_professional: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    active_participation: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    suspended_passive_loss: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    # Opportunity ids the user dismissed or marked done: {"id": "dismissed" | "done"}
    opportunity_status: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=datetime.utcnow
    )
