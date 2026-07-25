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
    currency_code: str = "USD"
    country: str = "US"
    budget_type: BudgetType = BudgetType.monthly
    year: int = Field(ge=2000, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)  # required only for monthly
    start_date: date | None = None  # required for quarterly/custom; auto-derived for annual
    end_date: date | None = None    # required for quarterly/custom; auto-derived for annual
    rollover_enabled: bool = False
    alert_threshold: int = Field(default=80, ge=0, le=100)
    # Optional: track progress from this account's balance instead of transaction matching
    # (e.g. a dedicated sinking-fund account for property tax).
    account_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_period(self) -> "BudgetCreate":
        if self.budget_type == BudgetType.monthly:
            if self.month is None:
                raise ValueError("month is required for monthly budgets")
        elif self.budget_type in (BudgetType.annual, BudgetType.quarterly, BudgetType.custom):
            # Any 12-month (or custom) span is allowed — not forced to calendar-year —
            # so fiscal-cycle budgets (e.g. Jul-Jun for insurance/tax) can be represented.
            if not self.start_date or not self.end_date:
                raise ValueError("start_date and end_date are required for annual/quarterly/custom budgets")
            if self.end_date < self.start_date:
                raise ValueError("end_date must be on or after start_date")
        return self


class BudgetBulkCreate(BaseModel):
    budgets: list[BudgetCreate]


class BudgetUpdate(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0)
    currency_code: str | None = None
    rollover_enabled: bool | None = None
    alert_threshold: int | None = Field(default=None, ge=0, le=100)
    # Explicit `null` clears the linked account; omit the field to leave it unchanged.
    account_id: uuid.UUID | None = None


class CategoryInBudget(BaseModel):
    id: uuid.UUID
    name: str
    icon: str | None
    color: str | None
    is_income: bool

    model_config = {"from_attributes": True}


class AccountInBudget(BaseModel):
    id: uuid.UUID
    name: str
    institution_name: str | None
    mask: str | None
    current_balance: Decimal | None

    model_config = {"from_attributes": True}


class BudgetResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    category_id: uuid.UUID
    category: CategoryInBudget
    account_id: uuid.UUID | None
    account: AccountInBudget | None
    amount: Decimal
    currency_code: str
    country: str = "US"
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
