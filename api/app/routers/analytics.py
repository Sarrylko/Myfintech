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
from app.models.user import User

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
    "subscriptions":     ["service > subscription", "subscription"],
    # Plaid uses "Kids & Family > ..." and "Community > Education"
    "education":         ["education", "kids & family", "community > education"],
    "personal care":     ["personal care"],
    "savings":           ["savings & investments", "savings"],
    "insurance":         ["insurance"],
    "travel":            ["travel"],
    "gifts & charity":   ["gifts & donations", "charitable"],
    "pets":              ["pets"],
    # Plaid uses "Taxes > Federal Tax", "Taxes > State Tax", "Community > Government..."
    "taxes":             ["taxes", "community > government"],
    # income categories
    "salary":            ["income > salary", "transfer > payroll", "payroll"],
    "freelance":         ["income > freelance", "income > self"],
    "investment income": ["income > investment", "income > dividends"],
    "rental income":     ["income > rental"],
    "other income":      ["income"],
}

_TRANSFER_PLAID_PREFIXES = [
    "transfer",
    "payment > credit card",
    "payment > credit",
    "payment > loan",
]

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


class SankeyResponse(BaseModel):
    nodes: list[SankeyNode]
    links: list[SankeyLink]
    total_income: float
    total_expenses: float
    remaining: float
    month: int
    year: int


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


# ─── Endpoint ─────────────────────────────────────────────────────────────────


@router.get("/sankey", response_model=SankeyResponse)
async def get_sankey_data(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    member_id: uuid.UUID | None = Query(None),
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
    transfer_conditions = [
        func.lower(Transaction.plaid_category).like(f"{p.lower()}%")
        for p in _TRANSFER_PLAID_PREFIXES
    ]
    not_a_transfer = not_(or_(*transfer_conditions))

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
    )
