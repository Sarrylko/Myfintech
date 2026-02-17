import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PropertyCreate(BaseModel):
    address: str
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    property_type: str | None = None  # single_family, condo, townhouse, multi_family, land, other
    purchase_price: Decimal | None = None
    purchase_date: datetime | None = None
    current_value: Decimal | None = None
    notes: str | None = None
    mortgage_balance: Decimal | None = None
    monthly_rent: Decimal | None = None
    mortgage_monthly: Decimal | None = None
    property_tax_annual: Decimal | None = None
    insurance_annual: Decimal | None = None
    hoa_monthly: Decimal | None = None
    maintenance_monthly: Decimal | None = None


class PropertyUpdate(BaseModel):
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    property_type: str | None = None
    purchase_price: Decimal | None = None
    purchase_date: datetime | None = None
    current_value: Decimal | None = None
    notes: str | None = None
    mortgage_balance: Decimal | None = None
    monthly_rent: Decimal | None = None
    mortgage_monthly: Decimal | None = None
    property_tax_annual: Decimal | None = None
    insurance_annual: Decimal | None = None
    hoa_monthly: Decimal | None = None
    maintenance_monthly: Decimal | None = None


class PropertyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    address: str
    city: str | None
    state: str | None
    zip_code: str | None
    property_type: str | None
    purchase_price: Decimal | None
    purchase_date: datetime | None
    current_value: Decimal | None
    last_valuation_date: datetime | None
    notes: str | None
    mortgage_balance: Decimal | None
    monthly_rent: Decimal | None
    mortgage_monthly: Decimal | None
    property_tax_annual: Decimal | None
    insurance_annual: Decimal | None
    hoa_monthly: Decimal | None
    maintenance_monthly: Decimal | None
    created_at: datetime
