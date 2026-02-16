import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NetWorthSnapshot(Base):
    __tablename__ = "net_worth_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    snapshot_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True
    )
    total_cash: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    total_investments: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    total_real_estate: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    total_debts: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    net_worth: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
