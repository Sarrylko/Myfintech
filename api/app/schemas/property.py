import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PropertyCreate(BaseModel):
    address: str
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    county: str | None = None
    pin: str | None = None
    property_type: str | None = None  # single_family, condo, townhouse, multi_family, land, other
    purchase_price: Decimal | None = None
    purchase_date: datetime | None = None
    closing_costs: Decimal | None = None
    current_value: Decimal | None = None
    notes: str | None = None
    is_primary_residence: bool = False
    is_property_managed: bool = False
    management_fee_pct: Decimal | None = None
    leasing_fee_amount: Decimal | None = None
    zillow_url: str | None = None
    redfin_url: str | None = None


class PropertyUpdate(BaseModel):
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    county: str | None = None
    pin: str | None = None
    property_type: str | None = None
    purchase_price: Decimal | None = None
    purchase_date: datetime | None = None
    closing_costs: Decimal | None = None
    current_value: Decimal | None = None
    notes: str | None = None
    is_primary_residence: bool | None = None
    is_property_managed: bool | None = None
    management_fee_pct: Decimal | None = None
    leasing_fee_amount: Decimal | None = None
    zillow_url: str | None = None
    redfin_url: str | None = None


class PropertyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    address: str
    city: str | None
    state: str | None
    zip_code: str | None
    county: str | None
    pin: str | None
    property_type: str | None
    purchase_price: Decimal | None
    purchase_date: datetime | None
    closing_costs: Decimal | None
    current_value: Decimal | None
    last_valuation_date: datetime | None
    notes: str | None
    is_primary_residence: bool
    is_property_managed: bool
    management_fee_pct: Decimal | None
    leasing_fee_amount: Decimal | None
    zillow_url: str | None
    redfin_url: str | None
    created_at: datetime
