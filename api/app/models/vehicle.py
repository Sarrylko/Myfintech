import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    make: Mapped[str] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(100))
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vin: Mapped[str | None] = mapped_column(String(50), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
