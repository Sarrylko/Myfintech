import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BusinessEntity(Base):
    __tablename__ = "business_entities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_entities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255))
    entity_type: Mapped[str] = mapped_column(String(30))
    # llc | s_corp | c_corp | trust | partnership | sole_prop
    state_of_formation: Mapped[str | None] = mapped_column(String(2))  # 2-char state code
    ein: Mapped[str | None] = mapped_column(String(20))  # XX-XXXXXXX format
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class EntityOwnership(Base):
    __tablename__ = "entity_ownership"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_entities.id", ondelete="CASCADE"),
        index=True,
    )
    # Exactly one of owner_user_id / owner_entity_id should be set
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    owner_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_entities.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    ownership_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2))  # 0.00 – 100.00
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class EntityEmailWatch(Base):
    """A Gmail inbox monitored on behalf of a business entity (e.g. an LLC)."""

    __tablename__ = "entity_email_watches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_entities.id", ondelete="CASCADE"),
        index=True,
    )
    gmail_address: Mapped[str] = mapped_column(String(320))
    sender_allowlist: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list, server_default="{}"
    )
    notif_phone_override: Mapped[str | None] = mapped_column(String(50))
    encrypted_gmail_refresh_token: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
