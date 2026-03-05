import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


class RetirementProfileCreate(BaseModel):
    currency_code: str = "USD"
    birth_year: int
    retirement_age: int = 65
    life_expectancy_age: int = 90
    desired_annual_income: Decimal
    social_security_estimate: Decimal | None = None
    expected_return_rate: Decimal = Decimal("0.07")
    inflation_rate: Decimal = Decimal("0.03")
    annual_contribution: Decimal = Decimal("0")
    include_spouse: bool = False
    spouse_birth_year: int | None = None
    spouse_retirement_age: int | None = None
    spouse_social_security_estimate: Decimal | None = None
    spouse_annual_contribution: Decimal | None = None
    yearly_income: Decimal | None = None
    spouse_yearly_income: Decimal | None = None
    monthly_essential_expenses: Decimal | None = None
    monthly_non_essential_expenses: Decimal | None = None

    @field_validator("birth_year")
    @classmethod
    def valid_birth_year(cls, v: int) -> int:
        if v < 1900 or v > 2020:
            raise ValueError("birth_year must be between 1900 and 2020")
        return v

    @field_validator("retirement_age")
    @classmethod
    def valid_retirement_age(cls, v: int) -> int:
        if v < 40 or v > 80:
            raise ValueError("retirement_age must be between 40 and 80")
        return v

    @field_validator("expected_return_rate")
    @classmethod
    def valid_return_rate(cls, v: Decimal) -> Decimal:
        if v < Decimal("0.01") or v > Decimal("0.20"):
            raise ValueError("expected_return_rate must be between 1% and 20%")
        return v


class RetirementProfileUpdate(BaseModel):
    currency_code: str | None = None
    birth_year: int | None = None
    retirement_age: int | None = None
    life_expectancy_age: int | None = None
    desired_annual_income: Decimal | None = None
    social_security_estimate: Decimal | None = None
    expected_return_rate: Decimal | None = None
    inflation_rate: Decimal | None = None
    annual_contribution: Decimal | None = None
    include_spouse: bool | None = None
    spouse_birth_year: int | None = None
    spouse_retirement_age: int | None = None
    spouse_social_security_estimate: Decimal | None = None
    spouse_annual_contribution: Decimal | None = None
    yearly_income: Decimal | None = None
    spouse_yearly_income: Decimal | None = None
    monthly_essential_expenses: Decimal | None = None
    monthly_non_essential_expenses: Decimal | None = None


class RetirementProfileResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    currency_code: str
    birth_year: int
    retirement_age: int
    life_expectancy_age: int
    desired_annual_income: Decimal
    social_security_estimate: Decimal | None
    expected_return_rate: Decimal
    inflation_rate: Decimal
    annual_contribution: Decimal
    include_spouse: bool
    spouse_birth_year: int | None
    spouse_retirement_age: int | None
    spouse_social_security_estimate: Decimal | None
    spouse_annual_contribution: Decimal | None
    yearly_income: Decimal | None
    spouse_yearly_income: Decimal | None
    monthly_essential_expenses: Decimal | None
    monthly_non_essential_expenses: Decimal | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class YearlyProjection(BaseModel):
    year: int
    age: int
    projected: float
    required: float


class ScenarioProjection(BaseModel):
    year: int
    age: int
    optimistic: float
    base: float
    pessimistic: float
    required: float


class IncomeSource(BaseModel):
    label: str
    annual_amount: float
    source_type: str  # portfolio | social_security | rental | real_estate


class RetirementProjectionResponse(BaseModel):
    profile: RetirementProfileResponse
    current_age: int
    years_to_retirement: int
    current_retirement_assets: float
    total_net_worth: float
    retirement_wealth_target: float
    projected_wealth_at_retirement: float
    pessimistic_wealth_at_retirement: float
    optimistic_wealth_at_retirement: float
    gap: float
    required_additional_annual_saving: float
    monthly_saving_needed: float
    on_track_pct: float
    probability_of_success: float
    tax_deferred_balance: float
    taxable_investment_balance: float
    tax_exempt_balance: float
    total_monthly_expenses: float
    income_sources: list[IncomeSource]
    yearly_projections: list[YearlyProjection]
    scenario_projections: list[ScenarioProjection]
    insights: list[str]
