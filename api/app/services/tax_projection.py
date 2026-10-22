"""This year's tax, projected from what the household's accounts already show.

gather_inputs() turns the database into tax_calc.TaxInputs:
  wages and withholding   salary_withholdings (full-year W-2 figures)
  realized gains          services/tax.build_tax_summary (FIFO lots)
  dividends and interest  investment transactions and "Income > Interest" bank
                          transactions in taxable accounts, annualized
  rentals                 services/schedule_e, rents and repairs annualized
  businesses              transactions on each entity's accounts, annualized
  mortgage interest and   the primary residence's loans and property costs
  property tax
  estimated payments      "Taxes" transactions from April to January
  everything else         tax_profiles (filing status, dependents, overrides)

For the current year, flows seen so far (dividends, interest, rents, business
income and expenses) are scaled up by the share of the year elapsed; realized
gains count as they are. Alongside the inputs it returns where each figure
came from and the gaps that make the estimate weaker.
"""

import re
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, Transaction
from app.models.business_entity import BusinessEntity, EntityOwnership
from app.models.investment import Holding, InvestmentTransaction
from app.models.property import Property
from app.models.property_details import Loan, PropertyCost
from app.models.retirement import RetirementProfile
from app.models.salary_withholdings import SalaryWithholding
from app.models.tax_profile import TaxProfile
from app.models.user import User
from app.services import tax_tables as tt
from app.services.dividends import _income as dividend_cash
from app.services.loan_split import interest_in_year
from app.services.report_types import (
    PROPERTY_EXPENSE_PREFIXES, RENTAL_INCOME_PREFIXES, category_starts_with, load_report_types, report_type_expr,
)
from app.services.schedule_e import _annual, build_schedule_e, schedule_e_totals
from app.services.tax import _is_cash_sweep, build_tax_summary, tax_treatment
from app.services.tax_calc import Business, Earner, TaxInputs, compute

_LOAN_PREFIXES = ("financial > loan", "payment > loan", "housing > mortgage", "loan payments")
_INTEREST_PREFIXES = ("income > interest",)
_TAX_PAYMENT_PREFIXES = ("taxes > federal", "taxes > state", "taxes > estimated", "financial > tax payments")
_STATE_PAYEE_RE = re.compile(
    r"\bstate\b|franchise|dept\.? of rev|department of revenue|\bftb\b|comptroller|taxation and finance|\bdor\b", re.I
)
_ENTITY_CLASS = {
    "sole_prop": "schedule_c", "s_corp": "s_corp", "c_corp": "c_corp", "partnership": "partnership",
}


def _f(v) -> float:
    return float(v) if v is not None else 0.0


def _age_at_year_end(birthdate: date | None, birth_year: int | None, year: int) -> int | None:
    if birthdate:
        return year - birthdate.year
    if birth_year:
        return year - birth_year
    return None


def _day(d: datetime | date) -> date:
    return d.date() if isinstance(d, datetime) else d


def _year_fraction(year: int, today: date) -> float:
    """Share of `year` elapsed; 1 for past years."""
    if year != today.year:
        return 1.0
    start = date(year, 1, 1)
    return max(1, (today - start).days + 1) / ((date(year, 12, 31) - start).days + 1)


def _start(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


async def load_profile(db: AsyncSession, household_id: uuid.UUID, year: int) -> TaxProfile | None:
    return (await db.execute(
        select(TaxProfile).where(TaxProfile.household_id == household_id, TaxProfile.year == year)
    )).scalar_one_or_none()


async def profile_defaults(db: AsyncSession, household_id: uuid.UUID, year: int) -> dict:
    """Starting values for a year without a profile: last year's profile for the
    facts that rarely change, the retirement profile and last 1040 otherwise."""
    prev = (await db.execute(
        select(TaxProfile).where(TaxProfile.household_id == household_id, TaxProfile.year < year)
        .order_by(TaxProfile.year.desc()).limit(1)
    )).scalar_one_or_none()
    rp = (await db.execute(
        select(RetirementProfile).where(RetirementProfile.household_id == household_id)
    )).scalar_one_or_none()
    out: dict = {
        "filing_status": prev.filing_status if prev else ("mfj" if rp and rp.include_spouse else "single"),
        "state": (prev.state if prev else None) or (rp.state if rp else None),
        "taxpayer_birthdate": prev.taxpayer_birthdate if prev else None,
        "spouse_birthdate": prev.spouse_birthdate if prev else None,
        "dependents_under_17": prev.dependents_under_17 if prev else 0,
        "other_dependents": prev.other_dependents if prev else 0,
        "real_estate_professional": prev.real_estate_professional if prev else False,
        "active_participation": prev.active_participation if prev else True,
        "prior_year_agi": None,
        "prior_year_tax": None,
    }
    last_1040 = await _latest_1040(db, household_id)
    if last_1040 and last_1040.get("tax_year") == year - 1:
        out["prior_year_agi"] = last_1040.get("agi")
        out["prior_year_tax"] = last_1040.get("total_federal_tax")
    return out


async def _latest_1040(db: AsyncSession, household_id: uuid.UUID) -> dict | None:
    from app.routers.retirement import _load_latest_1040  # parser lives with its first user
    try:
        return await _load_latest_1040(db, household_id)
    except Exception:
        return None


async def gather_inputs(db: AsyncSession, household_id: uuid.UUID, year: int) -> tuple[TaxInputs, dict]:
    today = datetime.now(timezone.utc).date()
    frac = _year_fraction(year, today)
    year_start, year_end = date(year, 1, 1), date(year, 12, 31)
    gaps: list[dict] = []
    sources: dict = {"year_fraction": frac}

    def gap(gid: str, message: str, where: str) -> None:
        gaps.append({"id": gid, "message": message, "where": where})

    # ── Profile ──────────────────────────────────────────────────────────────
    profile = await load_profile(db, household_id, year)
    defaults = await profile_defaults(db, household_id, year)
    rp = (await db.execute(
        select(RetirementProfile).where(RetirementProfile.household_id == household_id)
    )).scalar_one_or_none()
    if not profile:
        gap("profile", "Confirm filing status, state, dependents and birthdates for this year", "inputs")

    def pv(name: str):
        return getattr(profile, name) if profile else defaults.get(name)

    status = pv("filing_status") or "single"
    state = pv("state")
    if not state:
        gap("state", "Set your state of residence for the state tax estimate", "inputs")
    taxpayer_age = _age_at_year_end(pv("taxpayer_birthdate"), rp.birth_year if rp else None, year)
    spouse_age = _age_at_year_end(pv("spouse_birthdate"), rp.spouse_birth_year if rp else None, year)
    if taxpayer_age is None:
        gap("birthdate", "Add birthdates: they decide catch-up limits and the 65+ deductions", "inputs")

    users = {u.id: u.full_name for u in (await db.execute(
        select(User).where(User.household_id == household_id)
    )).scalars().all()}

    # ── W-2 wages and withholding ────────────────────────────────────────────
    w2s = (await db.execute(
        select(SalaryWithholding).where(SalaryWithholding.household_id == household_id, SalaryWithholding.year == year)
    )).scalars().all()
    w2_year = year
    if not w2s:
        w2s = (await db.execute(
            select(SalaryWithholding).where(
                SalaryWithholding.household_id == household_id, SalaryWithholding.year == year - 1)
        )).scalars().all()
        if w2s:
            w2_year = year - 1
            gap("w2_prior", f"No {year} W-2 figures: using {year - 1}'s as an estimate", "salary")
        else:
            gap("w2", f"Enter expected {year} W-2 figures (wages, withholding, 401(k))", "salary")
    sources["w2_year"] = w2_year if w2s else None
    earners = []
    for w in w2s:
        wages = _f(w.federal_wages) or max(0.0, _f(w.gross_wages) - _f(w.traditional_401k) - _f(w.fsa_section125))
        medicare = _f(w.medicare_wages) or _f(w.gross_wages)
        earners.append(Earner(
            user_id=str(w.user_id), name=f"{users.get(w.user_id, 'Member')}{' · ' + w.employer_name if w.employer_name else ''}",
            wages=wages, medicare_wages=medicare, ss_wages=medicare,
            federal_withheld=_f(w.federal_income_tax), state_withheld=_f(w.state_income_tax),
            k401_traditional=_f(w.traditional_401k), k401_roth=_f(w.roth_401k), hsa_payroll=_f(w.hsa),
        ))

    # ── Investments: realized gains, dividends, interest ─────────────────────
    summary = await build_tax_summary(db, household_id, None, year)
    realized = summary["realized"]
    st_gains = float(realized["short_term"]["net"]) + float(realized["unknown_term"]["net"])
    lt_gains = float(realized["long_term"]["net"])
    if float(realized["unknown_term"]["net"]):
        gap("gain_term", "Some sales have no purchase date: their gains are counted as short-term", "investments")
    if realized["missing_basis_count"]:
        gap("basis", f"{realized['missing_basis_count']} sale(s) have no cost basis and aren't counted", "investments")

    inv_accounts = (await db.execute(
        select(Account).where(Account.household_id == household_id, Account.type == "investment")
    )).scalars().all()
    taxable_ids = {a.id for a in inv_accounts if tax_treatment(a) in ("taxable", "crypto")}
    deferred_balance = sum(_f(a.current_balance) for a in inv_accounts if tax_treatment(a) == "tax_deferred")

    div_txns = (await db.execute(
        select(InvestmentTransaction).where(
            InvestmentTransaction.household_id == household_id,
            InvestmentTransaction.type.in_(("dividend", "interest")),
            InvestmentTransaction.date >= _start(year_start),
            InvestmentTransaction.date < _start(date(year + 1, 1, 1)),
        )
    )).scalars().all()
    qualified = interest = 0.0
    for t in div_txns:
        if t.account_id not in taxable_ids:
            continue
        cash = float(dividend_cash(t))
        if t.type == "interest" or _is_cash_sweep((t.ticker_symbol or "").upper(), t.name):
            interest += cash
        else:
            qualified += cash
    bank_interest = -float((await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .select_from(Transaction).outerjoin(Account, Account.id == Transaction.account_id)
        .where(
            Transaction.household_id == household_id,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,  # noqa: E712
            Transaction.amount < 0,
            Transaction.date >= _start(year_start),
            Transaction.date < _start(date(year + 1, 1, 1)),
            category_starts_with(_INTEREST_PREFIXES),
            or_(Account.id.is_(None), Account.type != "investment"),
            or_(Account.id.is_(None), and_(Account.entity_id.is_(None), Account.account_scope != "business")),
        )
    )).scalar() or 0)
    sources["investment_income_ytd"] = {"qualified_dividends": qualified, "interest": interest + bank_interest}
    qualified /= frac
    interest = (interest + bank_interest) / frac

    holdings = (await db.execute(
        select(Holding).where(Holding.household_id == household_id)
    )).scalars().all()
    unrealized_gain = sum(
        max(0.0, _f(h.current_value) - _f(h.cost_basis))
        for h in holdings if h.account_id in taxable_ids and _f(h.cost_basis) > 0
    )

    # ── Rentals ──────────────────────────────────────────────────────────────
    rentals = await build_schedule_e(db, household_id, year)
    # Rents: received so far plus active leases for the months left. Repairs
    # are lumpy, so only what's been spent counts.
    months_left = 12 - today.month if year == today.year else 0
    projected_rentals = []
    for r in rentals:
        p = dict(r)
        still_due = r["active_monthly_rent"] * months_left
        p["gross_rents"] = r["gross_rents"] + still_due
        p["mgmt_fees"] = r["mgmt_fees"] + still_due * r["mgmt_pct"] / 100
        p["total_opex"] = p["mgmt_fees"] + p["insurance"] + p["property_tax"] + p["hoa"] + p["repairs"] + p["other_fixed"]
        p["noi"] = p["gross_rents"] - p["total_opex"]
        p["net_income"] = p["noi"] - p["mortgage_interest"] - p["depreciation"]
        projected_rentals.append(p)
        if r["land_estimated"]:
            gap(f"land:{r['property_id']}", f"{r['address']}: add the land value (assumed 20% of price)", "rentals")
        if not r["placed_in_service"]:
            gap(f"in_service:{r['property_id']}", f"{r['address']}: add the date it was first rented", "rentals")
        if (r["personal_use_days"] or 0) > 14:
            gap(f"personal_use:{r['property_id']}",
                f"{r['address']}: over 14 personal-use days — vacation-home rules may limit deductions", "rentals")
    rental_net = sum(p["net_income"] for p in projected_rentals)

    # ── Primary residence: mortgage interest and property tax ────────────────
    homes = (await db.execute(
        select(Property).where(Property.household_id == household_id, Property.is_primary_residence == True)  # noqa: E712
    )).scalars().all()
    home_interest = home_tax = 0.0
    for h in homes:
        loans = (await db.execute(select(Loan).where(Loan.property_id == h.id))).scalars().all()
        interest_h = sum(i for i in (interest_in_year(l, year) for l in loans) if i)
        balance = sum(_f(l.current_balance) for l in loans)
        if balance > tt.MORTGAGE_DEBT_LIMIT:
            interest_h *= tt.MORTGAGE_DEBT_LIMIT / balance
        home_interest += interest_h
        costs = (await db.execute(
            select(PropertyCost).where(
                PropertyCost.property_id == h.id, PropertyCost.is_active == True,  # noqa: E712
                PropertyCost.category == "property_tax",
                or_(PropertyCost.effective_date.is_(None), PropertyCost.effective_date <= year_end),
            )
        )).scalars().all()
        home_tax += sum(_annual(c.amount, c.frequency) for c in costs)
    mortgage_interest = _f(pv("mortgage_interest_override")) if pv("mortgage_interest_override") is not None else home_interest
    property_tax = _f(pv("property_tax_override")) if pv("property_tax_override") is not None else home_tax
    sources["mortgage_interest"] = "profile" if pv("mortgage_interest_override") is not None else "loans"
    sources["property_tax"] = "profile" if pv("property_tax_override") is not None else "property costs"

    # ── Businesses ───────────────────────────────────────────────────────────
    report_types = await load_report_types(db, household_id)
    entities = (await db.execute(
        select(BusinessEntity).where(BusinessEntity.household_id == household_id, BusinessEntity.is_active == True)  # noqa: E712
    )).scalars().all()
    owners = (await db.execute(
        select(EntityOwnership).where(EntityOwnership.entity_id.in_([e.id for e in entities]))
    )).scalars().all() if entities else []

    async def pnl(account_filter) -> dict:
        rows = (await db.execute(
            select(
                func.split_part(func.coalesce(Transaction.plaid_category, "Uncategorized"), " > ", 1).label("grp"),
                func.sum(Transaction.amount).label("amt"),
                (Transaction.amount < 0).label("is_income"),
            )
            .join(Account, Account.id == Transaction.account_id)
            .where(
                Transaction.household_id == household_id,
                Transaction.is_ignored == False,  # noqa: E712
                Transaction.pending == False,  # noqa: E712
                Transaction.date >= _start(year_start),
                Transaction.date < _start(date(year + 1, 1, 1)),
                report_type_expr(report_types) == "cashflow",
                not_(category_starts_with(RENTAL_INCOME_PREFIXES + PROPERTY_EXPENSE_PREFIXES + _LOAN_PREFIXES
                                          + _TAX_PAYMENT_PREFIXES)),
                account_filter,
            )
            .group_by("grp", "is_income")
        )).all()
        income = sum(-float(r.amt) for r in rows if r.is_income)
        expense_groups = sorted(
            ({"category": r.grp, "amount": float(r.amt)} for r in rows if not r.is_income),
            key=lambda x: -x["amount"],
        )
        expenses = sum(g["amount"] for g in expense_groups)
        return {"income_ytd": income, "expenses_ytd": expenses, "expense_categories": expense_groups}

    businesses: list[Business] = []
    business_ctx: list[dict] = []
    for e in entities:
        if e.entity_type == "trust":
            continue
        mine = [o for o in owners if o.entity_id == e.id and o.owner_user_id in users]
        share = sum(_f(o.ownership_pct) for o in mine) / 100 if mine else 1.0
        n_owners = len([o for o in owners if o.entity_id == e.id])
        classification = e.tax_classification or _ENTITY_CLASS.get(e.entity_type) or (
            "schedule_c" if n_owners <= 1 else "partnership")
        if not e.tax_classification and e.entity_type == "llc":
            gap(f"entity_class:{e.id}", f"{e.name}: confirm how the LLC is taxed (assumed "
                f"{'sole proprietor' if classification == 'schedule_c' else 'partnership'})", "business")
        p = await pnl(Account.entity_id == e.id)
        if not p["income_ytd"] and not p["expenses_ytd"]:
            continue
        net = (p["income_ytd"] - p["expenses_ytd"]) / frac
        owner_id = str(mine[0].owner_user_id) if mine else (str(earners[0].user_id) if earners else None)
        businesses.append(Business(
            id=str(e.id), name=e.name, classification=classification, net_profit=net, owner_share=min(share, 1.0),
            owner_user_id=owner_id, home_office_sqft=float(e.home_office_sqft or 0),
            health_insurance=_f(e.health_insurance_premiums), retirement_contribution=_f(e.retirement_contribution),
        ))
        business_ctx.append({
            "id": str(e.id), "name": e.name, "entity_type": e.entity_type, "classification": classification,
            "classification_derived": not e.tax_classification, "owner_share": share,
            "owner_salary": _f(e.owner_salary) if e.owner_salary is not None else None,
            "home_office_sqft": e.home_office_sqft, "health_insurance_premiums": _f(e.health_insurance_premiums),
            "retirement_plan": e.retirement_plan, "retirement_contribution": _f(e.retirement_contribution),
            "accountable_plan": e.accountable_plan,
            **p, "projected_income": p["income_ytd"] / frac, "projected_expenses": p["expenses_ytd"] / frac,
        })
    loose = await pnl(and_(Account.entity_id.is_(None), Account.account_scope == "business"))
    if loose["income_ytd"] or loose["expenses_ytd"]:
        businesses.append(Business(
            id="unassigned", name="Business accounts (no entity)", classification="schedule_c",
            net_profit=(loose["income_ytd"] - loose["expenses_ytd"]) / frac,
            owner_user_id=str(earners[0].user_id) if earners else None,
        ))
        business_ctx.append({"id": "unassigned", "name": "Business accounts (no entity)", "entity_type": None,
                             "classification": "schedule_c", "classification_derived": True, "owner_share": 1.0,
                             **loose, "projected_income": loose["income_ytd"] / frac,
                             "projected_expenses": loose["expenses_ytd"] / frac})
        gap("unassigned_business", "Link business accounts to an entity so their income lands on the right return",
            "business")

    # ── Estimated payments ───────────────────────────────────────────────────
    pay_rows = (await db.execute(
        select(Transaction.date, Transaction.amount, Transaction.name, Transaction.merchant_name,
               Transaction.plaid_category)
        .where(
            Transaction.household_id == household_id,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.amount > 0,
            Transaction.date >= _start(date(year, 4, 1)),
            Transaction.date < _start(date(year + 1, 2, 1)),
            category_starts_with(_TAX_PAYMENT_PREFIXES),
        ).order_by(Transaction.date)
    )).all()
    est_fed = est_state = 0.0
    payments_seen = []
    for d, amt, name, merchant, cat in pay_rows:
        is_state = "state" in (cat or "").lower() or bool(_STATE_PAYEE_RE.search(f"{name} {merchant or ''}"))
        if is_state:
            est_state += float(amt)
        else:
            est_fed += float(amt)
        payments_seen.append({"date": _day(d).isoformat(), "amount": float(amt), "name": merchant or name,
                              "kind": "state" if is_state else "federal"})
    if pv("estimated_payments_federal") is not None:
        est_fed = _f(pv("estimated_payments_federal"))
    if pv("estimated_payments_state") is not None:
        est_state = _f(pv("estimated_payments_state"))
    sources["estimated_payments"] = {
        "federal": "profile" if pv("estimated_payments_federal") is not None else "transactions",
        "state": "profile" if pv("estimated_payments_state") is not None else "transactions",
        "transactions": payments_seen,
    }

    prior_agi = pv("prior_year_agi") if profile else defaults.get("prior_year_agi")
    prior_tax = pv("prior_year_tax") if profile else defaults.get("prior_year_tax")
    if profile and profile.prior_year_tax is None and defaults.get("prior_year_tax") is not None:
        prior_agi, prior_tax = defaults["prior_year_agi"], defaults["prior_year_tax"]
    if prior_tax is None:
        gap("prior_year", f"Add {year - 1}'s AGI and total tax (or upload the 1040) for the safe-harbor test", "inputs")

    inputs = TaxInputs(
        year=year,
        filing_status=status,
        state=state,
        taxpayer_age=taxpayer_age,
        spouse_age=spouse_age if status == "mfj" else None,
        dependents_under_17=int(pv("dependents_under_17") or 0),
        other_dependents=int(pv("other_dependents") or 0),
        earners=earners,
        other_ordinary_income=_f(pv("expected_bonus")) + _f(pv("other_ordinary_income")),
        interest=interest,
        ordinary_dividends=qualified,
        qualified_dividends=qualified,
        st_gains=st_gains,
        lt_gains=lt_gains,
        capital_loss_carryover=_f(pv("capital_loss_carryover")),
        businesses=businesses,
        rental_net=rental_net,
        real_estate_professional=bool(pv("real_estate_professional")),
        active_participation=pv("active_participation") is not False,
        suspended_passive_loss=_f(pv("suspended_passive_loss")),
        above_line_adjustments=_f(pv("above_line_adjustments")),
        mortgage_interest=mortgage_interest,
        property_tax=property_tax,
        charitable_cash=_f(pv("charitable_cash")),
        charitable_noncash=_f(pv("charitable_noncash")),
        medical_expenses=_f(pv("medical_expenses")),
        other_itemized=_f(pv("other_itemized")),
        prior_year_agi=float(prior_agi) if prior_agi is not None else None,
        prior_year_tax=float(prior_tax) if prior_tax is not None else None,
        estimated_federal=est_fed,
        estimated_state=est_state,
        as_of=today,
    )
    context = {
        "as_of": today.isoformat(),
        "gaps": gaps,
        "sources": sources,
        "rentals": projected_rentals,
        "rentals_actual_totals": schedule_e_totals(rentals) if rentals else None,
        "businesses": business_ctx,
        "investments": {
            "realized": {k: realized[k] for k in ("short_term", "long_term", "unknown_term", "net", "proceeds")},
            "harvest": summary["harvest"],
            "history_start": summary["history_start"],
            "unrealized_gain": unrealized_gain,
            "tax_deferred_balance": deferred_balance,
        },
        "profile_exists": profile is not None,
    }
    return inputs, context


# ─── Scenarios ───────────────────────────────────────────────────────────────

SCENARIO_FIELDS = (
    "extra_401k", "extra_ira_deductible", "extra_hsa", "roth_conversion", "bonus", "realize_ltcg",
    "harvest_losses", "charitable_extra", "business_expense", "business_retirement", "s_corp_salary",
    "extra_withholding", "extra_estimated_federal",
)


def apply_scenario(base: TaxInputs, changes: dict) -> TaxInputs:
    """A copy of `base` with what-if changes applied (amounts in dollars, ≥ 0)."""
    inp = base.copy()
    get = lambda k: max(0.0, float(changes.get(k) or 0))  # noqa: E731

    if get("extra_401k") and inp.earners:
        e = max(inp.earners, key=lambda x: x.wages)
        e.wages = max(0.0, e.wages - get("extra_401k"))
        e.k401_traditional += get("extra_401k")
    inp.above_line_adjustments += get("extra_ira_deductible") + get("extra_hsa")
    inp.roth_conversion += get("roth_conversion")
    inp.other_ordinary_income += get("bonus")
    inp.lt_gains += get("realize_ltcg")
    inp.st_gains -= get("harvest_losses")
    inp.charitable_cash += get("charitable_extra")
    if get("extra_withholding") and inp.earners:
        inp.earners[0].federal_withheld += get("extra_withholding")
    inp.estimated_federal += get("extra_estimated_federal")

    pass_through = [b for b in inp.businesses if b.classification in ("schedule_c", "partnership", "s_corp")]
    if pass_through:
        biz = max(pass_through, key=lambda b: b.net_profit)
        biz.net_profit -= get("business_expense")
        biz.retirement_contribution += get("business_retirement")
        salary = get("s_corp_salary")
        if salary and biz.classification == "schedule_c":
            t = tt.table_for(inp.year)
            ss_part = min(salary, t.ss_wage_base)
            employer_fica = ss_part * tt.SS_RATE / 2 + salary * tt.MEDICARE_RATE / 2
            biz.classification = "s_corp"
            biz.net_profit -= salary + employer_fica
            inp.earners.append(Earner(user_id=biz.owner_user_id, name=f"{biz.name} salary", wages=salary,
                                      medicare_wages=salary, ss_wages=ss_part))
            # Both halves of payroll FICA: the employee's withheld, the employer's a business cost
            inp.other_taxes += ss_part * tt.SS_RATE + salary * tt.MEDICARE_RATE
    return inp


# ─── Serialization ───────────────────────────────────────────────────────────

_FLOAT_KEYS = ("rate", "owner_share", "year_fraction", "confidence_score")


def serialize(obj, key: str = ""):
    """Money floats → "1234.56" strings (the API's Decimal convention); rates stay floats."""
    if isinstance(obj, dict):
        return {k: serialize(v, k) for k, v in obj.items()}
    if isinstance(obj, list):
        return [serialize(v, key) for v in obj]
    if isinstance(obj, float):
        if key.endswith(_FLOAT_KEYS):
            return round(obj, 4)
        return f"{obj + 0.0 if abs(obj) >= 0.005 else 0.0:.2f}"
    return obj


async def build_tax_projection(db: AsyncSession, household_id: uuid.UUID, year: int) -> tuple[dict, TaxInputs, dict]:
    inputs, ctx = await gather_inputs(db, household_id, year)
    return compute(inputs), inputs, ctx
