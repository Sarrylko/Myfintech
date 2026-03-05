import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Household(Base):
    __tablename__ = "households"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255))
    default_currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    default_locale: Mapped[str] = mapped_column(String(10), default="en-US", server_default="en-US")
    country_code: Mapped[str] = mapped_column(String(2), default="US", server_default="US")
    price_refresh_interval_minutes: Mapped[int] = mapped_column(Integer, default=15)
    price_refresh_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_price_refresh_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )

    members: Mapped[list["User"]] = relationship(back_populates="household")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="member")  # owner | member
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    phone: Mapped[str | None] = mapped_column(String(50))
    address_line1: Mapped[str | None] = mapped_column(String(255))
    address_line2: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(50))
    zip_code: Mapped[str | None] = mapped_column(String(20))
    notif_daily_summary: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_budget_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_bill_reminders: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_monthly_report: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_transaction_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    household: Mapped["Household"] = relationship(back_populates="members")
