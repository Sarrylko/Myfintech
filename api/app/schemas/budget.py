import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    amount: Decimal = Field(gt=0, decimal_places=2)
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=2100)
    rollover_enabled: bool = False
    alert_threshold: int = Field(default=80, ge=0, le=100)


class BudgetBulkCreate(BaseModel):
    budgets: list[BudgetCreate]


class BudgetUpdate(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0)
    rollover_enabled: bool | None = None
    alert_threshold: int | None = Field(default=None, ge=0, le=100)


class CategoryInBudget(BaseModel):
    id: uuid.UUID
    name: str
    icon: str | None
    color: str | None
    is_income: bool

    model_config = {"from_attributes": True}


class BudgetResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    category_id: uuid.UUID
    category: CategoryInBudget
    amount: Decimal
    month: int
    year: int
    rollover_enabled: bool
    alert_threshold: int
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetWithActualResponse(BudgetResponse):
    actual_spent: Decimal
    remaining: Decimal     # negative if over budget
    percent_used: Decimal  # (actual_spent / amount) * 100
