import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    address: Mapped[str] = mapped_column(String(500))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(50))
    zip_code: Mapped[str | None] = mapped_column(String(20))
    property_type: Mapped[str | None] = mapped_column(String(50))  # single_family, condo, etc.
    purchase_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    purchase_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closing_costs: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    current_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    last_valuation_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    is_primary_residence: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # Property management
    is_property_managed: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    management_fee_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))  # e.g., 8.00 for 8%
    leasing_fee_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))  # flat fee per lease
    zillow_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    redfin_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    pin: Mapped[str | None] = mapped_column(Text, nullable=True)
    county: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class PropertyValuation(Base):
    __tablename__ = "property_valuations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id"), index=True
    )
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    source: Mapped[str] = mapped_column(String(50))  # manual | appraisal | zillow | redfin
    valuation_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
