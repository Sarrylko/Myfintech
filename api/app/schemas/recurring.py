import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class RecurringCandidate(BaseModel):
    """A detected recurring pattern — not yet saved to DB."""
    key: str
    name: str
    merchant_name: str | None
    amount: Decimal
    frequency: str
    last_date: str
    next_expected: str
    occurrences: int
    confidence: float
    transaction_ids: list[str]
    amount_varies: bool = False


class RecurringConfirmRequest(BaseModel):
    candidates: list[RecurringCandidate]


class RecurringPaymentResponse(BaseModel):
    id: uuid.UUID
    recurring_id: uuid.UUID
    household_id: uuid.UUID
    amount: Decimal
    paid_date: date
    notes: str | None
    transaction_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RecurringTransactionResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    name: str
    merchant_name: str | None
    amount: Decimal
    frequency: str
    tag: str
    spending_type: str
    country: str = "US"
    next_due_date: date | None
    start_date: date | None
    is_active: bool
    amount_type: str
    notes: str | None
    created_at: datetime
    payments: list[RecurringPaymentResponse] = []

    model_config = {"from_attributes": True}


class RecurringTransactionCreate(BaseModel):
    name: str
    amount: Decimal
    frequency: str
    tag: str = "other"
    spending_type: str = "want"
    merchant_name: str | None = None
    next_due_date: date | None = None
    start_date: date | None = None
    notes: str | None = None
    amount_type: str = "fixed"
    country: str = "US"


class RecurringTransactionUpdate(BaseModel):
    name: str | None = None
    amount: Decimal | None = None
    is_active: bool | None = None
    notes: str | None = None
    frequency: str | None = None
    tag: str | None = None
    spending_type: str | None = None
    next_due_date: date | None = None
    start_date: date | None = None
    amount_type: str | None = None
    country: str | None = None


class RecurringPaymentCreate(BaseModel):
    amount: Decimal
    paid_date: date
    notes: str | None = None
    create_transaction: bool = True
    existing_transaction_id: uuid.UUID | None = None  # link to an existing transaction instead of creating new
