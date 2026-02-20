import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class AccountResponse(BaseModel):
    id: uuid.UUID
    plaid_item_id: uuid.UUID | None
    owner_user_id: uuid.UUID | None
    name: str
    official_name: str | None
    institution_name: str | None
    type: str
    subtype: str | None
    mask: str | None
    current_balance: Decimal | None
    available_balance: Decimal | None
    currency_code: str
    is_hidden: bool
    is_manual: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ManualAccountCreate(BaseModel):
    owner_user_id: uuid.UUID | None = None
    name: str
    institution_name: str | None = None
    type: str  # depository | credit | loan | investment | other
    subtype: str | None = None
    mask: str | None = None  # last 4 digits of account number
    current_balance: Decimal | None = None
    currency_code: str = "USD"


class AccountUpdate(BaseModel):
    owner_user_id: uuid.UUID | None = None
    name: str | None = None
    institution_name: str | None = None
    type: str | None = None
    subtype: str | None = None
    mask: str | None = None
    current_balance: Decimal | None = None
    is_hidden: bool | None = None


class TransactionResponse(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID | None
    amount: Decimal
    date: datetime
    name: str
    merchant_name: str | None
    pending: bool
    plaid_category: str | None
    custom_category_id: uuid.UUID | None
    is_manual_category: bool
    is_ignored: bool
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionUpdate(BaseModel):
    name: str | None = None
    merchant_name: str | None = None
    amount: Decimal | None = None
    date: datetime | None = None
    plaid_category: str | None = None
    custom_category_id: uuid.UUID | None = None
    notes: str | None = None
    pending: bool | None = None
    is_ignored: bool | None = None


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
