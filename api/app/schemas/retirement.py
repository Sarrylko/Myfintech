import json
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class RetirementProfileCreate(BaseModel):
    currency_code: str = "USD"
    birth_year: int
    retirement_age: int = 65
    life_expectancy_age: int = 90
    desired_annual_income: Decimal
    social_security_estimate: Decimal | None = None
    social_security_start_age: int | None = None
    expected_return_rate: Decimal = Decimal("0.07")
    inflation_rate: Decimal = Decimal("0.03")
    safe_withdrawal_rate: Decimal = Decimal("0.04")
    annual_contribution: Decimal = Decimal("0")
    annual_contribution_401k: Decimal = Decimal("0")
    annual_contribution_roth: Decimal = Decimal("0")
    include_spouse: bool = False
    spouse_birth_year: int | None = None
    spouse_retirement_age: int | None = None
    spouse_life_expectancy_age: int | None = None
    spouse_social_security_estimate: Decimal | None = None
    spouse_social_security_start_age: int | None = None
    spouse_annual_contribution: Decimal | None = None
    spouse_annual_contribution_401k: Decimal | None = None
    spouse_annual_contribution_roth: Decimal | None = None
    yearly_income: Decimal | None = None
    spouse_yearly_income: Decimal | None = None
    monthly_essential_expenses: Decimal | None = None
    monthly_non_essential_expenses: Decimal | None = None
    monthly_healthcare_expenses: Decimal | None = None
    long_term_care_start_age: int | None = None
    long_term_care_years: int | None = None
    long_term_care_annual_cost: Decimal | None = None
    state: str | None = None
    gender: str | None = None

    @model_validator(mode="after")
    def bucket_contributions_within_total(self) -> "RetirementProfileCreate":
        td = self.annual_contribution_401k or Decimal("0")
        te = self.annual_contribution_roth or Decimal("0")
        if td + te > self.annual_contribution:
            raise ValueError("annual_contribution_401k + annual_contribution_roth cannot exceed annual_contribution")
        if self.include_spouse:
            s_td = self.spouse_annual_contribution_401k or Decimal("0")
            s_te = self.spouse_annual_contribution_roth or Decimal("0")
            s_total = self.spouse_annual_contribution or Decimal("0")
            if s_td + s_te > s_total:
                raise ValueError("spouse bucket contributions cannot exceed spouse_annual_contribution")
        return self

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

    @field_validator("safe_withdrawal_rate")
    @classmethod
    def valid_swr(cls, v: Decimal) -> Decimal:
        if v < Decimal("0.02") or v > Decimal("0.08"):
            raise ValueError("safe_withdrawal_rate must be between 2% and 8%")
        return v


class RetirementProfileUpdate(BaseModel):
    currency_code: str | None = None
    birth_year: int | None = None
    retirement_age: int | None = None
    life_expectancy_age: int | None = None
    desired_annual_income: Decimal | None = None
    social_security_estimate: Decimal | None = None
    social_security_start_age: int | None = None
    expected_return_rate: Decimal | None = None
    inflation_rate: Decimal | None = None
    safe_withdrawal_rate: Decimal | None = None
    annual_contribution: Decimal | None = None
    annual_contribution_401k: Decimal | None = None
    annual_contribution_roth: Decimal | None = None
    include_spouse: bool | None = None
    spouse_birth_year: int | None = None
    spouse_retirement_age: int | None = None
    spouse_life_expectancy_age: int | None = None
    spouse_social_security_estimate: Decimal | None = None
    spouse_social_security_start_age: int | None = None
    spouse_annual_contribution: Decimal | None = None
    spouse_annual_contribution_401k: Decimal | None = None
    spouse_annual_contribution_roth: Decimal | None = None
    yearly_income: Decimal | None = None
    spouse_yearly_income: Decimal | None = None
    monthly_essential_expenses: Decimal | None = None
    monthly_non_essential_expenses: Decimal | None = None
    monthly_healthcare_expenses: Decimal | None = None
    long_term_care_start_age: int | None = None
    long_term_care_years: int | None = None
    long_term_care_annual_cost: Decimal | None = None
    state: str | None = None
    gender: str | None = None


class RetirementProfileResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    currency_code: str
    birth_year: int
    retirement_age: int
    life_expectancy_age: int
    desired_annual_income: Decimal
    social_security_estimate: Decimal | None
    social_security_start_age: int | None = None
    expected_return_rate: Decimal
    inflation_rate: Decimal
    safe_withdrawal_rate: Decimal
    annual_contribution: Decimal
    annual_contribution_401k: Decimal
    annual_contribution_roth: Decimal
    include_spouse: bool
    spouse_birth_year: int | None
    spouse_retirement_age: int | None
    spouse_life_expectancy_age: int | None
    spouse_social_security_estimate: Decimal | None
    spouse_social_security_start_age: int | None = None
    spouse_annual_contribution: Decimal | None
    spouse_annual_contribution_401k: Decimal | None
    spouse_annual_contribution_roth: Decimal | None
    yearly_income: Decimal | None
    spouse_yearly_income: Decimal | None
    monthly_essential_expenses: Decimal | None
    monthly_non_essential_expenses: Decimal | None
    monthly_healthcare_expenses: Decimal | None = None
    long_term_care_start_age: int | None = None
    long_term_care_years: int | None = None
    long_term_care_annual_cost: Decimal | None = None
    state: str | None = None
    gender: str | None = None
    retirement_account_ids: list[str] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("retirement_account_ids", mode="before")
    @classmethod
    def deserialize_account_ids(cls, v: Any) -> list[str] | None:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v


class RetirementAccountInfo(BaseModel):
    """Account with retirement classification metadata for frontend account picker."""
    id: str
    name: str
    institution_name: str | None
    type: str
    subtype: str | None
    current_balance: float
    tax_treatment: str  # tax_deferred | tax_exempt | taxable | non_investment
    is_auto_included: bool  # whether this account is picked up by auto-detect
    is_selected: bool  # whether explicitly selected (or included via auto)
    is_manual_mode: bool  # true if profile has an explicit manual selection saved

    model_config = ConfigDict(from_attributes=False)


class RetirementAccountSelectionUpdate(BaseModel):
    account_ids: list[str] | None  # null = revert to auto-detect


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
    probability_method: str = "monte_carlo"  # "monte_carlo" | "heuristic"
    tax_deferred_balance: float
    taxable_investment_balance: float
    tax_exempt_balance: float
    total_monthly_expenses: float
    income_sources: list[IncomeSource]
    yearly_projections: list[YearlyProjection]
    scenario_projections: list[ScenarioProjection]
    insights: list[str]
    # Fidelity-methodology additions (all optional for backward compatibility)
    income_replacement_benchmark: float | None = None       # 85% of grown income in today's dollars
    income_replacement_benchmark_annual: float | None = None  # what 85% replacement means at retirement (nominal)
    savings_benchmark_amount: float | None = None           # Fidelity age-based milestone
    savings_benchmark_label: str | None = None              # e.g. "6× salary by age 50"
    healthcare_annual_cost: float | None = None             # projected healthcare at retirement
    ltc_total_estimated: float | None = None                # total LTC cost estimate (inflated)
    ss_delay_insight: str | None = None                     # "Delaying to 70 adds $X/yr"
    suggested_life_expectancy: int | None = None            # actuarial 75th-pct planning age


class YearlyPlanRow(BaseModel):
    year: int
    age: int
    spouse_age: int | None
    savings_start_of_year: float
    tax_deferred_savings: float = 0.0
    tax_exempt_savings: float = 0.0
    taxable_savings: float = 0.0
    essential_expenses: float
    non_essential_expenses: float
    healthcare_expenses: float = 0.0  # separately-tracked healthcare with higher inflation
    ltc_expenses: float = 0.0         # long-term care costs (within LTC window)
    estimated_taxes: float
    total_expenses: float
    earned_income: float
    dividend_interest_income: float = 0.0
    other_income: float
    total_income: float
    savings_withdrawals: float
    rmd_amount: float
    withdrawal_pct: float
    savings_end_of_year: float
    net_surplus_deficit: float


class YearlyPlanResponse(BaseModel):
    rows: list[YearlyPlanRow]
    anchored_to_return: bool = False
    tax_return_year: int | None = None
    tax_return_agi: float | None = None
    tax_return_w2: float | None = None
