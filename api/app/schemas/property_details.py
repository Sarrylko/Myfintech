import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ─── Loan ─────────────────────────────────────────────────────────────────────

class LoanCreate(BaseModel):
    account_id: uuid.UUID | None = None
    lender_name: str | None = None
    loan_type: str = "mortgage"  # mortgage | heloc | second_mortgage | other
    original_amount: Decimal | None = None
    current_balance: Decimal | None = None
    interest_rate: Decimal | None = None  # e.g. 6.8750 = 6.875%
    monthly_payment: Decimal | None = None
    payment_due_day: int | None = None  # 1-31
    escrow_included: bool = False
    escrow_amount: Decimal | None = None
    origination_date: date | None = None
    maturity_date: date | None = None
    term_months: int | None = None
    notes: str | None = None


class LoanUpdate(BaseModel):
    account_id: uuid.UUID | None = None
    lender_name: str | None = None
    loan_type: str | None = None
    original_amount: Decimal | None = None
    current_balance: Decimal | None = None
    interest_rate: Decimal | None = None
    monthly_payment: Decimal | None = None
    payment_due_day: int | None = None
    escrow_included: bool | None = None
    escrow_amount: Decimal | None = None
    origination_date: date | None = None
    maturity_date: date | None = None
    term_months: int | None = None
    notes: str | None = None


class LoanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    account_id: uuid.UUID | None
    lender_name: str | None
    loan_type: str
    original_amount: Decimal | None
    current_balance: Decimal | None
    interest_rate: Decimal | None
    monthly_payment: Decimal | None
    payment_due_day: int | None
    escrow_included: bool
    escrow_amount: Decimal | None
    origination_date: date | None
    maturity_date: date | None
    term_months: int | None
    notes: str | None
    created_at: datetime


# ─── PropertyCost ──────────────────────────────────────────────────────────────

class PropertyCostCreate(BaseModel):
    category: str = "other"  # hoa | property_tax | insurance | maintenance | utility | other
    label: str | None = None
    amount: Decimal
    frequency: str = "monthly"  # monthly | quarterly | annual | one_time
    is_active: bool = True
    is_escrowed: bool = False  # paid via escrow — tracked for tax purposes, excluded from monthly cost total
    effective_date: date | None = None  # date this rate/amount took effect (e.g. tax year start)
    notes: str | None = None


class PropertyCostUpdate(BaseModel):
    category: str | None = None
    label: str | None = None
    amount: Decimal | None = None
    frequency: str | None = None
    is_active: bool | None = None
    is_escrowed: bool | None = None
    effective_date: date | None = None
    notes: str | None = None


class PropertyCostResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    category: str
    label: str | None
    amount: Decimal
    frequency: str
    is_active: bool
    is_escrowed: bool
    effective_date: date | None
    notes: str | None
    created_at: datetime


# ─── MaintenanceExpense ────────────────────────────────────────────────────────

class MaintenanceExpenseCreate(BaseModel):
    expense_date: date
    amount: Decimal
    category: str = "other"  # repair | appliance | landscaping | cleaning | inspection | plumbing | electrical | roofing | hvac | other
    description: str
    vendor: str | None = None
    is_capex: bool = False
    notes: str | None = None


class MaintenanceExpenseUpdate(BaseModel):
    expense_date: date | None = None
    amount: Decimal | None = None
    category: str | None = None
    description: str | None = None
    vendor: str | None = None
    is_capex: bool | None = None
    notes: str | None = None


class MaintenanceExpenseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    expense_date: date
    amount: Decimal
    category: str
    description: str
    vendor: str | None
    is_capex: bool
    notes: str | None
    created_at: datetime


# ─── PropertyValuation ────────────────────────────────────────────────────────

class PropertyValuationCreate(BaseModel):
    value: Decimal
    source: str = "manual"  # manual | appraisal | zillow | redfin
    valuation_date: datetime | None = None  # defaults to now() if not provided
    notes: str | None = None


class PropertyValuationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    value: Decimal
    source: str
    valuation_date: datetime
    notes: str | None
    created_at: datetime
