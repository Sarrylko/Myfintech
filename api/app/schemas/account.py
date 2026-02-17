import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class AccountResponse(BaseModel):
    id: uuid.UUID
    plaid_item_id: uuid.UUID
    name: str
    official_name: str | None
    type: str
    subtype: str | None
    mask: str | None
    current_balance: Decimal | None
    available_balance: Decimal | None
    currency_code: str
    is_hidden: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionResponse(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    amount: Decimal
    date: datetime
    name: str
    merchant_name: str | None
    pending: bool
    plaid_category: str | None
    custom_category_id: uuid.UUID | None
    is_manual_category: bool
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionUpdate(BaseModel):
    custom_category_id: uuid.UUID | None = None
    notes: str | None = None


class CategoryCreate(BaseModel):
    name: str
    icon: str | None = None
    color: str | None = None
    parent_id: uuid.UUID | None = None
    is_income: bool = False


class CategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    icon: str | None
    color: str | None
    parent_id: uuid.UUID | None
    is_income: bool
    created_at: datetime

    model_config = {"from_attributes": True}
