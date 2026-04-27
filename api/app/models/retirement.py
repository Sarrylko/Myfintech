import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RetirementProfile(Base):
    """One retirement planning profile per household."""
    __tablename__ = "retirement_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"),
        unique=True, index=True
    )
    currency_code: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    birth_year: Mapped[int] = mapped_column(Integer)
    retirement_age: Mapped[int] = mapped_column(Integer, default=65)
    life_expectancy_age: Mapped[int] = mapped_column(Integer, default=90)
    desired_annual_income: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    social_security_estimate: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    # SS claiming age — null = use max(62, retirement_age). If set, delay credits applied vs FRA=67.
    social_security_start_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_return_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.07"))
    inflation_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.03"))
    safe_withdrawal_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.04"), server_default="0.04")
    annual_contribution: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    include_spouse: Mapped[bool] = mapped_column(Boolean, default=False)
    spouse_birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spouse_retirement_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spouse_life_expectancy_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spouse_social_security_estimate: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    spouse_social_security_start_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spouse_annual_contribution: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    annual_contribution_401k: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"), server_default="0")
    annual_contribution_roth: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"), server_default="0")
    spouse_annual_contribution_401k: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True, server_default="0")
    spouse_annual_contribution_roth: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True, server_default="0")
    yearly_income: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    spouse_yearly_income: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    monthly_essential_expenses: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    monthly_non_essential_expenses: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Additional monthly healthcare expenses (null = use 15% of total expenses default)
    monthly_healthcare_expenses: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Long-term care modeling (defaults applied in router: age 82, 4 years, $100k/year)
    long_term_care_start_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    long_term_care_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    long_term_care_annual_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    # US state abbreviation for personalized state tax rates
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    # Biological sex for actuarial life expectancy suggestion (male/female)
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # JSON array of account UUID strings; null = auto-detect retirement accounts by subtype
    retirement_account_ids: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )
