"""Retirement planning endpoints — profile + projection."""

import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account
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
# Each entry: (taxable_income_up_to, marginal_rate)
# Married Filing Jointly — used when include_spouse=True
_BRACKETS_MFJ: list[tuple[float, float]] = [
    (23_200,   0.10),
    (94_300,   0.12),
    (201_050,  0.22),
    (383_900,  0.24),
    (487_450,  0.32),
    (731_200,  0.35),
    (float("inf"), 0.37),
]
# Single filer — used when include_spouse=False
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
# Age 65+ additional standard deduction (per filer)
_EXTRA_DEDUCTION_65 = 1_550.0
# Flat average state + local income tax rate (blended US average)
_STATE_TAX_RATE = 0.05

# Social Security taxability thresholds (MFJ / Single combined income)
_SS_THRESHOLD_LOW_MFJ    = 32_000.0
_SS_THRESHOLD_HIGH_MFJ   = 44_000.0
_SS_THRESHOLD_LOW_SINGLE  = 25_000.0
_SS_THRESHOLD_HIGH_SINGLE = 34_000.0


def _federal_tax(taxable_income: float, married: bool) -> float:
    """Calculate federal income tax using 2024 progressive brackets."""
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
    """Return the fraction of SS benefits that is taxable (0, 0.5, or up to 0.85)."""
    if ss_income <= 0:
        return 0.0
    # IRS provisional income = other income + 50% of SS
    provisional = other_income + ss_income * 0.50
    low  = _SS_THRESHOLD_LOW_MFJ   if married else _SS_THRESHOLD_LOW_SINGLE
    high = _SS_THRESHOLD_HIGH_MFJ  if married else _SS_THRESHOLD_HIGH_SINGLE
    if provisional <= low:
        return 0.0
    elif provisional <= high:
        # Up to 50% of SS is taxable
        return min(0.50, (provisional - low) / (ss_income * 2))
    else:
        # Up to 85% of SS is taxable
        return min(0.85, 0.50 + (provisional - high) / (ss_income * 2))


def _calc_taxes(
    earned: float,
    ss_income: float,
    other_non_ss: float,  # rental + portfolio withdrawals
    married: bool,
    age: int,
    spouse_age: int | None,
) -> float:
    """
    Estimate total income taxes (federal + state) using 2024 brackets.

    - Applies standard deduction (with age-65+ add-on)
    - Taxes SS benefits at 0 / 50% / 85% per IRS provisional income rules
    - Rental income taxed as ordinary income
    - Portfolio withdrawals treated as ordinary income (conservative: ignores
      Roth distributions which are tax-free; those are a planning bonus)
    - State tax applied on gross income before deductions (blended average)
    """
    married_flag = married

    # Standard deduction
    std_deduction = _STANDARD_DEDUCTION_MFJ if married_flag else _STANDARD_DEDUCTION_SINGLE
    if age >= 65:
        std_deduction += _EXTRA_DEDUCTION_65
    if married_flag and spouse_age is not None and spouse_age >= 65:
        std_deduction += _EXTRA_DEDUCTION_65

    # Taxable SS
    taxable_ss = ss_income * _ss_taxable_fraction(ss_income, earned + other_non_ss, married_flag)

    gross_income = earned + taxable_ss + other_non_ss
    taxable_income = max(0.0, gross_income - std_deduction)

    federal = _federal_tax(taxable_income, married_flag)
    # State tax on gross income (most states don't allow federal std deduction)
    state = gross_income * _STATE_TAX_RATE

    return federal + state


# IRS Uniform Lifetime Table (Publication 590-B, 2022) — RMD distribution periods
_RMD_FACTORS: dict[int, float] = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
    78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
    84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
    90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5,  95: 8.9,
    96: 8.4,  97: 7.8,  98: 7.3,  99: 6.8, 100: 6.4,
}


# ─── Helpers ────────────────────────────────────────────────────────────────

def _fv_lump_sum(pv: float, r: float, n: int) -> float:
    """Future value of a lump sum."""
    return pv * ((1 + r) ** n)


def _fv_annuity(pmt: float, r: float, n: int) -> float:
    """Future value of an ordinary annuity (end-of-year payments)."""
    if r == 0 or n == 0:
        return pmt * n
    return pmt * (((1 + r) ** n - 1) / r)


