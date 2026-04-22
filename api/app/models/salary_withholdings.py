import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

_ZERO = Decimal("0")


class SalaryWithholding(Base):
    __tablename__ = "salary_withholdings"
    __table_args__ = (
        UniqueConstraint("household_id", "user_id", "year", name="uq_salary_withholdings_household_user_year"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    year: Mapped[int] = mapped_column(Integer)
    employer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # W-2 Box 1 / Box 5 wages
    gross_wages: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)
    federal_wages: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)
    medicare_wages: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)

    # Taxes withheld
    federal_income_tax: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)
    state_income_tax: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)
    social_security_tax: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)
    medicare_tax: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)

    # Box 12 codes
    traditional_401k: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)   # 12D
    roth_401k: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)           # 12AA
    esop_income: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)         # 12V
    hsa: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)                 # 12W
    health_insurance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)   # 12DD
    group_term_life: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)    # 12C
    fsa_section125: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=_ZERO)     # Sec 125

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=datetime.utcnow
    )
