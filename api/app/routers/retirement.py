"""Retirement planning endpoints — profile + projection.

Methodology aligned with Fidelity Retirement Guidance (fidelity.com/go/guidance/retirement-methodology):
  1. Monte Carlo probability (500 sims, σ=12%) replaces 3-scenario heuristic
  2. 85% income replacement benchmark with salary growth at inflation+1.5%
  3. Social Security delay credits (+8%/yr after FRA=67, early claiming penalty)
  4. Sequential withdrawal order: tax-deferred → taxable → Roth (tax-optimal)
  5. SECURE Act 2.0: RMD age 75 for birth year ≥ 1960, 73 otherwise
  6. Separate healthcare inflation (4.9% declining to general inflation floor)
  7. Long-term care cost modeling (configurable window, default age 82, 4 yrs, $100k/yr)
  8. Age-based savings benchmarks (Fidelity milestones: 1×→10× salary)
  9. Per-state income tax rates + Social Security exemption by state
 10. Actuarial life expectancy suggestion (SOA RP-2014, 75th percentile)
"""

import asyncio
import json
import random
import re
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account
from app.models.financial_document import FinancialDocument
from app.models.insurance import InsurancePolicy
from app.models.property import Property
from app.models.property_details import Loan
from app.models.rental import Lease, Unit
from app.models.retirement import RetirementProfile
from app.models.user import User
from app.schemas.retirement import (
    IncomeSource,
    RetirementAccountInfo,
    RetirementAccountSelectionUpdate,
    RetirementProfileCreate,
    RetirementProfileResponse,
    RetirementProfileUpdate,
    RetirementProjectionResponse,
    ScenarioProjection,
    YearlyPlanRow,
    YearlyPlanResponse,
    YearlyProjection,
)

router = APIRouter(prefix="/retirement", tags=["retirement"])

# ─── Account classification sets ────────────────────────────────────────────
TAX_DEFERRED_SUBTYPES = {
    "401k", "401a", "403b", "457b", "traditional ira", "ira",
    "sep ira", "simple ira", "pension", "profit sharing plan", "retirement",
}
TAX_EXEMPT_SUBTYPES = {
    "roth", "roth 401k", "roth ira", "non-taxable brokerage account",
}
RETIREMENT_SUBTYPES = TAX_DEFERRED_SUBTYPES | TAX_EXEMPT_SUBTYPES

SAFE_WITHDRAWAL_RATE = 0.04

# ── 2024 Federal income tax brackets ────────────────────────────────────────
_BRACKETS_MFJ: list[tuple[float, float]] = [
    (23_200,   0.10),
    (94_300,   0.12),
    (201_050,  0.22),
    (383_900,  0.24),
    (487_450,  0.32),
    (731_200,  0.35),
    (float("inf"), 0.37),
]
_BRACKETS_SINGLE: list[tuple[float, float]] = [
    (11_600,   0.10),
    (47_150,   0.12),
    (100_525,  0.22),
    (191_950,  0.24),
    (243_725,  0.32),
    (365_600,  0.35),
    (float("inf"), 0.37),
]
_STANDARD_DEDUCTION_MFJ = 29_200.0
_STANDARD_DEDUCTION_SINGLE = 14_600.0
_EXTRA_DEDUCTION_65 = 1_550.0

# Default state tax rate used when state is unknown
_STATE_TAX_RATE_DEFAULT = 0.05

# Per-state income tax rates (2024, top marginal / flat rate)
_STATE_TAX_RATES: dict[str, float] = {
    "AL": 0.050, "AK": 0.000, "AZ": 0.025, "AR": 0.047, "CA": 0.093,
    "CO": 0.044, "CT": 0.065, "DE": 0.066, "FL": 0.000, "GA": 0.055,
    "HI": 0.110, "ID": 0.058, "IL": 0.0495, "IN": 0.0305, "IA": 0.060,
    "KS": 0.057, "KY": 0.045, "LA": 0.042, "ME": 0.075, "MD": 0.0575,
    "MA": 0.050, "MI": 0.0425, "MN": 0.0985, "MS": 0.047, "MO": 0.048,
    "MT": 0.069, "NE": 0.0684, "NV": 0.000, "NH": 0.000, "NJ": 0.1075,
    "NM": 0.059, "NY": 0.0685, "NC": 0.045, "ND": 0.025, "OH": 0.035,
    "OK": 0.0475, "OR": 0.099, "PA": 0.0307, "RI": 0.0599, "SC": 0.065,
    "SD": 0.000, "TN": 0.000, "TX": 0.000, "UT": 0.0485, "VT": 0.0875,
    "VA": 0.0575, "WA": 0.000, "WV": 0.065, "WI": 0.0765, "WY": 0.000,
    "DC": 0.0895,
}

# States that exempt Social Security income from state income tax (41 states + DC)
_SS_EXEMPT_STATES: frozenset[str] = frozenset({
    "AK", "AL", "AZ", "AR", "CA", "DE", "FL", "GA", "HI", "ID", "IL",
    "IN", "IA", "KY", "LA", "ME", "MD", "MA", "MI", "MS", "NV", "NH",
    "NJ", "NY", "NC", "OH", "OK", "OR", "PA", "SC", "SD", "TN", "TX",
    "VA", "WA", "WY", "DC",
})

# Social Security taxability thresholds
_SS_THRESHOLD_LOW_MFJ    = 32_000.0
_SS_THRESHOLD_HIGH_MFJ   = 44_000.0
_SS_THRESHOLD_LOW_SINGLE  = 25_000.0
_SS_THRESHOLD_HIGH_SINGLE = 34_000.0

# IRS Uniform Lifetime Table (Publication 590-B, 2022) — RMD distribution periods
_RMD_FACTORS: dict[int, float] = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
    78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
    84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
    90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5,  95: 8.9,
    96: 8.4,  97: 7.8,  98: 7.3,  99: 6.8, 100: 6.4,
}

# Fidelity age-based savings benchmarks (multiple of annual salary)
_FIDELITY_BENCHMARKS: list[tuple[int, int]] = [
    (30, 1), (35, 2), (40, 3), (45, 4), (50, 6), (55, 7), (60, 8), (67, 10),
]

# Monte Carlo parameters
_MC_SIMULATIONS = 500
_MC_SIGMA = 0.12        # ~12% annual volatility for balanced 60/40 portfolio
_MC_SEED = 42

# Social Security full retirement age (for those born 1943+)
_SS_FULL_RETIREMENT_AGE = 67

# Income growth rate above inflation (Fidelity methodology: salary grows at inflation + 1.5%)
_SALARY_REAL_GROWTH = 0.015

# Default long-term care parameters when not set on profile
_LTC_DEFAULT_START_AGE = 82
_LTC_DEFAULT_YEARS = 4
_LTC_DEFAULT_ANNUAL_COST = 100_000.0

