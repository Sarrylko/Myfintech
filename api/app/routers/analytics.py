"""
Analytics router — provides aggregated data for dashboard visualisations.

Endpoints
---------
GET /api/v1/analytics/sankey?month={month}&year={year}
    Returns income-to-expense flow data for a Sankey diagram.
    Income nodes are split by category and (for Salary) by household member.
    Expense nodes are individual spending categories.
    A "Remaining / Saved" node is appended when income exceeds expenses.
"""

import uuid
from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account, Category, Transaction
from app.models.property import Property
from app.models.property_details import Loan
from app.models.salary_withholdings import SalaryWithholding
from app.models.user import User
from app.services.loan_split import match_loan, split_loan_payment
from app.services.report_types import load_report_types, report_type_expr, spending_filters

router = APIRouter(prefix="/analytics", tags=["analytics"])

# ─── Plaid prefix map (mirrors budget.py) ────────────────────────────────────

_PLAID_PREFIXES: dict[str, list[str]] = {
    # Plaid uses both "Food & Dining" and "Food and Drink > Restaurants"
    "food & dining":     ["food & dining", "food and drink"],
    # Plaid uses "Housing" for rent/mortgage labels but also "Financial > Loan Payments"
    "housing":           ["housing", "financial > loan"],
    "transportation":    ["transportation"],
    # Plaid uses "Shops > ..." for retail (warehouses, supermarkets, etc.)
    "shopping":          ["shopping", "shops"],
    # Plaid uses "Recreation > ..." for movies, sports, etc.
    "entertainment":     ["entertainment", "recreation"],
    # Plaid uses "Health & Medical > ..." (pharmacy, doctor, etc.)
    "healthcare":        ["healthcare", "health & medical"],
    "utilities":         ["bills & utilities", "utilities"],
    "subscriptions":     ["service > subscription", "subscription", "entertainment > subscriptions"],
    # Plaid uses "Kids & Family > ..." and "Community > Education"
    "education":         ["education", "kids & family", "community > education"],
    "personal care":     ["personal care"],
    "savings":           ["savings & investments", "savings"],
    "insurance":         ["insurance"],
    "travel":            ["travel"],
    "gifts & charity":   ["gifts & donations", "charitable"],
    "pets":              ["pets"],
    # Plaid uses "Taxes > Federal Tax", "Taxes > State Tax", "Community > Government..."
    "taxes":             ["taxes", "community > government", "miscellaneous > government fees"],
    # income categories
    "salary":            ["income > salary", "transfer > payroll", "payroll"],
    "freelance":         ["income > freelance", "income > self"],
    "investment income": ["income > investment", "income > dividends"],
    "rental income":     ["income > rental"],
    "other income":      ["income"],
}

# ─── Income node colour palette ───────────────────────────────────────────────

_INCOME_COLORS: dict[str, str] = {
    "salary": "#6366f1",   # indigo  (per-member suffix applied below)
    "others": "#94a3b8",   # slate
}

_REMAINING_COLOR = "#22c55e"   # green
_EXPENSE_FALLBACK_COLOR = "#f59e0b"  # amber

# Distinct colors for plaid-matched expense categories (used when no custom category color exists)
_PLAID_EXPENSE_COLORS: dict[str, str] = {
    "food & dining":    "#f97316",   # orange
    "housing":          "#3b82f6",   # blue
    "transportation":   "#8b5cf6",   # violet
    "shopping":         "#ec4899",   # pink
    "entertainment":    "#a855f7",   # purple
    "healthcare":       "#ef4444",   # red
    "utilities":        "#06b6d4",   # cyan
    "subscriptions":    "#6366f1",   # indigo
    "education":        "#14b8a6",   # teal
    "personal care":    "#f59e0b",   # amber
    "savings":          "#22c55e",   # green
    "insurance":        "#64748b",   # slate
    "travel":           "#0ea5e9",   # sky
    "gifts & charity":  "#d946ef",   # fuchsia
    "pets":             "#84cc16",   # lime
    "taxes":            "#dc2626",   # red
    "other expenses":   "#94a3b8",   # cool-gray
    # App taxonomy groups ("Group > Item" categories)
    "health & medical": "#ef4444",
    "kids & family":    "#14b8a6",
    "gifts & donations": "#d946ef",
    "financial":        "#64748b",
    "business":         "#78716c",
    "miscellaneous":    "#94a3b8",
    "uncategorized":    "#cbd5e1",
}

# ─── Schemas ──────────────────────────────────────────────────────────────────


class SankeyNode(BaseModel):
    id: str
    label: str
    color: str
    value: float


class SankeyLink(BaseModel):
    source: str
    target: str
    value: float


class PayrollPerson(BaseModel):
    """One earner's full-year W-2 figures."""
    user_id: str
    name: str
    employer: str
    gross: float
    federal_tax: float
    state_tax: float
    social_security: float
    medicare: float
    health_benefits: float
    traditional_401k: float
    roth_401k: float
    esop: float


class PayrollSummary(BaseModel):
    """Totals for the flow's period (W-2 figures prorated when the year is in progress)."""
    taxes: float
    health_benefits: float
    payroll_investments: float
    take_home: float
    expenses: float
    housing: float
    savings_transfers: float
    loan_principal: float
    unallocated: float
    # Tracked spending + saving beyond take-home pay (funded by other income or savings)
    uncovered: float
    # Months in the period that have any spending; low coverage makes rates meaningless
    months_with_data: int
    period_months: int
    people: list[PayrollPerson]


class SankeyResponse(BaseModel):
    nodes: list[SankeyNode]
    links: list[SankeyLink]
    total_income: float
    total_expenses: float
    remaining: float
    month: int
    year: int
    is_annual: bool = False
    sankey_type: str = "standard"
    gross_income: float = 0.0
    period_start: date | None = None
    period_end: date | None = None
    prorated: bool = False
    payroll: PayrollSummary | None = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _plaid_to_income_category(plaid_category: str | None) -> str:
    """Map a plaid_category string to 'salary' or 'others'."""
    if not plaid_category:
        return "others"
    lower = plaid_category.lower()
    for p in _PLAID_PREFIXES["salary"]:
        if lower.startswith(p.lower()):
            return "salary"
    return "others"


def _plaid_to_expense_category(plaid_category: str | None) -> str:
    """Map a plaid_category string to a canonical expense category name."""
    if not plaid_category:
        return "other expenses"
    lower = plaid_category.lower()
    for cat_name, prefixes in _PLAID_PREFIXES.items():
        if cat_name not in _INCOME_COLORS:
            for p in prefixes:
                if lower.startswith(p.lower()):
                    return cat_name
    return "other expenses"


# ─── Payroll colours ──────────────────────────────────────────────────────────

_L1_PERSON_COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe"]

_PAYROLL_NODE_COLORS: dict[str, str] = {
    "l2_federal_tax":    "#ef4444",
    "l2_state_tax":      "#f97316",
    "l2_ss_tax":         "#f59e0b",
    "l2_medicare_tax":   "#eab308",
    "l2_health_benefits": "#06b6d4",
    "l3_investments":    "#22c55e",
    "l3_expense_pool":   "#6366f1",
    "l4_trad_401k":      "#16a34a",
    "l4_roth_401k":      "#15803d",
    "l4_esop_stock":     "#a855f7",
}

# ─── Annual payroll Sankey builder ────────────────────────────────────────────


