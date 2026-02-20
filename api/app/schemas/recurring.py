import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class RecurringCandidate(BaseModel):
    """A detected recurring pattern — not yet saved to DB."""
    key: str                        # unique key for dedup (name+amount+frequency)
    name: str                       # best display name
    merchant_name: str | None
    amount: Decimal
    frequency: str                  # weekly | biweekly | monthly | quarterly | annual
    last_date: str                  # ISO date of most recent occurrence
    next_expected: str              # ISO date of predicted next occurrence
    occurrences: int
    confidence: float               # 0–1
    transaction_ids: list[str]      # IDs of matching transactions


class RecurringConfirmRequest(BaseModel):
    """Body for confirming selected candidates."""
    candidates: list[RecurringCandidate]


class RecurringTransactionResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    name: str
    merchant_name: str | None
    amount: Decimal
    frequency: str
    is_active: bool
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RecurringTransactionUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    notes: str | None = None
    frequency: str | None = None
