"""Retirement planning endpoints — profile + projection."""

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
    RetirementProfileCreate,
    RetirementProfileResponse,
    RetirementProfileUpdate,
    RetirementProjectionResponse,
    ScenarioProjection,
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

    if profile:
        for field, value in body.model_dump(exclude_unset=False).items():
            setattr(profile, field, value)
        profile.updated_at = datetime.now(timezone.utc)
    else:
        profile = RetirementProfile(
            household_id=user.household_id,
            **body.model_dump(),
        )
        db.add(profile)

    await db.flush()
    await db.refresh(profile)
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
        if acc.type in ("investment", "brokerage"):
            total_investment_assets += bal
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