async def _build_annual_payroll_sankey(
    household_id: uuid.UUID,
    year: int,
    db: AsyncSession,
    members: dict[uuid.UUID, str],
) -> SankeyResponse | None:
    """Build a 4-layer payroll Sankey from W-2 data + the year's transactions.

    For the current year the W-2 figures (entered as full-year amounts) are
    prorated to the elapsed part of the year, so pay and spending cover the
    same period.  Take-home pay then flows to spending by category (loan
    payments count interest/escrow only), to savings transfers, to loan
    principal, and whatever is left is "Unallocated".
    """
    result = await db.execute(
        select(SalaryWithholding).where(
            SalaryWithholding.household_id == household_id,
            SalaryWithholding.year == year,
        ).order_by(SalaryWithholding.employer_name)
    )
    w2_records = result.scalars().all()

    if not w2_records:
        return None  # caller falls back to standard flow

    # ── Period ───────────────────────────────────────────────────────────────
    today = date.today()
    period_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    period_end = min(today, year_end) if year == today.year else year_end
    days_in_year = (year_end - period_start).days + 1
    factor = Decimal((period_end - period_start).days + 1) / Decimal(days_in_year)
    prorated = factor < 1

    def part(value: Decimal | None) -> Decimal:
        return (Decimal(str(value or 0)) * factor).quantize(Decimal("0.01"))

    nodes: list[SankeyNode] = []
    links: list[SankeyLink] = []

    # Per-bucket combined deduction totals (L2)
    l2_buckets: dict[str, Decimal] = {
        "l2_federal_tax": Decimal("0"),
        "l2_state_tax": Decimal("0"),
        "l2_ss_tax": Decimal("0"),
        "l2_medicare_tax": Decimal("0"),
        "l2_health_benefits": Decimal("0"),
    }
    l2_bucket_labels = {
        "l2_federal_tax": "Federal Tax",
        "l2_state_tax": "State Tax",
        "l2_ss_tax": "Social Security",
        "l2_medicare_tax": "Medicare",
        "l2_health_benefits": "Health & Benefits",
    }

    l3_investments_total = Decimal("0")
    take_home_total = Decimal("0")
    l4_trad_401k_total = Decimal("0")
    l4_roth_401k_total = Decimal("0")
    l4_esop_total = Decimal("0")
    gross_total = Decimal("0")
    people: list[PayrollPerson] = []

    # ── Layer 1 + 2 ─────────────────────────────────────────────────────────
    for i, rec in enumerate(w2_records):
        uid_str = str(rec.user_id).replace("-", "")[:12]
        l1_id = f"l1_{uid_str}"
        l2_net_id = f"l2_net_{uid_str}"

        name = members.get(rec.user_id, rec.employer_name or f"Person {i+1}")
        employer = rec.employer_name or ""
        label = f"{name} ({employer})" if employer else name

        gross = part(rec.gross_wages)
        gross_total += gross
        color = _L1_PERSON_COLORS[i % len(_L1_PERSON_COLORS)]

        nodes.append(SankeyNode(id=l1_id, label=label, color=color, value=float(gross)))

        deductions = {
            "l2_federal_tax": part(rec.federal_income_tax),
            "l2_state_tax": part(rec.state_income_tax),
            "l2_ss_tax": part(rec.social_security_tax),
            "l2_medicare_tax": part(rec.medicare_tax),
            "l2_health_benefits": part(rec.health_insurance),
        }
        for bucket_id, ded_amt in deductions.items():
            l2_buckets[bucket_id] += ded_amt
            if ded_amt > 0:
                links.append(SankeyLink(source=l1_id, target=bucket_id, value=float(ded_amt)))

        net = gross - sum(deductions.values(), Decimal("0"))
        nodes.append(SankeyNode(id=l2_net_id, label=f"Net ({name})", color="#94a3b8", value=float(net)))
        links.append(SankeyLink(source=l1_id, target=l2_net_id, value=float(net)))

        # L3 investments from this person's net
        trad, roth, esop = part(rec.traditional_401k), part(rec.roth_401k), part(rec.esop_income)
        invest_amt = trad + roth + esop
        take_home = net - invest_amt
        l3_investments_total += invest_amt
        take_home_total += take_home
        l4_trad_401k_total += trad
        l4_roth_401k_total += roth
        l4_esop_total += esop

        if invest_amt > 0:
            links.append(SankeyLink(source=l2_net_id, target="l3_investments", value=float(invest_amt)))
        links.append(SankeyLink(source=l2_net_id, target="l3_expense_pool", value=float(take_home)))

        # Full-year W-2 figures per earner (not prorated)
        full = lambda v: float(v or 0)  # noqa: E731
        people.append(PayrollPerson(
            user_id=str(rec.user_id),
            name=name,
            employer=employer,
            gross=full(rec.gross_wages),
            federal_tax=full(rec.federal_income_tax),
            state_tax=full(rec.state_income_tax),
            social_security=full(rec.social_security_tax),
            medicare=full(rec.medicare_tax),
            health_benefits=full(rec.health_insurance),
            traditional_401k=full(rec.traditional_401k),
            roth_401k=full(rec.roth_401k),
            esop=full(rec.esop_income),
        ))

    # ── Layer 2 deduction bucket nodes ──────────────────────────────────────
    for bucket_id, total_amt in l2_buckets.items():
        if total_amt > 0:
            nodes.append(SankeyNode(
                id=bucket_id,
                label=l2_bucket_labels[bucket_id],
                color=_PAYROLL_NODE_COLORS[bucket_id],
                value=float(total_amt),
            ))

    # ── Layer 3 nodes ────────────────────────────────────────────────────────
    nodes.append(SankeyNode(
        id="l3_investments",
        label="Payroll investing",
        color=_PAYROLL_NODE_COLORS["l3_investments"],
        value=float(l3_investments_total),
    ))
    nodes.append(SankeyNode(
        id="l3_expense_pool",
        label="Take-home",
        color=_PAYROLL_NODE_COLORS["l3_expense_pool"],
        value=float(take_home_total),
    ))

    # ── Layer 4 investment breakdown nodes + links ───────────────────────────
    for node_id, label, amt in [
        ("l4_trad_401k", "Traditional 401k", l4_trad_401k_total),
        ("l4_roth_401k", "Roth 401k", l4_roth_401k_total),
        ("l4_esop_stock", "ESOP / Stock", l4_esop_total),
    ]:
        if amt > 0:
            nodes.append(SankeyNode(id=node_id, label=label, color=_PAYROLL_NODE_COLORS[node_id], value=float(amt)))
            links.append(SankeyLink(source="l3_investments", target=node_id, value=float(amt)))

    # ── Layer 4 outflows of take-home pay, from the period's transactions ───
    report_types = await load_report_types(db, household_id)
    in_period = [
        Transaction.household_id == household_id,
        Transaction.date >= period_start,
        Transaction.date <= period_end,
    ]

    loans = (await db.execute(
        select(Loan).join(Property, Property.id == Loan.property_id)
        .where(Property.household_id == household_id)
    )).scalars().all()

    spend_rows = await db.execute(
        select(
            Transaction.amount, Transaction.date, Transaction.plaid_category,
            Transaction.name, Transaction.merchant_name,
        )
        .outerjoin(Account, Account.id == Transaction.account_id)
        .where(*in_period, *spending_filters(report_types))
    )

    expense_totals: dict[str, Decimal] = {}
    loan_principal = Decimal("0")
    months_with_data: set[tuple[int, int]] = set()
    for row in spend_rows:
        months_with_data.add((row.date.year, row.date.month))
        amount = Decimal(str(row.amount))
        group = (row.plaid_category or "Uncategorized").split(" > ")[0].strip() or "Uncategorized"
        loan = match_loan(amount, row.plaid_category, row.name, row.merchant_name, loans)
        if loan is not None:
            split = split_loan_payment(amount, row.date, loan)
            if split is not None:
                loan_principal += split.principal
                amount = split.interest + split.escrow
            # Mortgage interest and escrow are housing costs, whatever the category says
            if (loan.loan_type or "mortgage") in ("mortgage", "heloc", "second_mortgage"):
                group = "Housing"
        expense_totals[group] = expense_totals.get(group, Decimal("0")) + amount

    savings_transfers = (await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .outerjoin(Account, Account.id == Transaction.account_id)
        .where(
            *in_period,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,  # noqa: E712
            Transaction.amount > 0,
            report_type_expr(report_types) == "savings",
            or_(Account.id.is_(None), and_(Account.entity_id.is_(None), Account.account_scope != "business")),
        )
    )).scalar_one()
    savings_transfers = Decimal(str(savings_transfers or 0))

    total_expenses = sum(expense_totals.values(), Decimal("0"))
    housing = expense_totals.get("Housing", Decimal("0"))

    # Flow order: spending (largest first), then saving; capped at take-home
    outflows: list[tuple[str, str, str, Decimal]] = []
    for label, amt in sorted(expense_totals.items(), key=lambda x: x[1], reverse=True):
        slug = label.lower().replace(" ", "_").replace("/", "_").replace("&", "and")
        color = _PLAID_EXPENSE_COLORS.get(label.lower(), _EXPENSE_FALLBACK_COLOR)
        outflows.append((f"l4_{slug}", label, color, amt))
    outflows.append(("l4_savings_transfers", "Savings & investing", "#10b981", savings_transfers))
    outflows.append(("l4_loan_principal", "Loan principal (equity)", "#0d9488", loan_principal))

    used = Decimal("0")
    for node_id, label, color, amt in outflows:
        if amt <= Decimal("0.01"):
            continue
        nodes.append(SankeyNode(id=node_id, label=label, color=color, value=float(amt)))
        link_val = min(amt, take_home_total - used)
        if link_val > Decimal("0.01"):
            links.append(SankeyLink(source="l3_expense_pool", target=node_id, value=float(link_val)))
            used += link_val

    unallocated = take_home_total - used
    if unallocated > Decimal("0.01"):
        nodes.append(SankeyNode(id="l4_remaining", label="Unallocated", color=_REMAINING_COLOR, value=float(unallocated)))
        links.append(SankeyLink(source="l3_expense_pool", target="l4_remaining", value=float(unallocated)))

    tracked_outflows = total_expenses + savings_transfers + loan_principal
    taxes = sum((l2_buckets[k] for k in ("l2_federal_tax", "l2_state_tax", "l2_ss_tax", "l2_medicare_tax")), Decimal("0"))

    return SankeyResponse(
        nodes=nodes,
        links=links,
        total_income=float(gross_total),
        total_expenses=float(total_expenses),
        remaining=float(max(Decimal("0"), unallocated)),
        month=1,
        year=year,
        is_annual=True,
        sankey_type="payroll",
        gross_income=float(gross_total),
        period_start=period_start,
        period_end=period_end,
        prorated=prorated,
        payroll=PayrollSummary(
            taxes=float(taxes),
            health_benefits=float(l2_buckets["l2_health_benefits"]),
            payroll_investments=float(l3_investments_total),
            take_home=float(take_home_total),
            expenses=float(total_expenses),
            housing=float(housing),
            savings_transfers=float(savings_transfers),
            loan_principal=float(loan_principal),
            unallocated=float(max(Decimal("0"), unallocated)),
            uncovered=float(max(Decimal("0"), tracked_outflows - take_home_total)),
            months_with_data=len(months_with_data),
            period_months=period_end.month - period_start.month + 1,
            people=people,
        ),
    )


