import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, model_validator
from app.schemas.transaction_split import TransactionSplitResponse

# Plaid category prefixes that represent transfers (excluded from income/expense)
_TRANSFER_PLAID_PREFIXES = ("transfer", "payment > credit card", "payment > credit", "payment > loan")
_RENTAL_PLAID_PREFIXES = ("income > rental", "rental income")
_PROPERTY_EXPENSE_PLAID_PREFIXES = ("home improvement", "home services", "property tax", "home insurance")


class AccountResponse(BaseModel):
    id: uuid.UUID
    plaid_item_id: uuid.UUID | None
    snaptrade_connection_id: uuid.UUID | None = None
    owner_user_id: uuid.UUID | None
    entity_id: uuid.UUID | None = None
    account_scope: str = "personal"
    name: str
    official_name: str | None
    institution_name: str | None
    type: str
    subtype: str | None
    mask: str | None
    current_balance: Decimal | None
    available_balance: Decimal | None
    currency_code: str
    country: str = "US"
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
    country: str = "US"


class AccountUpdate(BaseModel):
    owner_user_id: uuid.UUID | None = None
    entity_id: uuid.UUID | None = None
    account_scope: str | None = None  # personal | business
    name: str | None = None
    institution_name: str | None = None
    type: str | None = None
    subtype: str | None = None
    mask: str | None = None
    current_balance: Decimal | None = None
    is_hidden: bool | None = None
    country: str | None = None
    currency_code: str | None = None


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
    has_splits: bool = False
    splits: list[TransactionSplitResponse] = []
    receipt: dict | None = None
    notes: str | None
    created_at: datetime
    is_transfer: bool = False          # True if this transaction is a transfer (CC payment, internal move)
    is_rental_income: bool = False     # True if this transaction is rental income (excluded from personal income)
    is_property_expense: bool = False  # True if this transaction is a property/business expense
    is_business: bool = False          # True if the account is linked to a business entity

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def compute_flags(cls, data: Any) -> Any:
        # When building from ORM object, compute is_transfer and is_rental_income
        if hasattr(data, "__dict__"):  # ORM model instance
            cat = getattr(data, "category", None)
            plaid_cat = (getattr(data, "plaid_category", None) or "").lower()

            # is_transfer
            if cat is not None and getattr(cat, "is_transfer", False):
                data.__dict__["is_transfer"] = True
            elif plaid_cat.startswith(_TRANSFER_PLAID_PREFIXES):
                data.__dict__["is_transfer"] = True
            else:
                data.__dict__["is_transfer"] = False

            # is_rental_income
            if cat is not None and getattr(cat, "is_rental_income", False):
                data.__dict__["is_rental_income"] = True
            elif plaid_cat.startswith(_RENTAL_PLAID_PREFIXES):
                data.__dict__["is_rental_income"] = True
            else:
                data.__dict__["is_rental_income"] = False

            # is_property_expense
            if cat is not None and getattr(cat, "is_property_expense", False):
                data.__dict__["is_property_expense"] = True
            elif plaid_cat.startswith(_PROPERTY_EXPENSE_PLAID_PREFIXES):
                data.__dict__["is_property_expense"] = True
            else:
                data.__dict__["is_property_expense"] = False

            # is_business — true when the account belongs to a business entity
            acc = getattr(data, "account", None)
            data.__dict__["is_business"] = (
                acc is not None and (
                    getattr(acc, "entity_id", None) is not None or
                    getattr(acc, "account_scope", "personal") == "business"
                )
            )

            # receipt summary (id + status only, for the action button indicator)
            receipt_obj = getattr(data, "receipt", None)
            if receipt_obj is not None:
                data.__dict__["receipt"] = {
                    "id": str(receipt_obj.id),
                    "status": receipt_obj.status,
                }
            else:
                data.__dict__["receipt"] = None
        return data


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
    is_transfer: bool = False
    is_rental_income: bool = False
    is_property_expense: bool = False


class CategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    icon: str | None
    color: str | None
    parent_id: uuid.UUID | None
    is_income: bool
    is_transfer: bool
    is_rental_income: bool
    is_property_expense: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class HoldingResponse(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    security_id: str | None
    ticker_symbol: str | None
    name: str | None
    quantity: Decimal
    cost_basis: Decimal | None
    current_value: Decimal | None
    currency_code: str
    asset_class: str | None = None
    coingecko_id: str | None = None
    previous_close: Decimal | None = None
    as_of_date: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class HoldingCreate(BaseModel):
    ticker_symbol: str | None = None
    name: str | None = None
    quantity: Decimal
    cost_basis: Decimal | None = None
    current_value: Decimal | None = None
    currency_code: str = "USD"
    asset_class: str | None = None
    coingecko_id: str | None = None


class HoldingUpdate(BaseModel):
    ticker_symbol: str | None = None
    name: str | None = None
    quantity: Decimal | None = None
    cost_basis: Decimal | None = None
    current_value: Decimal | None = None
    currency_code: str | None = None
    asset_class: str | None = None
    coingecko_id: str | None = None
