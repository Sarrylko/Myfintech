import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SnapTradeUser(Base):
    """One SnapTrade user registration per household (stores user_id + encrypted user_secret)."""
    __tablename__ = "snaptrade_users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"),
        index=True, unique=True,
    )
    # The userId we registered with SnapTrade (we use the household UUID as a string)
    snaptrade_user_id: Mapped[str] = mapped_column(String(255), unique=True)
    # SnapTrade-issued secret, encrypted at rest
    encrypted_user_secret: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class SnapTradeConnection(Base):
    """One record per brokerage authorization created through SnapTrade."""
    __tablename__ = "snaptrade_connections"
    __table_args__ = (
        UniqueConstraint("snaptrade_authorization_id", name="uq_snaptrade_auth_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    # SnapTrade's own ID for this brokerage authorization
    snaptrade_authorization_id: Mapped[str] = mapped_column(String(255))
    brokerage_name: Mapped[str | None] = mapped_column(String(255))
    brokerage_slug: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    error_code: Mapped[str | None] = mapped_column(String(255))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    accounts: Mapped[list["Account"]] = relationship(back_populates="snaptrade_connection")  # type: ignore[name-defined]