# Healthcare inflation starting rate (Fidelity: 4.9% declining toward general inflation)
_HEALTHCARE_INFLATION_START = 0.049
_HEALTHCARE_INFLATION_DECLINE_PER_YEAR = 0.001
# Default fraction of retirement expenses that are healthcare (when not explicitly set)
_HEALTHCARE_EXPENSE_FRACTION = 0.15


# ─── Tax helpers ────────────────────────────────────────────────────────────

def _federal_tax(taxable_income: float, married: bool) -> float:
    brackets = _BRACKETS_MFJ if married else _BRACKETS_SINGLE
    tax = 0.0
    prev = 0.0
    income = max(0.0, taxable_income)
    for cap, rate in brackets:
        if income <= prev:
            break
        taxable_slice = min(income, cap) - prev
        tax += taxable_slice * rate
        prev = cap
    return tax


def _ss_taxable_fraction(ss_income: float, other_income: float, married: bool) -> float:
    if ss_income <= 0:
        return 0.0
    provisional = other_income + ss_income * 0.50
    low  = _SS_THRESHOLD_LOW_MFJ   if married else _SS_THRESHOLD_LOW_SINGLE
    high = _SS_THRESHOLD_HIGH_MFJ  if married else _SS_THRESHOLD_HIGH_SINGLE
    if provisional <= low:
        return 0.0
    elif provisional <= high:
        return min(0.50, (provisional - low) / (ss_income * 2))
    else:
        return min(0.85, 0.50 + (provisional - high) / (ss_income * 2))


def _calc_taxes(
    earned: float,
    ss_income: float,
    other_non_ss: float,
    married: bool,
    age: int,
    spouse_age: int | None,
    state_abbr: str | None = None,
) -> float:
    """Estimate total income taxes (federal + state) using 2024 brackets."""
    std_deduction = _STANDARD_DEDUCTION_MFJ if married else _STANDARD_DEDUCTION_SINGLE
    if age >= 65:
        std_deduction += _EXTRA_DEDUCTION_65
    if married and spouse_age is not None and spouse_age >= 65:
        std_deduction += _EXTRA_DEDUCTION_65

    taxable_ss = ss_income * _ss_taxable_fraction(ss_income, earned + other_non_ss, married)
    gross_income = earned + taxable_ss + other_non_ss
    taxable_income = max(0.0, gross_income - std_deduction)

    federal = _federal_tax(taxable_income, married)

    # State tax: use state-specific rate; SS-exempt states exclude SS from state base
    state_rate = _STATE_TAX_RATES.get(state_abbr or "", _STATE_TAX_RATE_DEFAULT)
    if state_abbr in _SS_EXEMPT_STATES:
        state_base = earned + other_non_ss
    else:
        state_base = gross_income
    state_tax = state_base * state_rate

    return federal + state_tax


# ─── Monte Carlo probability ────────────────────────────────────────────────

def _monte_carlo_probability(
    starting_assets: float,
    annual_contribution: float,
    years_to_retirement: int,
    base_return: float,
    inflation_rate: float,
    desired_annual_income: float,
    life_years_in_retirement: int,
) -> float:
    """
    Monte Carlo probability of success (portfolio survival through retirement).
    Works in real (inflation-adjusted) dollars with fixed seed for reproducibility.
    """
    if desired_annual_income <= 0 or life_years_in_retirement <= 0:
        return 99.0
    if starting_assets <= 0 and annual_contribution <= 0 and years_to_retirement > 0:
        return 1.0

    r_real = max(0.001, base_return - inflation_rate)
    rng = random.Random(_MC_SEED)
    successes = 0

    for _ in range(_MC_SIMULATIONS):
        portfolio = starting_assets
        # Accumulation phase (real dollars; contributions constant in real terms)
        for _ in range(years_to_retirement):
            r_sim = rng.gauss(r_real, _MC_SIGMA)
            portfolio = max(0.0, (portfolio + annual_contribution) * (1 + r_sim))
        # Distribution phase (constant real withdrawal each year)
        survived = True
        for _ in range(life_years_in_retirement):
            r_sim = rng.gauss(r_real, _MC_SIGMA)
            portfolio = portfolio * (1 + r_sim) - desired_annual_income
            if portfolio <= 0:
                survived = False
                break
        if survived:
            successes += 1

    return round(successes / _MC_SIMULATIONS * 100, 1)


# ─── Social Security delay credits ──────────────────────────────────────────

def _apply_ss_delay_credits(base_monthly_estimate: float, ss_start_age: int | None) -> float:
    """
    Adjust SS benefit for claiming age relative to FRA=67.
    Assumes base_monthly_estimate is the benefit at FRA (67).
    - After 67: +8%/yr up to 70 (delayed retirement credits)
    - Before 67: IRS early claiming reduction (~5/9% per month for first 36 months,
      5/12% per month beyond)
    """
    if base_monthly_estimate <= 0 or ss_start_age is None:
        return base_monthly_estimate
    if ss_start_age == _SS_FULL_RETIREMENT_AGE:
        return base_monthly_estimate
    if ss_start_age > _SS_FULL_RETIREMENT_AGE:
        delay_years = min(ss_start_age, 70) - _SS_FULL_RETIREMENT_AGE
        return base_monthly_estimate * (1.0 + 0.08 * delay_years)
    # Early claiming reduction
    early_months = (_SS_FULL_RETIREMENT_AGE - max(62, ss_start_age)) * 12
    if early_months <= 36:
        reduction = early_months * (5.0 / 9.0 / 100.0)
    else:
        reduction = 36 * (5.0 / 9.0 / 100.0) + (early_months - 36) * (5.0 / 12.0 / 100.0)
    return base_monthly_estimate * (1.0 - reduction)


# ─── Income replacement benchmark (Fidelity 85% rule) ──────────────────────

def _income_replacement_benchmark(
    yearly_income: float,
    years_to_retirement: int,
    inflation_rate: float,
) -> tuple[float, float]:
    """
    Returns (real_benchmark, nominal_benchmark).
    real_benchmark: 85% replacement in today's dollars
    nominal_benchmark: 85% replacement in retirement-year dollars
    Replacement rate adjusted by income level (Fidelity methodology).
    Income grown at inflation + 1.5% to retirement.
    """
    if yearly_income <= 0:
        return 0.0, 0.0
    if yearly_income > 200_000:
        replacement_rate = 0.80
    elif yearly_income < 50_000:
        replacement_rate = 0.90
    else:
        replacement_rate = 0.85
    nominal = yearly_income * (1.0 + inflation_rate + _SALARY_REAL_GROWTH) ** years_to_retirement
    nominal_benchmark = nominal * replacement_rate
    # Convert to today's dollars (remove inflation component)
    real_benchmark = yearly_income * (1.0 + _SALARY_REAL_GROWTH) ** years_to_retirement * replacement_rate
    return real_benchmark, nominal_benchmark


