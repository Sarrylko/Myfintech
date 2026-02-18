import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CapitalEvent(Base):
    __tablename__ = "capital_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id", ondelete="CASCADE"), index=True
    )
    event_date: Mapped[date] = mapped_column(Date)
    event_type: Mapped[str] = mapped_column(
        String(50), default="other"
    )  # acquisition | additional_investment | refi_proceeds | sale | other
    # Sign convention: negative = cash OUT (investment/spend), positive = cash IN (proceeds)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    description: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
