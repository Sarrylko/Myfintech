import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict

PolicyType = Literal[
    "life_term",
    "life_whole",
    "life_universal",
    "home",
    "renters",
    "auto",
    "umbrella",
    "health",
    "dental",
    "vision",
    "disability",
    "long_term_care",
    "business",
    "other",
]

PremiumFrequency = Literal["monthly", "quarterly", "semi_annual", "annual", "one_time"]

BeneficiaryType = Literal["primary", "contingent"]


# ─── InsuranceBeneficiary ─────────────────────────────────────────────────────

class InsuranceBeneficiaryCreate(BaseModel):
    name: str
    relationship: str | None = None
    beneficiary_type: BeneficiaryType = "primary"
    percentage: Decimal


class InsuranceBeneficiaryUpdate(BaseModel):
    name: str | None = None
    relationship: str | None = None
    beneficiary_type: BeneficiaryType | None = None
    percentage: Decimal | None = None


class InsuranceBeneficiaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    policy_id: uuid.UUID
    name: str
    relationship: str | None
    beneficiary_type: str
    percentage: Decimal
    created_at: datetime


# ─── InsurancePolicy ─────────────────────────────────────────────────────────

class InsurancePolicyCreate(BaseModel):
    policy_type: PolicyType
    provider: str
    policy_number: str | None = None
    premium_amount: Decimal | None = None
    premium_frequency: PremiumFrequency = "monthly"
    coverage_amount: Decimal | None = None
    deductible: Decimal | None = None
    start_date: date | None = None
    renewal_date: date | None = None
    auto_renew: bool = False
    is_active: bool = True
    property_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    insured_user_id: uuid.UUID | None = None
    entity_id: uuid.UUID | None = None
    notes: str | None = None


class InsurancePolicyUpdate(BaseModel):
    policy_type: PolicyType | None = None
    provider: str | None = None
    policy_number: str | None = None
    premium_amount: Decimal | None = None
    premium_frequency: PremiumFrequency | None = None
    coverage_amount: Decimal | None = None
    deductible: Decimal | None = None
    start_date: date | None = None
    renewal_date: date | None = None
    auto_renew: bool | None = None
    is_active: bool | None = None
    property_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    insured_user_id: uuid.UUID | None = None
    entity_id: uuid.UUID | None = None
    notes: str | None = None


class InsurancePolicyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    policy_type: str
    provider: str
    policy_number: str | None
    premium_amount: Decimal | None
    premium_frequency: str
    coverage_amount: Decimal | None
    deductible: Decimal | None
    start_date: date | None
    renewal_date: date | None
    auto_renew: bool
    is_active: bool
    property_id: uuid.UUID | None
    vehicle_id: uuid.UUID | None
    insured_user_id: uuid.UUID | None
    entity_id: uuid.UUID | None
    notes: str | None
    created_at: datetime


class InsurancePolicyDetail(InsurancePolicyResponse):
    """Enriched response with resolved FK display names and beneficiaries."""
    beneficiaries: list[InsuranceBeneficiaryResponse] = []
    property_address: str | None = None
    vehicle_label: str | None = None       # e.g. "2022 Toyota Camry"
    insured_user_name: str | None = None
    entity_name: str | None = None
