import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    goal_type: Mapped[str] = mapped_column(
        String(20), default="savings", server_default="savings"
    )  # savings | debt_payoff | investment | custom
    target_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    current_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 2), nullable=True
    )  # manual override; if None, computed from linked source
    currency_code: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    start_date: Mapped[date] = mapped_column(Date)
    target_date: Mapped[date] = mapped_column(Date)
    # Link to an account (balance-based progress)
    linked_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Link to a budget (spending-based progress, tracks actual_spent)
    linked_budget_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("budgets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    # lazy="selectin" is required for async SQLAlchemy
    linked_account: Mapped["Account"] = relationship(lazy="selectin")  # type: ignore[name-defined]
    linked_budget: Mapped["Budget"] = relationship(lazy="selectin")  # type: ignore[name-defined]
