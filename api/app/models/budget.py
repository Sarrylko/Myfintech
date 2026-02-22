import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Budget(Base):
    __tablename__ = "budgets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    month: Mapped[int] = mapped_column(Integer)  # 1-12
    year: Mapped[int] = mapped_column(Integer)
    rollover_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    alert_threshold: Mapped[int] = mapped_column(Integer, default=80)  # 0-100
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    # lazy="selectin" is required for async SQLAlchemy — avoids greenlet issues
    category: Mapped["Category"] = relationship(lazy="selectin")  # type: ignore[name-defined]