# ─── Age-based savings benchmark (Fidelity milestones) ──────────────────────

def _get_savings_benchmark(age: int, yearly_income: float) -> tuple[float, str]:
    """Return (benchmark_amount, label) for the current Fidelity savings milestone."""
    if yearly_income <= 0:
        return 0.0, ""
    for milestone_age, multiplier in _FIDELITY_BENCHMARKS:
        if age <= milestone_age:
            return yearly_income * multiplier, f"{multiplier}× your salary by age {milestone_age}"
    return yearly_income * 10, "10× your salary (retirement target)"


# ─── Actuarial life expectancy suggestion ───────────────────────────────────

def _suggested_life_expectancy(birth_year: int, gender: str | None) -> int:
    """
    75th-percentile planning age from simplified SOA RP-2014 Healthy Annuitants table.
    25% of people survive past this age — use as a conservative planning horizon.
    """
    is_female = (gender or "").lower() in ("female", "f", "woman")
    base = 90 if is_female else 87
    if birth_year >= 1965:
        base += 2
    elif birth_year >= 1955:
        base += 1
    elif birth_year < 1945:
        base -= 1
    return base


# ─── Healthcare inflation ────────────────────────────────────────────────────

def _healthcare_inflation_factor(years_since_retirement: int, base_inflation: float) -> float:
    """Cumulative healthcare inflation factor from retirement year."""
    factor = 1.0
    for y in range(years_since_retirement):
        annual_rate = max(base_inflation, _HEALTHCARE_INFLATION_START - _HEALTHCARE_INFLATION_DECLINE_PER_YEAR * y)
        factor *= (1.0 + annual_rate)
    return factor


# ─── Insights generator ──────────────────────────────────────────────────────

def _generate_insights(
    gap: float,
    monthly_needed: float,
    retirement_assets: float,
    total_net_worth: float,
    on_track_pct: float,
    years_to_retirement: int,
    has_life_insurance: bool,
    desired_annual_income: float,
    annual_contribution: float,
    probability_of_success: float,
    include_spouse: bool = False,
    ss_delay_insight: str | None = None,
    ltc_total_estimated: float | None = None,
) -> list[str]:
    insights = []

    if gap > 0 and monthly_needed > 0:
        insights.append(
            f"To close your retirement gap, aim to save an additional "
            f"${monthly_needed:,.0f}/month in your retirement accounts."
        )
    elif gap <= 0:
        surplus = abs(gap)
        insights.append(
            f"Great news — you're projected to exceed your retirement target by "
            f"${surplus:,.0f}. Consider whether you could retire earlier or leave a legacy."
        )

    if total_net_worth > 0:
        ret_pct = (retirement_assets / total_net_worth) * 100
        if ret_pct < 20 and years_to_retirement > 10:
            insights.append(
                f"Only {ret_pct:.0f}% of your net worth is in tax-advantaged retirement accounts. "
                f"Consider maximizing IRA and 401(k) contributions to reduce your tax burden."
            )
        elif ret_pct > 80:
            insights.append(
                f"{ret_pct:.0f}% of your net worth is in retirement accounts — excellent tax efficiency. "
                f"Ensure you also have accessible taxable savings for pre-retirement flexibility."
            )

    if probability_of_success >= 90:
        insights.append(
            f"Your Monte Carlo analysis shows a {probability_of_success:.0f}% probability of success "
            f"across 500 simulated market scenarios — well-positioned even in below-average markets."
        )
    elif probability_of_success >= 65:
        insights.append(
            f"Your plan shows a {probability_of_success:.0f}% probability of success (Monte Carlo, 500 simulations). "
            f"Increasing contributions modestly could push this above 90%."
        )
    else:
        insights.append(
            f"Your plan shows a {probability_of_success:.0f}% probability of success (Monte Carlo, 500 simulations). "
            f"Consider boosting savings by ${annual_contribution * 0.15:,.0f}/year to improve your outlook."
        )

    if ltc_total_estimated and ltc_total_estimated > 0:
        insights.append(
            f"Long-term care costs of ~${ltc_total_estimated:,.0f} are estimated in your plan. "
            f"Consider long-term care insurance to protect your portfolio from this risk."
        )
    elif not has_life_insurance and desired_annual_income > 0:
        recommended_coverage = desired_annual_income * 10
        insights.append(
            f"Consider life insurance coverage of at least ${recommended_coverage:,.0f} "
            f"(10× your desired retirement income) to protect your household."
        )

    if ss_delay_insight:
        insights.append(ss_delay_insight)
    elif include_spouse:
        insights.append(
            "This is a combined household plan. Both spouses' contributions and Social Security "
            "estimates are included. Consider coordinating retirement dates to maximize benefits."
        )
    else:
        insights.append(
            "Your projections use the 4% safe withdrawal rule — a widely-used guideline meaning "
            "you can withdraw 4% of your portfolio annually in retirement with a high probability "
            "of not outliving your savings."
        )

    return insights[:5]


# ─── Tax return parsing ─────────────────────────────────────────────────────

def _parse_1040_fields(text: str) -> "dict | None":
    fields: dict = {}

    for pattern in [
        r"Tax Year\s+(\d{4})",
        r"For the year Jan\..*?(\d{4})",
        r"Income Tax Return.*?(\d{4})",
    ]:
        m = re.search(pattern, text)
        if m:
            yr = int(m.group(1))
            if 2000 <= yr <= 2035:
                fields["tax_year"] = yr
                break

    m = re.search(r"Adjusted gross income\s+1\s+([\d,]+)\.", text)
    if m:
        fields["agi"] = float(m.group(1).replace(",", ""))
    else:
        m = re.search(r"([\d,]+)\.\s*\n[^\n]*11a\s+Subtract line 10", text)
        if m:
            fields["agi"] = float(m.group(1).replace(",", ""))

    m = re.search(r"Total tax\s+2\s+([\d,]+)\.", text)
    if m:
        fields["total_federal_tax"] = float(m.group(1).replace(",", ""))

    m = re.search(r"([\d,]+)\.\s*\n[^\n]*z\s+Add lines 1a", text)
    if not m:
        m = re.search(r"([\d,]+)\.\s*\n[^\n]*Income 1a Total amount", text)
    if m:
        fields["w2_wages"] = float(m.group(1).replace(",", ""))

    div = None
    m = re.search(r"Ordinary dividends \(see instructions\) 2\s+([\d,]+)\.", text)
    if m:
        div = float(m.group(1).replace(",", ""))
    else:
        m = re.search(r"line 3b\s+6\s+([\d,]+)\.", text)
        if m:
            div = float(m.group(1).replace(",", ""))

    interest = None
    m = re.search(r"Taxable interest \(see instructions\) 1\s+([\d,]+)\.", text)
    if m:
        interest = float(m.group(1).replace(",", ""))
    else:
        m = re.search(r"line 2b\s+4\s+([\d,]+)\.", text)
        if m:
            interest = float(m.group(1).replace(",", ""))

    if div is not None or interest is not None:
        fields["div_interest"] = (div or 0.0) + (interest or 0.0)

    if "agi" in fields and "total_federal_tax" in fields:
        return fields
    return None


