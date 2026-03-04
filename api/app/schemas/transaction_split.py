import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


class TransactionSplitItem(BaseModel):
    amount: Decimal
    category: str
    notes: str | None = None

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Split amount must be positive")
        return v

    @field_validator("category")
    @classmethod
    def category_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Category is required")
        return v.strip()


class TransactionSplitRequest(BaseModel):
    splits: list[TransactionSplitItem]

    @field_validator("splits")
    @classmethod
    def at_least_two(cls, v: list) -> list:
        if len(v) < 2:
            raise ValueError("At least 2 split lines are required")
        return v


class TransactionSplitResponse(BaseModel):
    id: uuid.UUID
    transaction_id: uuid.UUID
    amount: Decimal
    category: str
    notes: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