def _probability_of_success(pessimistic: float, base: float, optimistic: float, target: float) -> float:
    """Estimate probability of success from 3 scenario outcomes."""
    if target <= 0:
        return 99.0
    success = sum(1 for s in [pessimistic, base, optimistic] if s >= target)
    if success == 3:
        surplus = min(pessimistic / target, 1.5)
        return min(99.0, 80.0 + surplus * 13.0)
    elif success == 2:
        ratio = min(base / target, 1.0)
        return min(79.0, 55.0 + ratio * 24.0)
    elif success == 1:
        ratio = min(optimistic / target, 1.0)
        return min(54.0, 25.0 + ratio * 29.0)
    else:
        ratio = min(optimistic / target, 1.0)
        return max(1.0, min(24.0, ratio * 24.0))


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

    # Retirement vs total net worth allocation
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

    # Probability-based insight
    if probability_of_success >= 90:
        insights.append(
            f"Your plan shows a {probability_of_success:.0f}% probability of success across market scenarios. "
            f"You're well-positioned even in below-average market conditions."
        )
    elif probability_of_success >= 65:
        insights.append(
            f"Your plan has a {probability_of_success:.0f}% probability of success. "
            f"Increasing contributions modestly could push this above 90%."
        )
    else:
        insights.append(
            f"Your plan shows a {probability_of_success:.0f}% probability of success. "
            f"Consider boosting savings by ${annual_contribution * 0.15:,.0f}/year to improve your outlook."
        )

    # Life insurance check
    if not has_life_insurance and desired_annual_income > 0:
        recommended_coverage = desired_annual_income * 10
        insights.append(
            f"Consider life insurance coverage of at least ${recommended_coverage:,.0f} "
            f"(10× your desired retirement income) to protect your household."
        )

    if include_spouse:
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

    return insights[:5]  # cap at 5


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

    # Never let the profile form touch retirement_account_ids — it's managed
    # separately via PUT /accounts/selection.
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
    """Return all investment/brokerage accounts with retirement classification info."""
    result = await db.execute(
        select(Account).where(
            Account.household_id == user.household_id,
            Account.is_hidden == False,  # noqa: E712
        ).order_by(Account.institution_name, Account.name)
    )
    accounts = result.scalars().all()

    # Load current profile to see which are manually selected
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
    """Set which accounts to include in the retirement projection.
    Pass account_ids=null to revert to auto-detection.
    """
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
    n = years_to_retirement

    # Combine contributions (add spouse if enabled)
    annual_contribution = float(profile.annual_contribution)
    if profile.include_spouse and profile.spouse_annual_contribution:
        annual_contribution += float(profile.spouse_annual_contribution)

    # Effective target income: use expense fields if provided, else desired_annual_income
    monthly_expenses_total = 0.0
    if profile.monthly_essential_expenses or profile.monthly_non_essential_expenses:
        monthly_expenses_total = (
            float(profile.monthly_essential_expenses or 0)
            + float(profile.monthly_non_essential_expenses or 0)
        )
        desired_income = monthly_expenses_total * 12
    else:
        desired_income = float(profile.desired_annual_income)

    # ── Current retirement assets ─────────────────────────────────────────
    accounts = (await db.execute(
        select(Account).where(
            Account.household_id == user.household_id,
            Account.is_hidden == False,  # noqa: E712
        )
    )).scalars().all()

    # Determine if user has a manual account selection
    manual_ids: set[str] | None = None
    if profile.retirement_account_ids:
        try:
            manual_ids = set(json.loads(profile.retirement_account_ids))
        except Exception:
            manual_ids = None

    retirement_assets = 0.0
    total_investment_assets = 0.0
    total_cash = 0.0
    credit_debt = 0.0
    tax_deferred_balance = 0.0
    tax_exempt_balance = 0.0
    taxable_investment_balance = 0.0

    for acc in accounts:
        bal = float(acc.current_balance or 0)
        subtype = (acc.subtype or "").lower()
        acc_id = str(acc.id)

        if acc.type in ("investment", "brokerage"):
            total_investment_assets += bal
            # If manual selection is set, only include explicitly selected accounts
            if manual_ids is not None:
                if acc_id in manual_ids:
                    # Classify for tax breakdown
                    if subtype in TAX_DEFERRED_SUBTYPES:
                        tax_deferred_balance += bal
                    elif subtype in TAX_EXEMPT_SUBTYPES:
                        tax_exempt_balance += bal
                    else:
                        taxable_investment_balance += bal
                    retirement_assets += bal
                # else: skip (not in manual selection)
            else:
                # Auto-detect: include only recognised retirement subtypes
                if subtype in TAX_DEFERRED_SUBTYPES:
                    tax_deferred_balance += bal
                    retirement_assets += bal
                elif subtype in TAX_EXEMPT_SUBTYPES:
                    tax_exempt_balance += bal
                    retirement_assets += bal
                else:
                    taxable_investment_balance += bal
        elif acc.type == "depository":
            total_cash += bal
        elif acc.type == "credit":
            credit_debt += bal

    # ── Real estate equity ───────────────────────────────────────────────
    properties = (await db.execute(
        select(Property).where(Property.household_id == user.household_id)
    )).scalars().all()
    total_real_estate = sum(float(p.current_value or 0) for p in properties)

    total_mortgage = 0.0
    if properties:
        prop_ids = [p.id for p in properties]
        loans = (await db.execute(
            select(Loan).where(Loan.property_id.in_(prop_ids))
        )).scalars().all()
        total_mortgage = sum(float(l.current_balance or 0) for l in loans)

    real_estate_equity = max(0.0, total_real_estate - total_mortgage)
    total_net_worth = total_cash + total_investment_assets + total_real_estate - credit_debt - total_mortgage

    # ── Three-scenario projection math ───────────────────────────────────
    target = desired_income / SAFE_WITHDRAWAL_RATE

    r_pessimistic = max(0.01, r - 0.02)
    r_base = r
    r_optimistic = r + 0.03

    def _project(rate: float) -> float:
        return _fv_lump_sum(retirement_assets, rate, n) + _fv_annuity(annual_contribution, rate, n)

    projected_pessimistic = _project(r_pessimistic)
    projected_base = _project(r_base)
    projected_optimistic = _project(r_optimistic)

    projected = projected_base
    gap = target - projected
    on_track_pct = min(200.0, (projected / target * 100) if target > 0 else 0.0)
    probability = _probability_of_success(projected_pessimistic, projected_base, projected_optimistic, target)

    # Required extra annual saving to close the gap (base scenario)
    if gap > 0 and n > 0 and r > 0:
        required_extra_annual = gap / (((1 + r) ** n - 1) / r)
    else:
        required_extra_annual = 0.0
    monthly_needed = required_extra_annual / 12

    # ── Scenario projections for chart ───────────────────────────────────
    scenario_projections: list[ScenarioProjection] = []
    yearly_projections: list[YearlyProjection] = []
    for i in range(n + 1):
        age_i = current_age + i
        opt_i = _fv_lump_sum(retirement_assets, r_optimistic, i) + _fv_annuity(annual_contribution, r_optimistic, i)
        base_i = _fv_lump_sum(retirement_assets, r_base, i) + _fv_annuity(annual_contribution, r_base, i)
        pess_i = _fv_lump_sum(retirement_assets, r_pessimistic, i) + _fv_annuity(annual_contribution, r_pessimistic, i)
        req_i = (target / n * i) if n > 0 else target
        scenario_projections.append(ScenarioProjection(
            year=current_year + i,
            age=age_i,
            optimistic=round(opt_i, 2),
            base=round(base_i, 2),
            pessimistic=round(pess_i, 2),
            required=round(req_i, 2),
        ))
        yearly_projections.append(YearlyProjection(
            year=current_year + i,
            age=age_i,
            projected=round(base_i, 2),
            required=round(req_i, 2),
        ))

    # ── Income sources ───────────────────────────────────────────────────
    income_sources: list[IncomeSource] = []

    portfolio_income = projected * SAFE_WITHDRAWAL_RATE
    income_sources.append(IncomeSource(
        label="Portfolio Withdrawals (4% SWR)",
        annual_amount=round(portfolio_income, 2),
        source_type="portfolio",
    ))

    ss = float(profile.social_security_estimate or 0)
    if ss > 0:
        income_sources.append(IncomeSource(
            label="Social Security",
            annual_amount=round(ss, 2),
            source_type="social_security",
        ))
    if profile.include_spouse and profile.spouse_social_security_estimate:
        spouse_ss = float(profile.spouse_social_security_estimate)
        if spouse_ss > 0:
            income_sources.append(IncomeSource(
                label="Spouse Social Security",
                annual_amount=round(spouse_ss, 2),
                source_type="social_security",
            ))

    # Rental income from active leases
    units_q = await db.execute(
        select(Unit).where(Unit.property_id.in_([p.id for p in properties]))
    ) if properties else None

    rental_income = 0.0
    if units_q:
        units = units_q.scalars().all()
        if units:
            unit_ids = [u.id for u in units]
            leases_q = await db.execute(
                select(Lease).where(
                    Lease.unit_id.in_(unit_ids),
                    Lease.status == "active",
                )
            )
            active_leases = leases_q.scalars().all()
            rental_income = sum(float(l.monthly_rent) * 12 for l in active_leases)

    if rental_income > 0:
        income_sources.append(IncomeSource(
            label="Rental Income",
            annual_amount=round(rental_income, 2),
            source_type="rental",
        ))

    re_income = real_estate_equity * SAFE_WITHDRAWAL_RATE
    if re_income > 0:
        income_sources.append(IncomeSource(
            label="Real Estate Equity Income",
            annual_amount=round(re_income, 2),
            source_type="real_estate",
        ))

    # ── Life insurance check ─────────────────────────────────────────────
    insurance_q = await db.execute(
        select(InsurancePolicy).where(
            InsurancePolicy.household_id == user.household_id,
            InsurancePolicy.policy_type.in_(["life_term", "life_whole", "life_universal"]),
            InsurancePolicy.is_active == True,  # noqa: E712
        )
    )
    has_life_insurance = insurance_q.scalars().first() is not None

    # ── Insights ─────────────────────────────────────────────────────────
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
        tax_deferred_balance=round(tax_deferred_balance, 2),
        taxable_investment_balance=round(taxable_investment_balance, 2),
        tax_exempt_balance=round(tax_exempt_balance, 2),
        total_monthly_expenses=round(monthly_expenses_total, 2),
        income_sources=income_sources,
        yearly_projections=yearly_projections,
        scenario_projections=scenario_projections,
        insights=insights,
    )