async def _load_latest_1040(db: AsyncSession, household_id) -> "dict | None":
    result = await db.execute(
        select(FinancialDocument.extracted_text, FinancialDocument.reference_year)
        .where(
            FinancialDocument.household_id == household_id,
            FinancialDocument.document_type == "tax",
            FinancialDocument.category == "1040",
            FinancialDocument.extracted_text.isnot(None),
        )
        .order_by(FinancialDocument.reference_year.desc())
        .limit(1)
    )
    row = result.first()
    if not row or not row.extracted_text:
        return None
    fields = _parse_1040_fields(row.extracted_text)
    if fields is not None and "tax_year" not in fields and row.reference_year:
        fields["tax_year"] = row.reference_year
    return fields


# ─── Shared DB helpers ──────────────────────────────────────────────────────

def _parse_manual_ids(profile: RetirementProfile) -> "set[str] | None":
    if not profile.retirement_account_ids:
        return None
    try:
        return set(json.loads(profile.retirement_account_ids))
    except Exception:
        return None


async def _load_account_totals(
    db: AsyncSession,
    household_id,
    manual_ids: "set[str] | None",
) -> "tuple[float, float, float, float, float, float, float]":
    rows = (await db.execute(
        select(Account.id, Account.type, Account.subtype, Account.current_balance).where(
            Account.household_id == household_id,
            Account.is_hidden == False,  # noqa: E712
        )
    )).all()

    retirement = tax_deferred = tax_exempt = taxable_inv = 0.0
    total_inv = total_cash = credit_debt = 0.0

    for acc_id, acc_type, acc_subtype, acc_bal in rows:
        bal = float(acc_bal or 0)
        subtype = (acc_subtype or "").lower()
        acc_id_str = str(acc_id)

        if acc_type in ("investment", "brokerage"):
            total_inv += bal
            if manual_ids is not None:
                if acc_id_str in manual_ids:
                    if subtype in TAX_DEFERRED_SUBTYPES:
                        tax_deferred += bal
                    elif subtype in TAX_EXEMPT_SUBTYPES:
                        tax_exempt += bal
                    else:
                        taxable_inv += bal
                    retirement += bal
            else:
                if subtype in TAX_DEFERRED_SUBTYPES:
                    tax_deferred += bal
                    retirement += bal
                elif subtype in TAX_EXEMPT_SUBTYPES:
                    tax_exempt += bal
                    retirement += bal
                else:
                    taxable_inv += bal
        elif acc_type == "depository":
            total_cash += bal
        elif acc_type == "credit":
            credit_debt += bal

    return retirement, tax_deferred, tax_exempt, taxable_inv, total_inv, total_cash, credit_debt


async def _load_real_estate_totals(
    db: AsyncSession,
    household_id,
) -> "tuple[float, float]":
    loan_subq = (
        select(
            Loan.property_id,
            func.sum(Loan.current_balance).label("total_balance"),
        )
        .group_by(Loan.property_id)
        .subquery()
    )
    row = (await db.execute(
        select(
            func.coalesce(func.sum(Property.current_value), 0).label("total_value"),
            func.coalesce(func.sum(loan_subq.c.total_balance), 0).label("total_loans"),
        )
        .outerjoin(loan_subq, loan_subq.c.property_id == Property.id)
        .where(Property.household_id == household_id)
    )).one()
    return float(row.total_value), float(row.total_loans)


async def _load_rental_income_annual(
    db: AsyncSession,
    household_id,
) -> float:
    monthly = (await db.execute(
        select(func.coalesce(func.sum(Lease.monthly_rent), 0))
        .join(Unit, Lease.unit_id == Unit.id)
        .join(Property, Unit.property_id == Property.id)
        .where(
            Property.household_id == household_id,
            Lease.status == "active",
        )
    )).scalar()
    return float(monthly) * 12


async def _load_has_life_insurance(db: AsyncSession, household_id) -> bool:
    result = await db.execute(
        select(InsurancePolicy.id).where(
            InsurancePolicy.household_id == household_id,
            InsurancePolicy.policy_type.in_(["life_term", "life_whole", "life_universal"]),
            InsurancePolicy.is_active == True,  # noqa: E712
        ).limit(1)
    )
    return result.scalar() is not None


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/profile")
async def get_retirement_profile(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RetirementProfile).where(
            RetirementProfile.household_id == user.household_id
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return {"has_profile": False}
    return RetirementProfileResponse.model_validate(profile)


@router.put("/profile", response_model=RetirementProfileResponse)
async def upsert_retirement_profile(
    body: RetirementProfileCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RetirementProfile).where(
            RetirementProfile.household_id == user.household_id
        )
    )
    profile = result.scalar_one_or_none()

    data = {
        k: v for k, v in body.model_dump(exclude_unset=False).items()
        if k != "retirement_account_ids"
    }

    if profile:
        for field, value in data.items():
            setattr(profile, field, value)
        profile.updated_at = datetime.now(timezone.utc)
    else:
        profile = RetirementProfile(household_id=user.household_id, **data)
        db.add(profile)

    await db.flush()
    await db.refresh(profile)
    return RetirementProfileResponse.model_validate(profile)


@router.get("/accounts", response_model=list[RetirementAccountInfo])
async def list_retirement_accounts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Account).where(
            Account.household_id == user.household_id,
            Account.is_hidden == False,  # noqa: E712
        ).order_by(Account.institution_name, Account.name)
    )
    accounts = result.scalars().all()

    profile_result = await db.execute(
        select(RetirementProfile).where(RetirementProfile.household_id == user.household_id)
    )
    profile = profile_result.scalar_one_or_none()
    selected_ids: set[str] = set()
    has_manual_selection = False
    if profile and profile.retirement_account_ids:
        try:
            ids = json.loads(profile.retirement_account_ids)
            selected_ids = set(ids)
            has_manual_selection = True
        except Exception:
            pass

    items: list[RetirementAccountInfo] = []
    for acc in accounts:
        subtype = (acc.subtype or "").lower()
        acc_type = (acc.type or "").lower()

        if acc_type not in ("investment", "brokerage"):
            tax_treatment = "non_investment"
            is_auto = False
        elif subtype in TAX_DEFERRED_SUBTYPES:
            tax_treatment = "tax_deferred"
            is_auto = True
        elif subtype in TAX_EXEMPT_SUBTYPES:
            tax_treatment = "tax_exempt"
            is_auto = True
        else:
            tax_treatment = "taxable"
            is_auto = False

        acc_id = str(acc.id)
        is_selected = selected_ids.__contains__(acc_id) if has_manual_selection else is_auto

        items.append(RetirementAccountInfo(
            id=acc_id,
            name=acc.name,
            institution_name=acc.institution_name,
            type=acc.type,
            subtype=acc.subtype,
            current_balance=float(acc.current_balance or 0),
            tax_treatment=tax_treatment,
            is_auto_included=is_auto,
            is_selected=is_selected,
            is_manual_mode=has_manual_selection,
        ))

    return items


