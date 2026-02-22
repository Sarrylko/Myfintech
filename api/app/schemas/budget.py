import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class BudgetType(str, enum.Enum):
    monthly = "monthly"
    annual = "annual"
    quarterly = "quarterly"
    custom = "custom"


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    amount: Decimal = Field(gt=0, decimal_places=2)
    budget_type: BudgetType = BudgetType.monthly
    year: int = Field(ge=2000, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)  # required only for monthly
    start_date: date | None = None  # required for quarterly/custom; auto-derived for annual
    end_date: date | None = None    # required for quarterly/custom; auto-derived for annual
    rollover_enabled: bool = False
    alert_threshold: int = Field(default=80, ge=0, le=100)

    @model_validator(mode="after")
    def validate_period(self) -> "BudgetCreate":
        if self.budget_type == BudgetType.monthly:
            if self.month is None:
                raise ValueError("month is required for monthly budgets")
        elif self.budget_type == BudgetType.annual:
            # Auto-derive full-year date range
            self.start_date = date(self.year, 1, 1)
            self.end_date = date(self.year, 12, 31)
        elif self.budget_type in (BudgetType.quarterly, BudgetType.custom):
            if not self.start_date or not self.end_date:
                raise ValueError("start_date and end_date are required for quarterly/custom budgets")
            if self.end_date < self.start_date:
                raise ValueError("end_date must be on or after start_date")
        return self


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
    budget_type: str
    month: int | None
    year: int
    start_date: date | None
    end_date: date | None
    rollover_enabled: bool
    alert_threshold: int
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetWithActualResponse(BudgetResponse):
    actual_spent: Decimal
    remaining: Decimal     # negative if over budget
    percent_used: Decimal  # (actual_spent / amount) * 100
