"""Pure federal + state income tax estimate for one household-year.

Takes already-annualized inputs (see tax_projection.gather_inputs) and walks
the 1040: total income → AGI → deductions → taxable income → tax, credits,
NIIT, Additional Medicare, self-employment tax, then payments and the
safe-harbor test. No database access, so scenarios just copy the inputs,
change a few fields and compute again.

Simplifications, surfaced as `assumptions` in the result:
  - dividends from cash sweeps are interest; all other dividends are qualified
  - capital loss carryover is treated as long-term
  - QBI above the threshold assumes a non-service business with no W-2 wages
    or property paid, so the deduction phases out to zero
  - state tax is the state's top (or flat) rate on AGI less the federal
    standard deduction
  - the $25k rental loss allowance assumes active participation unless told
    otherwise; married filing separately gets none
"""

import copy
import math
from dataclasses import dataclass, field
from datetime import date

from app.services import tax_tables as tt


@dataclass
class Earner:
    user_id: str | None
    name: str
    wages: float = 0.0              # W-2 box 1
    medicare_wages: float = 0.0     # box 5
    ss_wages: float = 0.0           # box 3 (capped at the wage base by the employer)
    federal_withheld: float = 0.0
    state_withheld: float = 0.0
    k401_traditional: float = 0.0
    k401_roth: float = 0.0
    hsa_payroll: float = 0.0
    age: int | None = None


@dataclass
class Business:
    id: str
    name: str
    classification: str             # schedule_c | partnership | s_corp | c_corp
    net_profit: float               # whole business, annual, before home office
    owner_share: float = 1.0        # household's share, 0..1
    owner_user_id: str | None = None
    home_office_sqft: float = 0.0
    health_insurance: float = 0.0   # premiums paid for the owner (SE health deduction)
    retirement_contribution: float = 0.0  # SEP / solo 401(k) employer part, owner's


@dataclass
class TaxInputs:
    year: int
    filing_status: str = "single"
    state: str | None = None
    taxpayer_age: int | None = None
    spouse_age: int | None = None
    dependents_under_17: int = 0
    other_dependents: int = 0
    earners: list[Earner] = field(default_factory=list)
    other_ordinary_income: float = 0.0   # bonus not on the W-2, RSU, 1099-NEC/MISC
    roth_conversion: float = 0.0
    interest: float = 0.0
    ordinary_dividends: float = 0.0      # includes qualified
    qualified_dividends: float = 0.0
    st_gains: float = 0.0                # net short-term
    lt_gains: float = 0.0                # net long-term
    capital_loss_carryover: float = 0.0  # positive amount
    businesses: list[Business] = field(default_factory=list)
    rental_net: float = 0.0              # Schedule E after depreciation and interest
    real_estate_professional: bool = False
    active_participation: bool = True
    suspended_passive_loss: float = 0.0
    above_line_adjustments: float = 0.0  # deductible IRA, HSA outside payroll, student loan interest
    mortgage_interest: float = 0.0       # primary residence, already limited
    property_tax: float = 0.0            # primary residence (SALT)
    charitable_cash: float = 0.0
    charitable_noncash: float = 0.0
    medical_expenses: float = 0.0
    other_itemized: float = 0.0
    prior_year_agi: float | None = None
    prior_year_tax: float | None = None
    estimated_federal: float = 0.0
    estimated_state: float = 0.0
    other_taxes: float = 0.0             # payroll FICA in scenarios (an S-corp owner salary)
    as_of: date | None = None

    def copy(self) -> "TaxInputs":
        return copy.deepcopy(self)


def _pos(x: float) -> float:
    return x if x > 0 else 0.0


def _people_65(inp: TaxInputs) -> int:
    n = 1 if (inp.taxpayer_age or 0) >= 65 else 0
    if inp.filing_status == "mfj" and (inp.spouse_age or 0) >= 65:
        n += 1
    return n


def due_dates(year: int) -> list[date]:
    return [date(year, 4, 15), date(year, 6, 15), date(year, 9, 15), date(year + 1, 1, 15)]


def compute(inp: TaxInputs) -> dict:
    t = tt.table_for(inp.year)
    st = inp.filing_status if inp.filing_status in tt.FILING_STATUSES else "single"
    assumptions: list[str] = []

    # ── Wages ────────────────────────────────────────────────────────────────
    wages = sum(e.wages for e in inp.earners)
    medicare_wages = sum(e.medicare_wages or e.wages for e in inp.earners)

    # ── Businesses: pass-through income, SE tax, QBI ─────────────────────────
    ss_wages_by_owner: dict[str | None, float] = {}
    for e in inp.earners:
        ss_wages_by_owner[e.user_id] = ss_wages_by_owner.get(e.user_id, 0.0) + (e.ss_wages or e.medicare_wages or e.wages)
    se_earnings_by_owner: dict[str | None, float] = {}
    business_rows = []
    pass_through = 0.0
    se_health = 0.0
    biz_retirement = 0.0
    qbi_base = 0.0
    for b in inp.businesses:
        home_office = 0.0
        if b.classification == "schedule_c" and b.home_office_sqft > 0:
            home_office = min(b.home_office_sqft, tt.HOME_OFFICE_MAX_SQFT) * tt.HOME_OFFICE_RATE
            home_office = min(home_office, _pos(b.net_profit))  # simplified method can't create a loss
        net = (b.net_profit - home_office) * b.owner_share
        row = {
            "id": b.id, "name": b.name, "classification": b.classification,
            "net_profit": b.net_profit, "home_office": home_office, "owner_share": b.owner_share,
            "household_income": net if b.classification != "c_corp" else 0.0,
            "se_earnings": 0.0, "se_tax": 0.0, "qbi_income": 0.0,
        }
        if b.classification == "c_corp":
            business_rows.append(row)
            continue
        pass_through += net
        if b.classification in ("schedule_c", "partnership") and net > 0:
            se = net * tt.SE_EARNINGS_FACTOR
            if se >= 400:
                row["se_earnings"] = se
                se_earnings_by_owner[b.owner_user_id] = se_earnings_by_owner.get(b.owner_user_id, 0.0) + se
        health = min(b.health_insurance, _pos(net))
        retire = min(b.retirement_contribution, t.limit_sep)
        se_health += health
        biz_retirement += retire
        row["_qbi_pre"] = net - health - retire
        business_rows.append(row)

    se_tax = 0.0
    se_tax_by_owner: dict[str | None, float] = {}
    for owner, se in se_earnings_by_owner.items():
        ss_room = _pos(t.ss_wage_base - ss_wages_by_owner.get(owner, 0.0))
        tax = min(se, ss_room) * tt.SS_RATE + se * tt.MEDICARE_RATE
        se_tax_by_owner[owner] = tax
        se_tax += tax
    # Spread each owner's SE tax over their businesses by SE earnings
    for row in business_rows:
        if row["se_earnings"] > 0:
            owner_total = sum(r["se_earnings"] for r in business_rows if r["se_earnings"] > 0
                              and _owner_of(inp, r["id"]) == _owner_of(inp, row["id"]))
            owner_tax = se_tax_by_owner.get(_owner_of(inp, row["id"]), 0.0)
            row["se_tax"] = owner_tax * row["se_earnings"] / owner_total if owner_total else 0.0
        if "_qbi_pre" in row:
            row["qbi_income"] = row.pop("_qbi_pre") - row["se_tax"] / 2
            qbi_base += row["qbi_income"]
    half_se = se_tax / 2

    # ── Capital gains and losses ─────────────────────────────────────────────
    st_net = inp.st_gains
    lt_net = inp.lt_gains - _pos(inp.capital_loss_carryover)
    cap_net = st_net + lt_net
    loss_limit = tt.CAPITAL_LOSS_LIMIT[st]
    if cap_net < 0:
        capital_in_income = -min(loss_limit, -cap_net)
        new_carryover = -cap_net + capital_in_income
        pref_gain = 0.0
    else:
        capital_in_income = cap_net
        new_carryover = 0.0
        pref_gain = _pos(min(lt_net, cap_net))

    # ── Rental income and the passive loss limit ─────────────────────────────
    ordinary_dividends = max(inp.ordinary_dividends, inp.qualified_dividends)
    income_before_rental = (
        wages + inp.other_ordinary_income + inp.roth_conversion + inp.interest
        + ordinary_dividends + capital_in_income + pass_through
    )
    rental_allowed = inp.rental_net
    suspended_used = 0.0
    suspended_out = _pos(inp.suspended_passive_loss)
    if inp.rental_net > 0 and suspended_out > 0:
        suspended_used = min(suspended_out, inp.rental_net)
        rental_allowed = inp.rental_net - suspended_used
        suspended_out -= suspended_used
    elif inp.rental_net < 0 and not inp.real_estate_professional:
        loss = -inp.rental_net
        if inp.active_participation and st != "mfs":
            magi = income_before_rental - inp.above_line_adjustments
            allowance = _pos(tt.PASSIVE_ALLOWANCE - 0.5 * _pos(magi - tt.PASSIVE_PHASEOUT_START))
        else:
            allowance = 0.0
        allowed = min(loss, allowance)
        rental_allowed = -allowed
        suspended_out += loss - allowed

    total_income = income_before_rental + rental_allowed

    # ── AGI ──────────────────────────────────────────────────────────────────
    adjustments = inp.above_line_adjustments + half_se + se_health + biz_retirement
    agi = total_income - adjustments
    magi = agi

    # ── Deductions ───────────────────────────────────────────────────────────
    standard = t.standard_deduction[st] + t.additional_65[st] * _people_65(inp)
    state_paid = sum(e.state_withheld for e in inp.earners) + inp.estimated_state
    salt_cap = max(t.salt_floor[st], t.salt_cap[st] - 0.30 * _pos(magi - t.salt_phaseout_start[st]))
    salt_paid = state_paid + inp.property_tax
    salt = min(salt_paid, salt_cap)
    charity = inp.charitable_cash + inp.charitable_noncash
    if inp.year >= 2026:
        charity = _pos(charity - 0.005 * agi)  # 0.5% of AGI floor for itemizers
    medical = _pos(inp.medical_expenses - tt.MEDICAL_AGI_FLOOR * agi)
    itemized = salt + inp.mortgage_interest + charity + medical + inp.other_itemized
    itemizing = itemized > standard
    deduction = itemized if itemizing else standard
    nonitemizer_charity = 0.0
    if not itemizing and t.nonitemizer_charity:
        nonitemizer_charity = min(inp.charitable_cash, t.nonitemizer_charity.get(st, 0.0))

    senior = 0.0
    seniors = _people_65(inp)
    if seniors and inp.year <= 2028 and st != "mfs":
        senior = _pos(seniors * t.senior_deduction
                      - tt.SENIOR_PHASEOUT_RATE * _pos(magi - t.senior_phaseout_start[st]))

    taxable_before_qbi = _pos(agi - deduction - nonitemizer_charity - senior)

    # ── QBI (§199A) ──────────────────────────────────────────────────────────
    qbi = 0.0
    if qbi_base > 0:
        full = tt.QBI_RATE * min(qbi_base, _pos(taxable_before_qbi - pref_gain - inp.qualified_dividends))
        over = taxable_before_qbi - t.qbi_threshold[st]
        if over <= 0:
            qbi = full
        else:
            assumptions.append("QBI above the income threshold assumes no W-2 wages or property in the business")
            qbi = full * _pos(1 - over / t.qbi_phase_in[st])

    taxable = _pos(taxable_before_qbi - qbi)

    # ── Tax ──────────────────────────────────────────────────────────────────
    pref = min(taxable, pref_gain + min(inp.qualified_dividends, ordinary_dividends))
    ordinary_taxable = taxable - pref
    brackets = t.brackets[st]
    ordinary_tax = tt.bracket_tax(ordinary_taxable, brackets)
    pref_tax = tt.preferential_tax(ordinary_taxable, pref, t, st)
    regular_tax = ordinary_tax + pref_tax

    kids_credit = float(t.child_credit * inp.dependents_under_17 + t.other_dependent_credit * inp.other_dependents)
    if kids_credit:
        over = _pos(magi - tt.CHILD_CREDIT_PHASEOUT[st])
        kids_credit = _pos(kids_credit - 50 * math.ceil(over / 1000))
    credits = min(kids_credit, regular_tax)

    nii = inp.interest + ordinary_dividends + _pos(capital_in_income) + (
        _pos(rental_allowed) if not inp.real_estate_professional else 0.0)
    niit = tt.NIIT_RATE * min(nii, _pos(magi - tt.NIIT_THRESHOLD[st]))

    se_total = sum(se_earnings_by_owner.values())
    addl_medicare = tt.ADDL_MEDICARE_RATE * _pos(medicare_wages + se_total - tt.ADDL_MEDICARE_THRESHOLD[st])

    federal_total = _pos(regular_tax - credits) + niit + addl_medicare + se_tax + inp.other_taxes

    state_rate = tt.STATE_TAX_RATES.get((inp.state or "").upper(), tt.STATE_TAX_RATE_DEFAULT)
    if not inp.state:
        assumptions.append(f"No state set: using a {tt.STATE_TAX_RATE_DEFAULT:.0%} state rate")
    state_tax = state_rate * _pos(agi - t.standard_deduction[st])

    # ── Payments, balance and safe harbor ────────────────────────────────────
    fed_withheld = sum(e.federal_withheld for e in inp.earners)
    fed_paid = fed_withheld + inp.estimated_federal
    state_withheld = sum(e.state_withheld for e in inp.earners)
    state_paid_total = state_withheld + inp.estimated_state

    current_year_test = 0.9 * federal_total
    if inp.prior_year_tax is not None:
        high = (inp.prior_year_agi or 0) > tt.SAFE_HARBOR_HIGH_AGI[st]
        prior_test = (1.10 if high else 1.00) * inp.prior_year_tax
        required = min(current_year_test, prior_test)
        harbor_basis = f"{'110' if high else '100'}% of last year's tax" if prior_test < current_year_test else "90% of this year's tax"
    else:
        required = current_year_test
        harbor_basis = "90% of this year's tax (add last year's tax for the prior-year test)"
    shortfall = _pos(required - fed_paid)

    today = inp.as_of or date.today()
    remaining_dates = [d for d in due_dates(inp.year) if d >= today]
    quarterly = [
        {
            "due": d.isoformat(),
            "suggested": shortfall / len(remaining_dates) if remaining_dates else 0.0,
        }
        for d in remaining_dates
    ]

    pos = tt.bracket_position(ordinary_taxable, brackets)
    ltcg_band = 0.0 if taxable <= t.ltcg_0[st] else 0.15 if taxable <= t.ltcg_15[st] else 0.20

    return {
        "year": inp.year,
        "table_year": t.year,
        "filing_status": st,
        "income": {
            "wages": wages,
            "other_ordinary": inp.other_ordinary_income,
            "roth_conversion": inp.roth_conversion,
            "interest": inp.interest,
            "ordinary_dividends": ordinary_dividends,
            "qualified_dividends": min(inp.qualified_dividends, ordinary_dividends),
            "short_term_gains": st_net,
            "long_term_gains": lt_net,
            "capital_gain_or_loss": capital_in_income,
            "capital_loss_carryover_out": new_carryover,
            "business": pass_through,
            "rental": rental_allowed,
            "rental_before_limits": inp.rental_net,
            "suspended_passive_used": suspended_used,
            "suspended_passive_out": suspended_out,
            "total": total_income,
        },
        "adjustments": {
            "other": inp.above_line_adjustments,
            "half_se_tax": half_se,
            "se_health_insurance": se_health,
            "business_retirement": biz_retirement,
            "total": adjustments,
        },
        "agi": agi,
        "deductions": {
            "standard": standard,
            "itemized": itemized,
            "itemizing": itemizing,
            "salt_paid": salt_paid,
            "salt_cap": salt_cap,
            "salt": salt,
            "mortgage_interest": inp.mortgage_interest,
            "charitable": charity,
            "medical": medical,
            "other": inp.other_itemized,
            "nonitemizer_charity": nonitemizer_charity,
            "senior": senior,
            "qbi": qbi,
            "taxable_before_qbi": taxable_before_qbi,
            "total": deduction + nonitemizer_charity + senior + qbi,
        },
        "taxable_income": taxable,
        "tax": {
            "ordinary": ordinary_tax,
            "capital_gains": pref_tax,
            "regular": regular_tax,
            "credits": credits,
            "niit": niit,
            "additional_medicare": addl_medicare,
            "self_employment": se_tax,
            "other": inp.other_taxes,
            "federal_total": federal_total,
            "state": state_tax,
            "state_rate": state_rate,
            "total": federal_total + state_tax,
        },
        "payments": {
            "federal_withheld": fed_withheld,
            "federal_estimated": inp.estimated_federal,
            "federal_total": fed_paid,
            "state_withheld": state_withheld,
            "state_estimated": inp.estimated_state,
            "state_total": state_paid_total,
        },
        "balance": {
            "federal": federal_total - fed_paid,     # > 0 owed, < 0 refund
            "state": state_tax - state_paid_total,
        },
        "safe_harbor": {
            "required": required,
            "basis": harbor_basis,
            "paid": fed_paid,
            "shortfall": shortfall,
            "met": shortfall <= 0,
            "quarterly": quarterly,
        },
        "rates": {
            "effective_rate": federal_total / total_income if total_income > 0 else 0.0,
            "marginal_rate": pos["rate"],
            "next_rate": pos["next_rate"],
            "ltcg_rate": ltcg_band,
        },
        "bracket": {
            "floor": pos["floor"],
            "ceiling": pos["ceiling"],
            "room": pos["room"],
            "ordinary_taxable": ordinary_taxable,
            "ltcg_0_top": t.ltcg_0[st],
            "ltcg_15_top": t.ltcg_15[st],
            "room_in_0_ltcg": _pos(t.ltcg_0[st] - taxable),
            "brackets": [
                {"rate": rate, "ceiling": None if cap == math.inf else cap} for cap, rate in brackets
            ],
        },
        "businesses": business_rows,
        "assumptions": assumptions,
    }


def _owner_of(inp: TaxInputs, business_id: str) -> str | None:
    for b in inp.businesses:
        if b.id == business_id:
            return b.owner_user_id
    return None


def total_tax(inp: TaxInputs) -> float:
    return compute(inp)["tax"]["total"]
