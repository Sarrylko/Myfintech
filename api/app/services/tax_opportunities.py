"""Year-end moves that would lower this household's tax, each priced in dollars.

Every rule looks at the projection and, when it applies, prices the move by
re-running the tax calculation with the move applied (tax_projection.
apply_scenario), so interactions — phase-outs, the QBI limit, the 0% gains
band — are counted rather than approximated by a marginal rate. Each
opportunity carries the scenario it was priced with, so the What-if tab can
load it. Moves that cost tax now for a later benefit (a Roth conversion,
harvesting gains) report `tax_cost` instead of `est_savings`.

Rules are heuristics for discussion with a tax preparer, not advice: they
don't know about plan eligibility, state conformity or anything off-books.
"""

from datetime import date

from app.services import tax_tables as tt
from app.services.tax_calc import TaxInputs, compute
from app.services.tax_projection import apply_scenario

_SCORP_ADMIN_COST = 2_000.0      # payroll service + 1120-S preparation, per year
_PENALTY_RATE = 0.07             # IRS underpayment interest, annual
_MIN_SAVINGS = 100.0


def _saved(inp: TaxInputs, base_total: float, changes: dict) -> float:
    return base_total - compute(apply_scenario(inp, changes))["tax"]["total"]


def _catchup_401k(t: tt.TaxYear, age: int | None) -> float:
    if age is None or age < 50:
        return 0.0
    return t.catchup_401k_60_63 if 60 <= age <= 63 else t.catchup_401k


def build_opportunities(inp: TaxInputs, result: dict, ctx: dict) -> list[dict]:
    t = tt.table_for(inp.year)
    st = result["filing_status"]
    today = inp.as_of or date.today()
    year_end = date(inp.year, 12, 31)
    filing_deadline = date(inp.year + 1, 4, 15)
    open_year = today <= year_end
    base = result["tax"]["total"]
    marginal = result["rates"]["marginal_rate"]
    agi = result["agi"]
    out: list[dict] = []

    def add(oid: str, title: str, scope: str, why: str, action: str, *, deadline: date | None,
            confidence: str, est_savings: float | None = None, tax_cost: float | None = None,
            scenario: dict | None = None) -> None:
        if est_savings is not None and est_savings < _MIN_SAVINGS:
            return
        out.append({
            "id": oid, "title": title, "scope": scope, "why": why, "action": action,
            "deadline": deadline.isoformat() if deadline else None, "confidence": confidence,
            "est_savings": est_savings, "tax_cost": tax_cost, "scenario": scenario,
        })

    # ── Personal ─────────────────────────────────────────────────────────────
    if open_year:
        for e in inp.earners:
            limit = t.limit_401k + _catchup_401k(t, inp.taxpayer_age)
            room = limit - e.k401_traditional - e.k401_roth
            if room <= 500 or e.wages <= 0:
                continue
            room = min(room, e.wages)
            paychecks = max(1, (year_end - today).days // 14)
            add(f"401k:{e.user_id}", f"Max out the 401(k) — {e.name}", "personal",
                f"${room:,.0f} of the ${limit:,.0f} limit is unused. Traditional deferrals come off taxable wages "
                f"at your {marginal:.0%} bracket.",
                f"Raise the payroll deferral by about ${room / paychecks:,.0f} per paycheck for the "
                f"~{paychecks} remaining biweekly paychecks.",
                deadline=year_end, confidence="high",
                est_savings=_saved(inp, base, {"extra_401k": room}), scenario={"extra_401k": round(room)})

    hsa_used = sum(e.hsa_payroll for e in inp.earners)
    if hsa_used > 0:
        family = st == "mfj" or inp.dependents_under_17 + inp.other_dependents > 0
        limit = (t.limit_hsa_family if family else t.limit_hsa_self) + (
            t.catchup_hsa if (inp.taxpayer_age or 0) >= 55 else 0)
        room = limit - hsa_used
        if room > 200:
            add("hsa", "Fill the HSA", "personal",
                f"You've put ${hsa_used:,.0f} of the ${limit:,.0f} {'family' if family else 'self-only'} limit "
                "into an HSA. Contributions are deductible, growth and medical withdrawals tax-free.",
                "Contribute the rest directly to the HSA (payroll contributions also skip FICA). "
                "Requires HDHP coverage.",
                deadline=filing_deadline, confidence="medium",
                est_savings=_saved(inp, base, {"extra_hsa": room}), scenario={"extra_hsa": round(room)})

    lo, hi = t.roth_ira_phaseout[st]
    if agi > hi:
        add("backdoor_roth", "Backdoor Roth IRA", "personal",
            f"Income above ${hi:,.0f} rules out direct Roth IRA contributions.",
            f"Make a non-deductible ${t.limit_ira:,.0f} traditional IRA contribution per person and convert it "
            "to Roth. Watch the pro-rata rule if you hold pre-tax IRA balances.",
            deadline=filing_deadline, confidence="medium")
    elif agi < lo:
        add("roth_ira", "Contribute to a Roth IRA", "personal",
            f"Income is under the ${lo:,.0f} Roth IRA phase-out.",
            f"Contribute up to ${t.limit_ira:,.0f} per person; growth and qualified withdrawals are tax-free.",
            deadline=filing_deadline, confidence="medium")

    deferred = ctx["investments"]["tax_deferred_balance"]
    room = result["bracket"]["room"]
    if open_year and deferred > 1_000 and room and room > 1_000 and marginal <= 0.22:
        amount = min(room, deferred)
        cost = -_saved(inp, base, {"roth_conversion": amount})
        add("roth_conversion", f"Roth conversion to fill the {marginal:.0%} bracket", "personal",
            f"${room:,.0f} more ordinary income still fits in the {marginal:.0%} bracket, and you hold "
            f"${deferred:,.0f} in tax-deferred accounts that will be taxed when withdrawn.",
            f"Convert about ${amount:,.0f} from a traditional IRA/401(k) to Roth. Pay the tax from cash, "
            "not from the conversion.",
            deadline=year_end, confidence="medium" if marginal <= 0.12 else "low",
            tax_cost=cost, scenario={"roth_conversion": round(amount)})

    harvest = ctx["investments"]["harvest"]
    loss = -float(harvest["total_loss"])
    if open_year and loss > 500:
        wash = [c["ticker"] for c in harvest["candidates"] if c.get("recent_buy")]
        add("tax_loss_harvest", "Harvest investment losses", "personal",
            f"Taxable positions are ${loss:,.0f} below cost. Losses offset this year's gains first, then up to "
            f"${tt.CAPITAL_LOSS_LIMIT[st]:,.0f} of income, and the rest carries forward.",
            "Sell the losing lots and buy a similar (not substantially identical) fund."
            + (f" Wait out the 30-day wash-sale window on {', '.join(filter(None, wash))}." if wash else ""),
            deadline=year_end, confidence="high",
            est_savings=_saved(inp, base, {"harvest_losses": loss}), scenario={"harvest_losses": round(loss)})

    zero_room = result["bracket"]["room_in_0_ltcg"]
    unrealized = ctx["investments"]["unrealized_gain"]
    if open_year and zero_room > 1_000 and unrealized > 1_000:
        amount = min(zero_room, unrealized)
        cost = max(0.0, -_saved(inp, base, {"realize_ltcg": amount}))
        future = amount * 0.15 - cost
        if future > _MIN_SAVINGS:
            add("gain_harvest", "Harvest gains at 0%", "personal",
                f"${zero_room:,.0f} of long-term gains can be realized in the 0% bracket this year.",
                f"Sell and immediately rebuy about ${amount:,.0f} of long-held winners to raise their basis "
                "(no wash-sale rule for gains).",
                deadline=year_end, confidence="medium",
                est_savings=future, tax_cost=cost or None, scenario={"realize_ltcg": round(amount)})

    d = result["deductions"]
    gifts = inp.charitable_cash + inp.charitable_noncash
    if open_year and not d["itemizing"] and gifts > 0 and d["itemized"] + gifts >= 0.8 * d["standard"]:
        add("bunch_charity", "Bunch charitable giving", "personal",
            f"Itemized deductions (${d['itemized']:,.0f}) fall short of the ${d['standard']:,.0f} standard "
            "deduction, so your gifts save little.",
            "Give two years of donations this year — e.g. through a donor-advised fund — and itemize; "
            "take the standard deduction next year.",
            deadline=year_end, confidence="medium",
            est_savings=_saved(inp, base, {"charitable_extra": inp.charitable_cash}),
            scenario={"charitable_extra": round(inp.charitable_cash)})
    if t.nonitemizer_charity and not d["itemizing"] and inp.charitable_cash == 0:
        cap = t.nonitemizer_charity.get(st, 0)
        add("nonitemizer_charity", "Deduct cash gifts without itemizing", "personal",
            f"From {t.year}, non-itemizers can deduct up to ${cap:,.0f} of cash gifts to charity.",
            "Record cash donations in the profile so they count (donor-advised funds don't qualify).",
            deadline=year_end, confidence="low", est_savings=cap * marginal)

    if d["itemizing"] and agi > t.salt_phaseout_start[st] and d["salt_cap"] > t.salt_floor[st]:
        add("salt_phaseout", "SALT cap is phasing down", "personal",
            f"Above ${t.salt_phaseout_start[st]:,.0f} of income, each dollar cuts the SALT cap by 30¢ "
            f"(now ${d['salt_cap']:,.0f}), adding ~{marginal * 0.3:.0%} to your marginal rate.",
            "Pre-tax deferrals, HSA contributions and harvested losses lower MAGI and win back SALT deduction.",
            deadline=year_end, confidence="medium")

    sh = result["safe_harbor"]
    if open_year or today <= date(inp.year + 1, 1, 15):
        if sh["shortfall"] > 1_000 and sh["quarterly"]:
            nxt = date.fromisoformat(sh["quarterly"][0]["due"])
            months_late = max(1.0, (date(inp.year + 1, 4, 15) - nxt).days / 30)
            add("underpayment", "Avoid the underpayment penalty", "personal",
                f"Tax paid so far (${sh['paid']:,.0f}) is ${sh['shortfall']:,.0f} short of the safe harbor "
                f"({sh['basis']}).",
                f"Pay ${sh['shortfall']:,.0f} in estimated tax by {nxt:%b %d}, or raise W-4 withholding — "
                "withholding counts as paid evenly through the year, even if it's withheld in December.",
                deadline=nxt, confidence="high",
                est_savings=sh["shortfall"] * _PENALTY_RATE * months_late / 12,
                scenario={"extra_estimated_federal": round(sh["shortfall"])})
    if result["balance"]["federal"] < -3_000:
        add("over_withheld", "You're over-withheld", "personal",
            f"Projected refund of ${-result['balance']['federal']:,.0f}: an interest-free loan to the IRS.",
            "File a new W-4 to lower withholding for next year (keep the safe harbor in mind).",
            deadline=None, confidence="medium")

    # ── Business ─────────────────────────────────────────────────────────────
    biz_ctx = {b["id"]: b for b in ctx["businesses"]}
    biz_rows = {r["id"]: r for r in result["businesses"]}
    for b in inp.businesses:
        info = biz_ctx.get(b.id, {})
        row = biz_rows.get(b.id, {})
        share_net = b.net_profit * b.owner_share
        if b.classification == "c_corp" or share_net <= 0:
            continue

        if b.classification == "schedule_c" and share_net > 40_000:
            salary = max(info.get("owner_salary") or 0.0, round(share_net * 0.4, -3))
            saved = _saved(inp, base, {"s_corp_salary": salary}) - _SCORP_ADMIN_COST
            add(f"s_corp:{b.id}", f"Consider an S-corp election — {b.name}", "business",
                f"As a sole proprietor all ${share_net:,.0f} of profit pays 15.3% self-employment tax. An S-corp "
                f"pays payroll tax only on a reasonable salary (assumed ${salary:,.0f}).",
                "Talk to your CPA about Form 2553 (due Mar 15 for next year). The salary must be defensible for "
                "your role — the IRS challenges low salaries — and payroll adds ~$2k/yr of cost (already netted).",
                deadline=date(inp.year + 1, 3, 15), confidence="medium",
                est_savings=saved, scenario={"s_corp_salary": salary})

        if (info.get("retirement_plan") or "none") == "none" and b.retirement_contribution == 0 and share_net > 10_000:
            if b.classification == "s_corp":
                base_pay = info.get("owner_salary") or 0.0
                amount = min(0.25 * base_pay, t.limit_sep)
            else:
                amount = min(0.20 * (share_net - row.get("se_tax", 0.0) / 2), t.limit_sep)
            if amount > 1_000:
                add(f"retirement_plan:{b.id}", f"Open a Solo 401(k) or SEP — {b.name}", "business",
                    f"Business profit allows about ${amount:,.0f} of deductible employer contributions "
                    f"(limit ${t.limit_sep:,.0f}).",
                    "A Solo 401(k) must be opened by Dec 31 to add employee deferrals; a SEP-IRA can be opened "
                    "and funded until the filing deadline.",
                    deadline=year_end if open_year else filing_deadline, confidence="high",
                    est_savings=_saved(inp, base, {"business_retirement": amount}),
                    scenario={"business_retirement": round(amount)})

        if b.classification == "schedule_c" and not b.home_office_sqft:
            add(f"home_office:{b.id}", f"Home office deduction — {b.name}", "business",
                "Space used regularly and exclusively for the business is deductible: $5/sq ft up to 300 sq ft "
                "under the simplified method.",
                "Measure the office and enter its square footage on the business inputs.",
                deadline=None, confidence="low",
                est_savings=_saved(inp, base, {"business_expense": 1_500}))

        if open_year and share_net > 20_000:
            add(f"equipment:{b.id}", f"Time equipment purchases — {b.name}", "business",
                "100% bonus depreciation (and §179) deducts qualifying equipment, vehicles over 6,000 lb and "
                "software in the year they're placed in service.",
                "Buy what the business already needs before Dec 31 and put it in service this year. "
                "The estimate is per $10,000 spent.",
                deadline=year_end, confidence="medium",
                est_savings=_saved(inp, base, {"business_expense": 10_000}), scenario={"business_expense": 10_000})

        if not info.get("health_insurance_premiums") and b.classification in ("schedule_c", "partnership", "s_corp"):
            add(f"se_health:{b.id}", f"Self-employed health insurance — {b.name}", "business",
                "Health, dental and long-term-care premiums for you and your family are deductible above the "
                "line when you aren't eligible for an employer plan.",
                "If you pay your own premiums, enter the annual amount on the business inputs.",
                deadline=None, confidence="low")

        if b.classification == "s_corp" and not info.get("accountable_plan"):
            add(f"accountable_plan:{b.id}", f"Adopt an accountable plan — {b.name}", "business",
                "Employees (you included) can't deduct unreimbursed expenses; an accountable plan lets the "
                "S-corp reimburse home office, phone and mileage tax-free and deduct it.",
                "Adopt a written plan, submit expense reports with receipts, and reimburse within 60 days.",
                deadline=year_end, confidence="medium")

        if b.classification in ("schedule_c", "s_corp", "partnership"):
            add(f"augusta:{b.id}", f"Augusta rule (rent your home to the business) — {b.name}", "business",
                "Renting your home to the business for up to 14 days a year for real meetings is deductible "
                "to the business and tax-free to you (§280A(g)).",
                "Only with market-rate rent, real business meetings and documentation (agendas, minutes, "
                "comparable rates) — the Tax Court disallowed it without them (Sinopoli, 2023).",
                deadline=year_end, confidence="low")

    dq = result["deductions"]
    if dq["qbi"] > 0 or any(r.get("qbi_income", 0) > 0 for r in result["businesses"]):
        over = dq["taxable_before_qbi"] - t.qbi_threshold[st]
        if 0 < over < t.qbi_phase_in[st]:
            add("qbi_threshold", "Get back under the QBI threshold", "business",
                f"Taxable income is ${over:,.0f} over the ${t.qbi_threshold[st]:,.0f} threshold, which "
                "phases out the 20% QBI deduction.",
                "Retirement contributions and other deductions that cut taxable income restore it.",
                deadline=year_end, confidence="medium",
                est_savings=_saved(inp, base, {"business_retirement": min(over, t.limit_sep)}),
                scenario={"business_retirement": round(min(over, t.limit_sep))})

    # ── Rentals ──────────────────────────────────────────────────────────────
    suspended = result["income"]["suspended_passive_out"]
    if suspended > 0:
        add("passive_loss", "Rental losses are being suspended", "rental",
            f"${suspended:,.0f} of rental losses can't offset other income this year "
            "(income above $150k phases out the $25k allowance).",
            "They carry forward and are released against future rental profit or when you sell. "
            "Real estate professional status (750+ hours) or a short-term rental would change this — ask your CPA.",
            deadline=None, confidence="high")
    for r in ctx["rentals"]:
        if r["depreciable_basis"] > 500_000:
            add(f"cost_seg:{r['property_id']}", f"Cost segregation study — {r['address']}", "rental",
                f"${r['depreciable_basis']:,.0f} of building basis depreciates over 27.5 years. A study typically "
                "reclassifies 20–30% to 5/7/15-year property, deductible now with 100% bonus depreciation.",
                "Get a quote for an engineering-based study; worth most when the losses aren't passive-limited.",
                deadline=None, confidence="low")

    out.sort(key=lambda o: -(o["est_savings"] or 0))
    return out

