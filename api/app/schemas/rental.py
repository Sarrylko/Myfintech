import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ─── Unit ──────────────────────────────────────────────────────────────────

class UnitCreate(BaseModel):
    unit_label: str
    beds: int | None = None
    baths: Decimal | None = None
    sqft: int | None = None
    is_rentable: bool = True
    notes: str | None = None


class UnitUpdate(BaseModel):
    unit_label: str | None = None
    beds: int | None = None
    baths: Decimal | None = None
    sqft: int | None = None
    is_rentable: bool | None = None
    notes: str | None = None


class UnitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    unit_label: str
    beds: int | None
    baths: Decimal | None
    sqft: int | None
    is_rentable: bool
    notes: str | None
    created_at: datetime


# ─── Tenant ────────────────────────────────────────────────────────────────

class TenantCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    notes: str | None = None


class TenantUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    notes: str | None = None


class TenantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    notes: str | None
    created_at: datetime


# ─── Lease ─────────────────────────────────────────────────────────────────

class LeaseCreate(BaseModel):
    unit_id: uuid.UUID
    tenant_id: uuid.UUID
    lease_start: date
    lease_end: date | None = None
    move_in_date: date | None = None
    move_out_date: date | None = None
    monthly_rent: Decimal
    deposit: Decimal | None = None
    status: str = "active"
    notes: str | None = None


class LeaseUpdate(BaseModel):
    lease_start: date | None = None
    lease_end: date | None = None
    move_in_date: date | None = None
    move_out_date: date | None = None
    monthly_rent: Decimal | None = None
    deposit: Decimal | None = None
    status: str | None = None
    notes: str | None = None


class LeaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    unit_id: uuid.UUID
    tenant_id: uuid.UUID
    lease_start: date
    lease_end: date | None
    move_in_date: date | None
    move_out_date: date | None
    monthly_rent: Decimal
    deposit: Decimal | None
    status: str
    notes: str | None
    created_at: datetime


# ─── RentCharge ────────────────────────────────────────────────────────────

class RentChargeCreate(BaseModel):
    charge_date: date
    amount: Decimal
    charge_type: str = "rent"  # rent | late_fee | pet | parking | other
    notes: str | None = None


class RentChargeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lease_id: uuid.UUID
    charge_date: date
    amount: Decimal
    charge_type: str
    notes: str | None
    created_at: datetime


# ─── Payment ───────────────────────────────────────────────────────────────

class PaymentCreate(BaseModel):
    payment_date: date
    amount: Decimal
    method: str | None = None  # cash | check | ach | zelle | other
    applied_to_charge_id: uuid.UUID | None = None
    notes: str | None = None


class PaymentUpdate(BaseModel):
    payment_date: date | None = None
    amount: Decimal | None = None
    method: str | None = None
    applied_to_charge_id: uuid.UUID | None = None
    notes: str | None = None


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lease_id: uuid.UUID
    payment_date: date
    amount: Decimal
    method: str | None
    applied_to_charge_id: uuid.UUID | None
    notes: str | None
    created_at: datetime
