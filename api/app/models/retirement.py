import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, text
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
    birth_year: Mapped[int] = mapped_column(Integer)
    retirement_age: Mapped[int] = mapped_column(Integer, default=65)
    life_expectancy_age: Mapped[int] = mapped_column(Integer, default=90)
    desired_annual_income: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    social_security_estimate: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    expected_return_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.07"))
    inflation_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.03"))
    annual_contribution: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    include_spouse: Mapped[bool] = mapped_column(Boolean, default=False)
    spouse_birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spouse_retirement_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spouse_social_security_estimate: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    spouse_annual_contribution: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    yearly_income: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    spouse_yearly_income: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    monthly_essential_expenses: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    monthly_non_essential_expenses: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )
