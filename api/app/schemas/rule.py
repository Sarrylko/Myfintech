import uuid
from datetime import datetime

from pydantic import BaseModel


class RuleCreate(BaseModel):
    name: str
    match_field: str        # "name" | "merchant_name" | "account_type"
    match_type: str         # "contains" | "exact"
    match_value: str
    category_string: str | None = None   # "Food & Dining > Groceries"
    negate_amount: bool = False
    priority: int = 0


class RuleUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    category_string: str | None = None
    negate_amount: bool | None = None
    priority: int | None = None
    match_field: str | None = None
    match_type: str | None = None
    match_value: str | None = None


class RuleResponse(BaseModel):
    id: uuid.UUID
    name: str
    match_field: str
    match_type: str
    match_value: str
    category_string: str | None
    negate_amount: bool
    priority: int
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
