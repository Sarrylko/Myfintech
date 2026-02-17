import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, text
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
    current_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    last_valuation_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    monthly_rent: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    mortgage_monthly: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    property_tax_annual: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    insurance_annual: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    hoa_monthly: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    maintenance_monthly: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
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
    source: Mapped[str] = mapped_column(String(50))  # manual, api_provider, etc.
    valuation_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