# ─── Endpoint ─────────────────────────────────────────────────────────────────


@router.get("/sankey", response_model=SankeyResponse)
async def get_sankey_data(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    member_id: uuid.UUID | None = Query(None),
    annual: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SankeyResponse:
    """
    Return income-to-expense flow data for a given date range.

    Accepts either start_date+end_date (ISO strings) or month+year.
    Optional member_id filters income and expenses to a specific household member.

    Income is grouped by category and, for Salary, split further by account owner
    (household member) so the diagram shows e.g. "Sarvjeet - Salary" and
    "Pritpal - Salary" as separate source nodes.
    """
    household_id = user.household_id

    # ── Annual payroll mode ──────────────────────────────────────────────────
    if annual:
        resolved_year = year or date.today().year
        member_rows = await db.execute(
            select(User.id, User.full_name).where(User.household_id == household_id)
        )
        members_map: dict[uuid.UUID, str] = {row.id: row.full_name for row in member_rows}
        payroll_result = await _build_annual_payroll_sankey(household_id, resolved_year, db, members_map)
        if payroll_result is not None:
            return payroll_result
        # Fall through to standard flow with full-year date range
        year = resolved_year
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)

    # Resolve date range — prefer explicit start/end, fall back to month/year
    if start_date and end_date:
        month = start_date.month
        year = start_date.year
    elif month is not None and year is not None:
        start_date = date(year, month, 1)
        end_date = date(year, month, monthrange(year, month)[1])
    else:
        # Default to current month
        today = date.today()
        month = today.month
        year = today.year
        start_date = date(year, month, 1)
        end_date = date(year, month, monthrange(year, month)[1])

    # ── 1. Load household members (id → full_name) ───────────────────────────
    member_rows = await db.execute(
        select(User.id, User.full_name).where(User.household_id == household_id)
    )
    members: dict[uuid.UUID, str] = {row.id: row.full_name for row in member_rows}

    # ── 2. Shared filter clauses ─────────────────────────────────────────────
    # Income/spending only: excludes transfers and savings, honouring the
    # household's "Counts as" category settings
    not_a_transfer = report_type_expr(await load_report_types(db, household_id)) == "cashflow"

    # Allow transfer > payroll through — it is a payroll deposit, not a regular transfer
    payroll_conditions = [
        func.lower(Transaction.plaid_category).like("transfer > payroll%"),
    ]
    is_payroll_transfer = or_(*payroll_conditions)
    income_transfer_filter = or_(not_a_transfer, is_payroll_transfer)

    rental_conditions = [
        func.lower(Transaction.plaid_category).like(f"{p.lower()}%")
        for p in ["income > rental", "rental income"]
    ]
    not_rental_income = not_(or_(*rental_conditions))

    property_expense_conditions = [
        func.lower(Transaction.plaid_category).like(f"{p.lower()}%")
        for p in ["home improvement", "home services", "property tax", "home insurance"]
    ]
    not_property_expense = not_(or_(*property_expense_conditions))

    base_filters = [
        Transaction.household_id == household_id,
        Transaction.is_ignored == False,  # noqa: E712
        Transaction.pending == False,  # noqa: E712
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        not_rental_income,
    ]

    # Member filter — optional per-person view
    income_member_filter = (
        [Account.owner_user_id == member_id] if member_id else []
    )
    expense_member_filter = (
        [or_(Account.owner_user_id == member_id, Account.owner_user_id.is_(None))]
        if member_id
        else []
    )

    # ── 3. Income transactions ───────────────────────────────────────────────
    income_rows = await db.execute(
        select(
            Transaction.amount,
            Transaction.name.label("txn_name"),
            Transaction.plaid_category,
            Account.owner_user_id,
            Account.type.label("account_type"),
            Account.subtype.label("account_subtype"),
            Category.name.label("cat_name"),
            Category.is_income,
        )
        .outerjoin(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.custom_category_id)
        .where(
            *base_filters,
            *income_member_filter,
            Transaction.amount < 0,
            income_transfer_filter,           # transfers allowed if employer payroll
            # exclude transfer and rental-income custom categories
            or_(Category.id.is_(None), Category.is_transfer == False),   # noqa: E712
            or_(Category.id.is_(None), Category.is_rental_income == False),  # noqa: E712
            # exclude business accounts
            or_(
                Account.id.is_(None),
                and_(Account.entity_id.is_(None), Account.account_scope != "business"),
            ),
        )
    )

    # Aggregate income by node label
    income_totals: dict[str, Decimal] = {}
    income_category_for_label: dict[str, str] = {}  # label → canonical category key
    income_owner_for_label: dict[str, uuid.UUID | None] = {}  # label → owner UUID (None = household)

    # Employer rule: Costco credit into a depository account = salary for that member
    _EMPLOYER_RULES: list[tuple[str, list[str]]] = [
        ("costco", ["checking", "savings"]),
    ]

    def _is_employer_salary(txn_name: str, acct_subtype: str | None) -> bool:
        name_lower = (txn_name or "").lower()
        subtype = (acct_subtype or "").lower()
        return any(
            kw in name_lower and subtype in subtypes
            for kw, subtypes in _EMPLOYER_RULES
        )

    for row in income_rows:
        amount = abs(row.amount)

        # Employer rule takes priority over Plaid category
        if _is_employer_salary(row.txn_name, row.account_subtype):
            cat_key = "salary"
            if row.owner_user_id and row.owner_user_id in members:
                label = f"{members[row.owner_user_id]} - Salary"
                owner = row.owner_user_id
            else:
                label = "Salary"
                owner = None
        elif row.cat_name and row.is_income:
            cat_key_raw = row.cat_name.lower()
            if "salary" in cat_key_raw:
                cat_key = "salary"
                if row.owner_user_id and row.owner_user_id in members:
                    label = f"{members[row.owner_user_id]} - Salary"
                    owner = row.owner_user_id
                else:
                    label = "Salary"
                    owner = None
            else:
                # Non-salary custom income category → Others
                cat_key = "others"
                label = "Others"
                owner = None
        else:
            cat_key = _plaid_to_income_category(row.plaid_category)
            if cat_key == "salary":
                if row.owner_user_id and row.owner_user_id in members:
                    label = f"{members[row.owner_user_id]} - Salary"
                    owner = row.owner_user_id
                else:
                    label = "Salary"
                    owner = None
            else:
                label = "Others"
                owner = None

        income_totals[label] = income_totals.get(label, Decimal("0")) + amount
        if label not in income_category_for_label:
            base_key = "salary" if "salary" in label.lower() else cat_key
            income_category_for_label[label] = base_key
        if label not in income_owner_for_label:
            income_owner_for_label[label] = owner

    # ── 4. Expense transactions ──────────────────────────────────────────────
    expense_rows = await db.execute(
        select(
            Transaction.amount,
            Transaction.plaid_category,
            Account.owner_user_id,
            Category.name.label("cat_name"),
            Category.color.label("cat_color"),
            Category.is_income,
            Category.is_transfer,
            Category.is_property_expense,
        )
        .outerjoin(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.custom_category_id)
        .where(
            *base_filters,
            *expense_member_filter,
            not_a_transfer,          # expenses: always exclude transfers
            Transaction.amount > 0,
            not_property_expense,
            or_(Category.id.is_(None), Category.is_transfer == False),   # noqa: E712
            or_(Category.id.is_(None), Category.is_income == False),     # noqa: E712
            or_(Category.id.is_(None), Category.is_property_expense == False),  # noqa: E712
            or_(
                Account.id.is_(None),
                and_(Account.entity_id.is_(None), Account.account_scope != "business"),
            ),
        )
    )

    # Aggregate expenses by category label and account owner
    expense_totals: dict[str, Decimal] = {}
    expense_colors: dict[str, str] = {}
    # expense_by_payer[label][owner_uuid or None] = amount
    # None key = paid from a shared / unowned account
    expense_by_payer: dict[str, dict[uuid.UUID | None, Decimal]] = {}

    for row in expense_rows:
        amount = row.amount
        payer = row.owner_user_id  # None means shared/unowned account

        if row.cat_name and not row.is_income and not row.is_transfer:
            label = row.cat_name
            color = row.cat_color or _PLAID_EXPENSE_COLORS.get(label.lower(), _EXPENSE_FALLBACK_COLOR)
        else:
            cat_key = _plaid_to_expense_category(row.plaid_category)
            label = cat_key.title()
            color = _PLAID_EXPENSE_COLORS.get(cat_key, _EXPENSE_FALLBACK_COLOR)

        expense_totals[label] = expense_totals.get(label, Decimal("0")) + amount
        if label not in expense_colors:
            expense_colors[label] = color
        if label not in expense_by_payer:
            expense_by_payer[label] = {}
        expense_by_payer[label][payer] = expense_by_payer[label].get(payer, Decimal("0")) + amount

    # ── 5. Totals and remaining ──────────────────────────────────────────────
    total_income = sum(income_totals.values(), Decimal("0"))
    total_expenses = sum(expense_totals.values(), Decimal("0"))
    remaining = max(Decimal("0"), total_income - total_expenses)

    if total_income == 0:
        return SankeyResponse(
            nodes=[], links=[],
            total_income=0, total_expenses=float(total_expenses),
            remaining=float(remaining), month=month or 1, year=year or date.today().year,
            is_annual=False, sankey_type="standard", gross_income=0.0,
        )

    # ── 6. Build nodes ───────────────────────────────────────────────────────
    nodes: list[SankeyNode] = []

    # Income source nodes
    for label, amount in sorted(income_totals.items(), key=lambda x: x[1], reverse=True):
        if amount <= 0:
            continue
        cat_key = income_category_for_label.get(label, "others")
        color = _INCOME_COLORS.get(cat_key, _INCOME_COLORS["others"])
        nodes.append(SankeyNode(id=f"src_{label}", label=label, color=color, value=float(amount)))

    # Expense destination nodes
    for label, amount in sorted(expense_totals.items(), key=lambda x: x[1], reverse=True):
        if amount <= 0:
            continue
        nodes.append(SankeyNode(
            id=f"dst_{label}",
            label=label,
            color=expense_colors.get(label, _EXPENSE_FALLBACK_COLOR),
            value=float(amount),
        ))

    # Remaining / Saved node
    if remaining > Decimal("0.01"):
        nodes.append(SankeyNode(
            id="dst_remaining",
            label="Remaining / Saved",
            color=_REMAINING_COLOR,
            value=float(remaining),
        ))

    # ── 7. Build links (account-based attribution) ───────────────────────────
    # Expenses from a member-owned account flow from that member's income nodes.
    # Expenses from shared/unowned accounts are split proportionally across all
    # income sources by fraction of total income.
    links: list[SankeyLink] = []
    source_node_ids = {n.label: n.id for n in nodes if n.id.startswith("src_")}

    # Total income per person (sum across all their income nodes)
    income_by_owner: dict[uuid.UUID, Decimal] = {}
    for lbl, amt in income_totals.items():
        owner = income_owner_for_label.get(lbl)
        if owner:
            income_by_owner[owner] = income_by_owner.get(owner, Decimal("0")) + amt

    for src_label, src_amount in income_totals.items():
        if src_amount <= 0:
            continue
        src_id = source_node_ids.get(src_label)
        if not src_id:
            continue

        src_owner = income_owner_for_label.get(src_label)  # UUID or None
        # Fraction of this source among all income (for shared expense allocation)
        global_fraction = src_amount / total_income
        # Fraction of this source among the owner's total income (for owned expense allocation)
        owner_total = income_by_owner.get(src_owner, Decimal("0")) if src_owner else Decimal("0")
        owner_fraction = src_amount / owner_total if owner_total > 0 else Decimal("0")

        for dst_label, dst_amount in expense_totals.items():
            if dst_amount <= 0:
                continue

            payer_map = expense_by_payer.get(dst_label, {})
            owned_amount = payer_map.get(src_owner, Decimal("0")) if src_owner else Decimal("0")
            shared_amount = payer_map.get(None, Decimal("0"))

            # Owned portion: attributed to this person's income nodes by their income share
            # Shared portion: split proportionally across all income sources
            link_value = float(owner_fraction * owned_amount) + float(global_fraction * shared_amount)
            if link_value < 0.01:
                continue
            links.append(SankeyLink(
                source=src_id,
                target=f"dst_{dst_label}",
                value=round(link_value, 2),
            ))

        # Remaining / Saved — proportional (household surplus, not per-person)
        if remaining > Decimal("0.01"):
            rem_value = float(global_fraction * remaining)
            if rem_value >= 0.01:
                links.append(SankeyLink(
                    source=src_id,
                    target="dst_remaining",
                    value=round(rem_value, 2),
                ))

    return SankeyResponse(
        nodes=nodes,
        links=links,
        total_income=float(total_income),
        total_expenses=float(total_expenses),
        remaining=float(remaining),
        month=month or 1,
        year=year or date.today().year,
        is_annual=False,
        sankey_type="standard",
        gross_income=0.0,
    )