@router.get("/yearly-plan", response_model=list[YearlyPlanRow])
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
    end_year = current_year + (life_exp_age - current_age)

    # ── Expense basis ──────────────────────────────────────────────────────
    if profile.monthly_essential_expenses or profile.monthly_non_essential_expenses:
        essential_base = float(profile.monthly_essential_expenses or 0) * 12
        non_essential_base = float(profile.monthly_non_essential_expenses or 0) * 12
    else:
        # Split desired_annual_income 60/40
        essential_base = float(profile.desired_annual_income) * 0.60
        non_essential_base = float(profile.desired_annual_income) * 0.40

    # ── Income inputs ──────────────────────────────────────────────────────
    yearly_income_base = float(profile.yearly_income or 0)
    spouse_yearly_income_base = float(profile.spouse_yearly_income or 0) if profile.include_spouse else 0.0
    ss_monthly = float(profile.social_security_estimate or 0)
    ss_annual_base = ss_monthly * 12
    spouse_ss_annual_base = (
        float(profile.spouse_social_security_estimate or 0) * 12
        if profile.include_spouse and profile.spouse_social_security_estimate
        else 0.0
    )
    annual_contribution = float(profile.annual_contribution)
    if profile.include_spouse and profile.spouse_annual_contribution:
        annual_contribution += float(profile.spouse_annual_contribution)

    # ── Retirement assets (same logic as /projection) ──────────────────────
    accounts = (await db.execute(
        select(Account).where(
            Account.household_id == user.household_id,
            Account.is_hidden == False,  # noqa: E712
        )
    )).scalars().all()

    manual_ids: set[str] | None = None
    if profile.retirement_account_ids:
        try:
            manual_ids = set(json.loads(profile.retirement_account_ids))
        except Exception:
            manual_ids = None

    retirement_assets = 0.0
    for acc in accounts:
        bal = float(acc.current_balance or 0)
        subtype = (acc.subtype or "").lower()
        acc_id = str(acc.id)
        if acc.type in ("investment", "brokerage"):
            if manual_ids is not None:
                if acc_id in manual_ids:
                    retirement_assets += bal
            else:
                if subtype in RETIREMENT_SUBTYPES:
                    retirement_assets += bal

    # ── Rental income ──────────────────────────────────────────────────────
    properties = (await db.execute(
        select(Property).where(Property.household_id == user.household_id)
    )).scalars().all()

    rental_income_annual = 0.0
    if properties:
        prop_ids = [p.id for p in properties]
        units = (await db.execute(
            select(Unit).where(Unit.property_id.in_(prop_ids))
        )).scalars().all()
        if units:
            unit_ids = [u.id for u in units]
            active_leases = (await db.execute(
                select(Lease).where(
                    Lease.unit_id.in_(unit_ids),
                    Lease.status == "active",
                )
            )).scalars().all()
            rental_income_annual = sum(float(l.monthly_rent) * 12 for l in active_leases)

    # ── Year-by-year loop ──────────────────────────────────────────────────
    rows: list[YearlyPlanRow] = []
    savings = retirement_assets

    for y in range(current_year, end_year + 1):
        years_from_now = y - current_year
        age = current_age + years_from_now
        spouse_age: int | None = None
        if profile.include_spouse and profile.spouse_birth_year:
            spouse_age = y - profile.spouse_birth_year

        inf = (1 + inflation_r) ** years_from_now
        is_working = age < retirement_age
        spouse_working = (
            profile.include_spouse
            and profile.spouse_birth_year is not None
            and (y - profile.spouse_birth_year) < (profile.spouse_retirement_age or 65)
        )

        savings_start = max(0.0, savings)

        # Inflation-adjusted expenses
        essential = essential_base * inf
        non_essential = non_essential_base * inf

        # Income
        earned = 0.0
        if is_working:
            earned += yearly_income_base * inf
        if spouse_working:
            earned += spouse_yearly_income_base * inf

        # Passive income — split SS from non-SS for accurate tax treatment
        ss_this_year = 0.0
        ss_start_age = max(62, retirement_age)
        if age >= ss_start_age:
            ss_this_year += ss_annual_base * inf  # SS is COLA-indexed
        if profile.include_spouse and spouse_age is not None:
            spouse_ss_start_age = max(62, profile.spouse_retirement_age or 65)
            if spouse_age >= spouse_ss_start_age:
                ss_this_year += spouse_ss_annual_base * inf
        other_non_ss = rental_income_annual * inf  # rental is ordinary income
        other = ss_this_year + other_non_ss
        married = bool(profile.include_spouse)

        # Tax + withdrawal calculation
        rmd = 0.0
        if is_working:
            taxes = _calc_taxes(
                earned=earned,
                ss_income=ss_this_year,
                other_non_ss=other_non_ss,
                married=married,
                age=age,
                spouse_age=spouse_age,
            )
            withdrawals = 0.0
            contribution = annual_contribution
        else:
            # Iterative gross-up: estimate withdrawals needed to cover after-tax expenses.
            # First pass: rough withdrawal estimate ignoring taxes on it.
            pre_tax_need = max(0.0, essential + non_essential - other)
            # Second pass: include withdrawal in tax base and solve iteratively (2 iters is enough)
            withdrawals = pre_tax_need
            for _ in range(3):
                taxes = _calc_taxes(
                    earned=0.0,
                    ss_income=ss_this_year,
                    other_non_ss=other_non_ss + withdrawals,
                    married=married,
                    age=age,
                    spouse_age=spouse_age,
                )
                withdrawals = max(0.0, essential + non_essential + taxes - other)
            contribution = 0.0

        # RMD override at age 73+
        if age >= 73 and savings_start > 0:
            factor = _RMD_FACTORS.get(min(age, 100), 6.0)
            rmd = savings_start / factor
            if rmd > withdrawals:
                withdrawals = rmd
                # Recalculate taxes with RMD as the withdrawal amount
                taxes = _calc_taxes(
                    earned=0.0,
                    ss_income=ss_this_year,
                    other_non_ss=other_non_ss + withdrawals,
                    married=married,
                    age=age,
                    spouse_age=spouse_age,
                )

        total_expenses = essential + non_essential + taxes
        total_income = earned + other
        net = total_income - total_expenses
        withdrawal_pct = (withdrawals / savings_start * 100) if savings_start > 0 else 0.0

        if is_working:
            savings_end = max(0.0, (savings_start + contribution) * (1 + base_rate))
        else:
            savings_end = max(0.0, (savings_start - withdrawals) * (1 + base_rate))

        rows.append(YearlyPlanRow(
            year=y,
            age=age,
            spouse_age=spouse_age,
            savings_start_of_year=round(savings_start, 2),
            essential_expenses=round(essential, 2),
            non_essential_expenses=round(non_essential, 2),
            estimated_taxes=round(taxes, 2),
            total_expenses=round(total_expenses, 2),
            earned_income=round(earned, 2),
            other_income=round(other, 2),
            total_income=round(total_income, 2),
            savings_withdrawals=round(withdrawals, 2),
            rmd_amount=round(rmd, 2),
            withdrawal_pct=round(withdrawal_pct, 1),
            savings_end_of_year=round(savings_end, 2),
            net_surplus_deficit=round(net, 2),
        ))

        savings = savings_end

    return rows