@router.put("/accounts/selection", response_model=RetirementProfileResponse)
async def update_account_selection(
    body: RetirementAccountSelectionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RetirementProfile).where(RetirementProfile.household_id == user.household_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No retirement profile found.")

    profile.retirement_account_ids = (
        json.dumps(body.account_ids) if body.account_ids is not None else None
    )
    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    await db.commit()
    return RetirementProfileResponse.model_validate(profile)


@router.get("/projection", response_model=RetirementProjectionResponse)
async def get_retirement_projection(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RetirementProfile).where(
            RetirementProfile.household_id == user.household_id
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No retirement profile found. Please set up your profile first.")

    current_year = datetime.now(timezone.utc).year
    current_age = current_year - profile.birth_year
    years_to_retirement = max(0, profile.retirement_age - current_age)

    r = float(profile.expected_return_rate)
    inflation_r = float(profile.inflation_rate)
    n = years_to_retirement

    # Combine contributions
    annual_contribution = float(profile.annual_contribution)
    if profile.include_spouse and profile.spouse_annual_contribution:
        annual_contribution += float(profile.spouse_annual_contribution)

    # Effective target income
    monthly_expenses_total = 0.0
    if profile.monthly_essential_expenses or profile.monthly_non_essential_expenses:
        monthly_expenses_total = (
            float(profile.monthly_essential_expenses or 0)
            + float(profile.monthly_non_essential_expenses or 0)
        )
        desired_income = monthly_expenses_total * 12
    else:
        desired_income = float(profile.desired_annual_income)

    # Load all DB aggregates concurrently
    manual_ids = _parse_manual_ids(profile)
    (
        (
            retirement_assets,
            tax_deferred_balance,
            tax_exempt_balance,
            taxable_investment_balance,
            total_investment_assets,
            total_cash,
            credit_debt,
        ),
        (total_real_estate, total_mortgage),
        rental_income,
        has_life_insurance,
    ) = await asyncio.gather(
        _load_account_totals(db, user.household_id, manual_ids),
        _load_real_estate_totals(db, user.household_id),
        _load_rental_income_annual(db, user.household_id),
        _load_has_life_insurance(db, user.household_id),
    )

    real_estate_equity = max(0.0, total_real_estate - total_mortgage)
    total_net_worth = total_cash + total_investment_assets + total_real_estate - credit_debt - total_mortgage

    swr = float(profile.safe_withdrawal_rate) if profile.safe_withdrawal_rate else SAFE_WITHDRAWAL_RATE
    target = desired_income / swr

    r_pess_nom = max(0.01, r - 0.02)
    r_opt_nom  = r + 0.03

    # Three-scenario chart projections (nominal → today's dollars)
    s_opt = s_base = s_pess = retirement_assets
    scenario_projections: list[ScenarioProjection] = []
    yearly_projections: list[YearlyProjection] = []
    for i in range(n + 1):
        inf_factor = (1 + inflation_r) ** i
        age_i = current_age + i
        req_i = (target / n * i) if n > 0 else target
        scenario_projections.append(ScenarioProjection(
            year=current_year + i,
            age=age_i,
            optimistic=round(s_opt / inf_factor, 2),
            base=round(s_base / inf_factor, 2),
            pessimistic=round(s_pess / inf_factor, 2),
            required=round(req_i, 2),
        ))
        yearly_projections.append(YearlyProjection(
            year=current_year + i,
            age=age_i,
            projected=round(s_base / inf_factor, 2),
            required=round(req_i, 2),
        ))
        if i < n:
            s_opt  = (s_opt  + annual_contribution) * (1 + r_opt_nom)
            s_base = (s_base + annual_contribution) * (1 + r)
            s_pess = (s_pess + annual_contribution) * (1 + r_pess_nom)

    inf_n = (1 + inflation_r) ** n
    projected_pessimistic = s_pess / inf_n
    projected_base        = s_base / inf_n
    projected_optimistic  = s_opt  / inf_n

    projected = projected_base
    gap = target - projected
    on_track_pct = min(200.0, (projected / target * 100) if target > 0 else 0.0)

    # ── Monte Carlo probability (replaces 3-scenario heuristic) ──────────────
    life_years_in_retirement = max(1, profile.life_expectancy_age - profile.retirement_age)
    if profile.include_spouse and profile.spouse_life_expectancy_age and profile.spouse_retirement_age:
        spouse_life_years = max(1, profile.spouse_life_expectancy_age - profile.spouse_retirement_age)
        life_years_in_retirement = max(life_years_in_retirement, spouse_life_years)

    probability = _monte_carlo_probability(
        starting_assets=retirement_assets,
        annual_contribution=annual_contribution,
        years_to_retirement=n,
        base_return=r,
        inflation_rate=inflation_r,
        desired_annual_income=desired_income,
        life_years_in_retirement=life_years_in_retirement,
    )

    # Required extra annual saving
    r_base_real = (1 + r) / (1 + inflation_r) - 1
    if gap > 0 and n > 0 and r_base_real > 0:
        required_extra_annual = gap / (((1 + r_base_real) ** n - 1) / r_base_real)
    else:
        required_extra_annual = 0.0
    monthly_needed = required_extra_annual / 12

    # ── Income sources ────────────────────────────────────────────────────────
    income_sources: list[IncomeSource] = []

    portfolio_income = projected * swr
    income_sources.append(IncomeSource(
        label=f"Portfolio Withdrawals ({swr * 100:.1f}% SWR)",
        annual_amount=round(portfolio_income, 2),
        source_type="portfolio",
    ))

    # Apply SS delay credits for income source display
    ss_monthly_base = float(profile.social_security_estimate or 0)
    ss_adjusted = _apply_ss_delay_credits(ss_monthly_base, profile.social_security_start_age)
    if ss_adjusted > 0:
        income_sources.append(IncomeSource(
            label="Social Security",
            annual_amount=round(ss_adjusted, 2),
            source_type="social_security",
        ))
    if profile.include_spouse and profile.spouse_social_security_estimate:
        spouse_ss_base = float(profile.spouse_social_security_estimate)
        spouse_ss_adjusted = _apply_ss_delay_credits(spouse_ss_base, profile.spouse_social_security_start_age)
        if spouse_ss_adjusted > 0:
            income_sources.append(IncomeSource(
                label="Spouse Social Security",
                annual_amount=round(spouse_ss_adjusted, 2),
                source_type="social_security",
            ))

    if rental_income > 0:
        income_sources.append(IncomeSource(
            label="Rental Income",
            annual_amount=round(rental_income, 2),
            source_type="rental",
        ))

    re_income = real_estate_equity * swr
    if re_income > 0:
        income_sources.append(IncomeSource(
            label="Real Estate Equity Income",
            annual_amount=round(re_income, 2),
            source_type="real_estate",
        ))

    # ── Fidelity methodology additions ───────────────────────────────────────

    # Income replacement benchmark
    yearly_income = float(profile.yearly_income or 0)
    if profile.include_spouse and profile.spouse_yearly_income:
        yearly_income += float(profile.spouse_yearly_income)
    irb_real, irb_nominal = _income_replacement_benchmark(yearly_income, n, inflation_r)
    income_replacement_benchmark = round(irb_real, 2) if irb_real > 0 else None
    income_replacement_benchmark_annual = round(irb_nominal, 2) if irb_nominal > 0 else None

    # Age-based savings benchmark
    bench_amount, bench_label = _get_savings_benchmark(current_age, yearly_income)
    savings_benchmark_amount = round(bench_amount, 2) if bench_amount > 0 else None
    savings_benchmark_label = bench_label or None

    # Healthcare cost projection at retirement (in retirement-year dollars)
    if profile.monthly_healthcare_expenses:
        hc_base = float(profile.monthly_healthcare_expenses) * 12
        hc_factor = _healthcare_inflation_factor(0, inflation_r)  # at retirement year
        healthcare_annual_cost = round(hc_base * hc_factor, 2)
    else:
        # Default: 15% of total retirement expenses, inflated at higher healthcare rate
        total_retirement_expenses = desired_income
        healthcare_annual_cost = round(total_retirement_expenses * _HEALTHCARE_EXPENSE_FRACTION, 2)

    # LTC total estimated cost (inflated to start age)
    if profile.long_term_care_start_age or profile.long_term_care_annual_cost:
        ltc_start_age = profile.long_term_care_start_age or _LTC_DEFAULT_START_AGE
        ltc_years = profile.long_term_care_years or _LTC_DEFAULT_YEARS
        ltc_annual = float(profile.long_term_care_annual_cost or _LTC_DEFAULT_ANNUAL_COST)
        years_to_ltc = max(0, ltc_start_age - current_age)
        ltc_inf = (1 + inflation_r) ** years_to_ltc
        ltc_total_estimated: float | None = round(ltc_annual * ltc_inf * ltc_years, 2)
    else:
        ltc_total_estimated = None

    # SS delay insight
    ss_delay_insight: str | None = None
    if ss_monthly_base > 0 and (profile.social_security_start_age is None or profile.social_security_start_age < 70):
        at_70 = _apply_ss_delay_credits(ss_monthly_base, 70)
        current_claiming = _apply_ss_delay_credits(
            ss_monthly_base,
            profile.social_security_start_age or max(62, profile.retirement_age)
        )
        annual_gain = (at_70 - current_claiming) * 12 if current_claiming != at_70 else 0
        if annual_gain > 100:
            ss_delay_insight = (
                f"Delaying Social Security to age 70 would increase your annual benefit "
                f"by ~${annual_gain:,.0f}/year compared to your current claiming age."
            )

    # Actuarial life expectancy suggestion
    suggested_le = _suggested_life_expectancy(profile.birth_year, profile.gender)

    # ── Insights ──────────────────────────────────────────────────────────────
    insights = _generate_insights(
        gap=gap,
        monthly_needed=monthly_needed,
        retirement_assets=retirement_assets,
        total_net_worth=total_net_worth,
        on_track_pct=on_track_pct,
        years_to_retirement=n,
        has_life_insurance=has_life_insurance,
        desired_annual_income=desired_income,
        annual_contribution=annual_contribution,
        probability_of_success=probability,
        include_spouse=profile.include_spouse,
        ss_delay_insight=ss_delay_insight,
        ltc_total_estimated=ltc_total_estimated,
    )

    return RetirementProjectionResponse(
        profile=RetirementProfileResponse.model_validate(profile),
        current_age=current_age,
        years_to_retirement=n,
        current_retirement_assets=round(retirement_assets, 2),
        total_net_worth=round(total_net_worth, 2),
        retirement_wealth_target=round(target, 2),
        projected_wealth_at_retirement=round(projected_base, 2),
        pessimistic_wealth_at_retirement=round(projected_pessimistic, 2),
        optimistic_wealth_at_retirement=round(projected_optimistic, 2),
        gap=round(gap, 2),
        required_additional_annual_saving=round(required_extra_annual, 2),
        monthly_saving_needed=round(monthly_needed, 2),
        on_track_pct=round(on_track_pct, 1),
        probability_of_success=round(probability, 1),
        probability_method="monte_carlo",
        tax_deferred_balance=round(tax_deferred_balance, 2),
        taxable_investment_balance=round(taxable_investment_balance, 2),
        tax_exempt_balance=round(tax_exempt_balance, 2),
        total_monthly_expenses=round(monthly_expenses_total, 2),
        income_sources=income_sources,
        yearly_projections=yearly_projections,
        scenario_projections=scenario_projections,
        insights=insights,
        income_replacement_benchmark=income_replacement_benchmark,
        income_replacement_benchmark_annual=income_replacement_benchmark_annual,
        savings_benchmark_amount=savings_benchmark_amount,
        savings_benchmark_label=savings_benchmark_label,
        healthcare_annual_cost=healthcare_annual_cost,
        ltc_total_estimated=ltc_total_estimated,
        ss_delay_insight=ss_delay_insight,
        suggested_life_expectancy=suggested_le,
    )


@router.get("/yearly-plan", response_model=YearlyPlanResponse)
async def get_yearly_plan(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Year-by-year retirement cashflow plan from current age to life expectancy."""
    result = await db.execute(
        select(RetirementProfile).where(RetirementProfile.household_id == user.household_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No retirement profile found. Please set up your profile first.")

    current_year = datetime.now(timezone.utc).year
    current_age = current_year - profile.birth_year
    base_rate = float(profile.expected_return_rate)
    inflation_r = float(profile.inflation_rate)
    retirement_age = profile.retirement_age
    life_exp_age = profile.life_expectancy_age
    if profile.include_spouse and profile.spouse_birth_year and profile.spouse_life_expectancy_age:
        spouse_current_age = current_year - profile.spouse_birth_year
        spouse_plan_end_age = profile.spouse_life_expectancy_age
        spouse_end_year = current_year + (spouse_plan_end_age - spouse_current_age)
        end_year = max(current_year + (life_exp_age - current_age), spouse_end_year)
    else:
        end_year = current_year + (life_exp_age - current_age)

    # ── SECURE Act 2.0: RMD start age ────────────────────────────────────────
    rmd_start_age = 75 if profile.birth_year >= 1960 else 73

    # ── Expense basis ─────────────────────────────────────────────────────────
    if profile.monthly_essential_expenses or profile.monthly_non_essential_expenses:
        essential_base = float(profile.monthly_essential_expenses or 0) * 12
        non_essential_base = float(profile.monthly_non_essential_expenses or 0) * 12
    else:
        essential_base = float(profile.desired_annual_income) * 0.60
        non_essential_base = float(profile.desired_annual_income) * 0.40

    # Healthcare: separate component with higher inflation
    if profile.monthly_healthcare_expenses:
        healthcare_base = float(profile.monthly_healthcare_expenses) * 12
        # Remove healthcare from non-essential to avoid double-counting
        non_essential_base = max(0.0, non_essential_base - healthcare_base)
    else:
        # Default: 15% of total retirement expenses, extracted from non-essential
        total_base = essential_base + non_essential_base
        healthcare_base = total_base * _HEALTHCARE_EXPENSE_FRACTION
        non_essential_base = max(0.0, non_essential_base - healthcare_base)

    # ── LTC parameters ────────────────────────────────────────────────────────
    ltc_enabled = bool(
        profile.long_term_care_start_age
        or profile.long_term_care_years
        or profile.long_term_care_annual_cost
    )
    ltc_start_age = profile.long_term_care_start_age or _LTC_DEFAULT_START_AGE
    ltc_end_age = ltc_start_age + (profile.long_term_care_years or _LTC_DEFAULT_YEARS)
    ltc_annual_base = float(profile.long_term_care_annual_cost or _LTC_DEFAULT_ANNUAL_COST)

    # ── Income inputs ─────────────────────────────────────────────────────────
    yearly_income_base = float(profile.yearly_income or 0)
    spouse_yearly_income_base = float(profile.spouse_yearly_income or 0) if profile.include_spouse else 0.0

    # SS with delay credits applied
    ss_start_age = profile.social_security_start_age or max(62, retirement_age)
    ss_monthly_base = float(profile.social_security_estimate or 0)
    ss_effective_monthly = _apply_ss_delay_credits(ss_monthly_base, profile.social_security_start_age)
    ss_annual_base = ss_effective_monthly * 12

    spouse_ss_annual_base = 0.0
    spouse_ss_start_age = max(62, profile.spouse_retirement_age or 65)
    if profile.include_spouse and profile.spouse_social_security_estimate:
        spouse_ss_start_age = profile.spouse_social_security_start_age or max(62, profile.spouse_retirement_age or 65)
        spouse_ss_effective = _apply_ss_delay_credits(
            float(profile.spouse_social_security_estimate),
            profile.spouse_social_security_start_age,
        )
        spouse_ss_annual_base = spouse_ss_effective * 12

    annual_contribution = float(profile.annual_contribution)
    if profile.include_spouse and profile.spouse_annual_contribution:
        annual_contribution += float(profile.spouse_annual_contribution)

    # ── Load retirement assets, rental income, and latest 1040 ───────────────
    manual_ids = _parse_manual_ids(profile)
    (
        (retirement_assets, tax_deferred_balance, tax_exempt_balance, taxable_investment_balance, *_),
        rental_income_annual,
        tax_return,
    ) = await asyncio.gather(
        _load_account_totals(db, user.household_id, manual_ids),
        _load_rental_income_annual(db, user.household_id),
        _load_latest_1040(db, user.household_id),
    )

    # ── Tax return anchor ─────────────────────────────────────────────────────
    anchored_to_return = False
    tax_return_year: int | None = None
    tax_return_agi: float | None = None
    tax_return_w2: float | None = None
    effective_working_tax_rate: float | None = None
    div_interest_annual = 0.0

    if tax_return:
        agi = tax_return.get("agi", 0.0)
        total_federal_tax = tax_return.get("total_federal_tax", 0.0)
        w2 = tax_return.get("w2_wages")
        tr_year = tax_return.get("tax_year", current_year - 1)

        if agi > 0 and total_federal_tax > 0:
            anchored_to_return = True
            tax_return_year = tr_year
            tax_return_agi = agi
            tax_return_w2 = w2

            gap_years = current_year - tr_year
            div_interest_from_return = tax_return.get("div_interest", 0.0)
            div_interest_annual = div_interest_from_return * ((1 + inflation_r) ** gap_years)
            anchored_earned = max(0.0, agi - rental_income_annual - div_interest_from_return) * ((1 + inflation_r) ** gap_years)
            if profile.include_spouse and profile.spouse_birth_year:
                total_profile_income = float(profile.yearly_income or 0) + float(profile.spouse_yearly_income or 0)
                user_ratio = (float(profile.yearly_income or 0) / total_profile_income) if total_profile_income > 0 else 0.5
                yearly_income_base = anchored_earned * user_ratio
                spouse_yearly_income_base = anchored_earned * (1 - user_ratio)
            else:
                yearly_income_base = anchored_earned

            effective_federal_rate = total_federal_tax / agi
            effective_working_tax_rate = effective_federal_rate + _STATE_TAX_RATES.get(
                profile.state or "", _STATE_TAX_RATE_DEFAULT
            )

    # ── Per-bucket annual contributions ──────────────────────────────────────
    contrib_401k = float(profile.annual_contribution_401k or 0)
    contrib_roth = float(profile.annual_contribution_roth or 0)
    contrib_taxable = max(0.0, float(profile.annual_contribution) - contrib_401k - contrib_roth)
    if profile.include_spouse and profile.spouse_annual_contribution:
        contrib_401k += float(profile.spouse_annual_contribution_401k or 0)
        contrib_roth += float(profile.spouse_annual_contribution_roth or 0)
        s_tx = max(
            0.0,
            float(profile.spouse_annual_contribution)
            - float(profile.spouse_annual_contribution_401k or 0)
            - float(profile.spouse_annual_contribution_roth or 0),
        )
        contrib_taxable += s_tx

    # Mutable per-bucket state
    td = tax_deferred_balance
    te = tax_exempt_balance
    tx = taxable_investment_balance

    retirement_year = current_year + (retirement_age - current_age)
    state_abbr = profile.state

    # Track cumulative healthcare inflation separately (compounds from retirement year)
    healthcare_inf_cumulative = 1.0
    prev_year_was_retirement = False

    rows: list[YearlyPlanRow] = []

    for y in range(current_year, end_year + 1):
        years_from_now = y - current_year
        age = current_age + years_from_now
        spouse_age: int | None = None
        if profile.include_spouse and profile.spouse_birth_year:
            spouse_age = y - profile.spouse_birth_year

        is_working = age < retirement_age
        spouse_working = (
            profile.include_spouse
            and profile.spouse_birth_year is not None
            and (y - profile.spouse_birth_year) < (profile.spouse_retirement_age or 65)
        )

        # ── Inflation factors ──────────────────────────────────────────────
        inf = (1 + inflation_r) ** years_from_now
        inf_expenses = (1 + inflation_r) ** (y - retirement_year)

        # Healthcare cumulative inflation: advances from retirement year onward
        if y == retirement_year:
            healthcare_inf_cumulative = 1.0
        elif y > retirement_year:
            years_since_retirement = y - retirement_year
            rate_prev = max(
                inflation_r,
                _HEALTHCARE_INFLATION_START - _HEALTHCARE_INFLATION_DECLINE_PER_YEAR * (years_since_retirement - 1)
            )
            healthcare_inf_cumulative *= (1.0 + rate_prev)

        # ── Expenses ───────────────────────────────────────────────────────
        essential = essential_base * inf_expenses
        non_essential = non_essential_base * inf_expenses
        # Healthcare with its own higher inflation (only during retirement)
        if y >= retirement_year:
            healthcare_this_year = healthcare_base * healthcare_inf_cumulative
        else:
            healthcare_this_year = healthcare_base * inf_expenses  # pre-retirement: normal inflation

        # Long-term care window
        ltc_this_year = 0.0
        if not is_working and ltc_enabled and ltc_start_age <= age < ltc_end_age:
            ltc_inf = (1 + inflation_r) ** (age - retirement_age)
            ltc_this_year = ltc_annual_base * ltc_inf

        # ── Income ────────────────────────────────────────────────────────
        # Salary growth: inflation+1.5% (Fidelity methodology) unless anchored to tax return
        if anchored_to_return:
            income_growth = inf
        else:
            income_growth = (1 + inflation_r + _SALARY_REAL_GROWTH) ** years_from_now

        earned = 0.0
        if is_working:
            earned += yearly_income_base * income_growth
        if spouse_working:
            earned += spouse_yearly_income_base * income_growth

        # Social Security (with delay credits already baked into ss_annual_base)
        ss_this_year = 0.0
        if age >= ss_start_age:
            ss_this_year += ss_annual_base * inf
        if profile.include_spouse and spouse_age is not None:
            if spouse_age >= spouse_ss_start_age:
                ss_this_year += spouse_ss_annual_base * inf

        rental_this_year = rental_income_annual * inf
        div_interest_this_year = div_interest_annual * inf
        other_non_ss = rental_this_year + div_interest_this_year
        other = ss_this_year + other_non_ss
        married = bool(profile.include_spouse)

        # ── Bucket tracking ───────────────────────────────────────────────
        bucket_total = td + te + tx
        savings_start = max(0.0, bucket_total)
        tax_deferred_ratio = (td / bucket_total) if bucket_total > 0 else 1.0

        # ── Tax + withdrawal calculation ──────────────────────────────────
        rmd = 0.0
        total_extra = essential + non_essential + healthcare_this_year + ltc_this_year

        if is_working:
            if effective_working_tax_rate is not None:
                taxes = (earned + other_non_ss) * effective_working_tax_rate
            else:
                taxes = _calc_taxes(
                    earned=earned,
                    ss_income=ss_this_year,
                    other_non_ss=other_non_ss,
                    married=married,
                    age=age,
                    spouse_age=spouse_age,
                    state_abbr=state_abbr,
                )
            withdrawals = 0.0
            contribution = annual_contribution
        else:
            # Iterative gross-up for after-tax withdrawal need
            pre_tax_need = max(0.0, total_extra - other)
            withdrawals = pre_tax_need
            for _ in range(3):
                taxes = _calc_taxes(
                    earned=0.0,
                    ss_income=ss_this_year,
                    other_non_ss=other_non_ss + withdrawals,
                    married=married,
                    age=age,
                    spouse_age=spouse_age,
                    state_abbr=state_abbr,
                )
                withdrawals = max(0.0, total_extra + taxes - other)
            contribution = 0.0

        # RMD override (SECURE Act 2.0: age 75 for birth_year ≥ 1960, else 73)
        if age >= rmd_start_age and savings_start > 0:
            factor = _RMD_FACTORS.get(min(age, 100), 6.0)
            rmd = (savings_start * tax_deferred_ratio) / factor
            if rmd > withdrawals:
                withdrawals = rmd
                taxes = _calc_taxes(
                    earned=0.0,
                    ss_income=ss_this_year,
                    other_non_ss=other_non_ss + withdrawals,
                    married=married,
                    age=age,
                    spouse_age=spouse_age,
                    state_abbr=state_abbr,
                )

        total_expenses = total_extra + taxes
        total_income = earned + other + rmd
        net = total_income - total_expenses
        withdrawal_pct = (withdrawals / savings_start * 100) if savings_start > 0 else 0.0

        # ── Bucket updates ────────────────────────────────────────────────
        if is_working:
            td_end = max(0.0, (td + contrib_401k) * (1 + base_rate))
            te_end = max(0.0, (te + contrib_roth) * (1 + base_rate))
            tx_end = max(0.0, (tx + contrib_taxable) * (1 + base_rate))
        else:
            # Sequential withdrawal: tax-deferred first → taxable → Roth (tax-optimal)
            remaining = withdrawals
            td_withdraw = min(remaining, max(0.0, td))
            remaining -= td_withdraw
            tx_withdraw = min(remaining, max(0.0, tx))
            remaining -= tx_withdraw
            te_withdraw = min(remaining, max(0.0, te))

            td_end = max(0.0, (td - td_withdraw) * (1 + base_rate))
            tx_end = max(0.0, (tx - tx_withdraw) * (1 + base_rate))
            te_end = max(0.0, (te - te_withdraw) * (1 + base_rate))

        savings_end = td_end + te_end + tx_end

        rows.append(YearlyPlanRow(
            year=y,
            age=age,
            spouse_age=spouse_age,
            savings_start_of_year=round(savings_start, 2),
            tax_deferred_savings=round(td, 2),
            tax_exempt_savings=round(te, 2),
            taxable_savings=round(tx, 2),
            essential_expenses=round(essential, 2),
            non_essential_expenses=round(non_essential, 2),
            healthcare_expenses=round(healthcare_this_year, 2),
            ltc_expenses=round(ltc_this_year, 2),
            estimated_taxes=round(taxes, 2),
            total_expenses=round(total_expenses, 2),
            earned_income=round(earned, 2),
            dividend_interest_income=round(div_interest_this_year, 2),
            other_income=round(ss_this_year + rental_this_year, 2),
            total_income=round(total_income, 2),
            savings_withdrawals=round(withdrawals, 2),
            rmd_amount=round(rmd, 2),
            withdrawal_pct=round(withdrawal_pct, 1),
            savings_end_of_year=round(savings_end, 2),
            net_surplus_deficit=round(net, 2),
        ))

        td = td_end
        te = te_end
        tx = tx_end

    return YearlyPlanResponse(
        rows=rows,
        anchored_to_return=anchored_to_return,
        tax_return_year=tax_return_year,
        tax_return_agi=tax_return_agi,
        tax_return_w2=tax_return_w2,
    )
