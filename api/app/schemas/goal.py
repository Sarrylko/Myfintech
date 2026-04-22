import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


class GoalCreate(BaseModel):
    name: str
    description: Optional[str] = None
    goal_type: str = "savings"  # savings | debt_payoff | investment | custom
    target_amount: Decimal
    current_amount: Optional[Decimal] = None
    currency_code: str = "USD"
    country: str = "US"
    start_date: date
    target_date: date
    linked_account_id: Optional[uuid.UUID] = None
    linked_budget_id: Optional[uuid.UUID] = None

    @field_validator("goal_type")
    @classmethod
    def validate_goal_type(cls, v: str) -> str:
        allowed = {"savings", "debt_payoff", "investment", "custom"}
        if v not in allowed:
            raise ValueError(f"goal_type must be one of {allowed}")
        return v


class GoalUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    goal_type: Optional[str] = None
    target_amount: Optional[Decimal] = None
    current_amount: Optional[Decimal] = None
    currency_code: Optional[str] = None
    country: Optional[str] = None
    start_date: Optional[date] = None
    target_date: Optional[date] = None
    linked_account_id: Optional[uuid.UUID] = None
    linked_budget_id: Optional[uuid.UUID] = None
    is_completed: Optional[bool] = None


class LinkedAccountInfo(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    current_balance: Optional[Decimal] = None

    model_config = {"from_attributes": True, "extra": "ignore"}


class LinkedBudgetInfo(BaseModel):
    id: uuid.UUID
    amount: Decimal
    budget_type: str
    month: Optional[int] = None
    year: int

    model_config = {"from_attributes": True, "extra": "ignore"}


class GoalResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    name: str
    description: Optional[str] = None
    goal_type: str
    target_amount: Decimal
    current_amount: Optional[Decimal] = None
    currency_code: str
    country: str = "US"
    start_date: date
    target_date: date
    linked_account_id: Optional[uuid.UUID] = None
    linked_budget_id: Optional[uuid.UUID] = None
    is_completed: bool
    linked_account: Optional[LinkedAccountInfo] = None
    linked_budget: Optional[LinkedBudgetInfo] = None

    model_config = {"from_attributes": True, "extra": "ignore"}


class GoalWithProgressResponse(GoalResponse):
    progress_amount: Decimal  # current computed amount
    progress_percent: Decimal  # 0-100
    days_remaining: int
    is_on_track: bool
