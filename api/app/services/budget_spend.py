"""Which transactions count toward a budget.

Shared by the budgets API and the WhatsApp budget notifications so both report
the same "spent" figure. Callers must outer-join Category on
Transaction.custom_category_id and Account on Transaction.account_id.
"""
import uuid

from sqlalchemy import and_, func, not_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models.account import Account, Category, Transaction
from app.services.report_types import (
    PROPERTY_EXPENSE_PREFIXES,
    RENTAL_INCOME_PREFIXES,
    category_starts_with,
    report_type_expr,
)

# ─── Plaid category prefix map ─────────────────────────────────────────────────
# Maps custom category name (lowercase) → Plaid category prefixes to match.
# Transactions are matched if their plaid_category starts with any of these strings.
# This lets budget actuals automatically count Plaid-imported transactions that
# haven't been manually re-categorized with custom_category_id.

PLAID_PREFIXES: dict[str, list[str]] = {
    "food & dining":     ["food & dining"],
    "housing":           ["housing"],
    "transportation":    ["transportation"],
    "shopping":          ["shopping"],
    "entertainment":     ["entertainment"],
    "healthcare":        ["healthcare"],
    "utilities":         ["bills & utilities", "utilities"],
    "subscriptions":     ["service > subscription", "subscription"],
    "education":         ["education"],
    "personal care":     ["personal care"],
    "savings":           ["savings & investments", "savings"],
    "insurance":         ["insurance"],
    "travel":            ["travel"],
    "gifts & charity":   ["gifts & donations", "charitable"],
    "pets":              ["pets"],
    # income categories
    "salary":            ["income > salary", "payroll"],
    "freelance":         ["income > freelance", "income > self"],
    "investment income": ["income > investment", "income > dividends"],
    "rental income":     ["income > rental"],
    "other income":      ["income"],
}


def budget_amount_expr(is_income: bool) -> ColumnElement:
    """SUM of the absolute amounts counted toward a budget."""
    if is_income:
        return func.coalesce(func.sum(func.abs(Transaction.amount)), 0)
    return func.coalesce(func.sum(Transaction.amount), 0)


def budget_txn_filters(
    category_id: uuid.UUID,
    category_name: str,
    is_income: bool,
    report_types: dict[str, str],
) -> list[ColumnElement[bool]]:
    """WHERE clauses (minus household and date range) for a budget's transactions.

    Matches transactions explicitly tagged with the budget's category, or whose
    plaid_category starts with one of the category's Plaid prefixes. Excludes
    ignored, pending, transfers (per the household's "Counts as" settings),
    rental income, property expenses (unless explicitly tagged) and business
    accounts. Savings still count, so a savings budget tracks contributions.
    """
    prefixes = PLAID_PREFIXES.get(category_name.lower(), [category_name.lower()])
    explicitly_tagged = Transaction.custom_category_id == category_id
    category_match = or_(
        explicitly_tagged,
        *[func.lower(Transaction.plaid_category).like(f"{p.lower()}%") for p in prefixes],
    )
    return [
        category_match,
        Transaction.is_ignored == False,  # noqa: E712
        Transaction.pending == False,  # noqa: E712
        Transaction.amount < 0 if is_income else Transaction.amount > 0,
        or_(Category.id.is_(None), Category.is_transfer == False),  # noqa: E712
        or_(Category.id.is_(None), Category.is_rental_income == False),  # noqa: E712
        or_(Category.id.is_(None), Category.is_property_expense == False),  # noqa: E712
        report_type_expr(report_types) != "transfer",
        not_(category_starts_with(RENTAL_INCOME_PREFIXES)),
        # A transaction explicitly tagged to this budget's category always counts,
        # even if Plaid auto-tagged it as a property expense
        or_(explicitly_tagged, not_(category_starts_with(PROPERTY_EXPENSE_PREFIXES))),
        or_(Account.id.is_(None), and_(Account.entity_id.is_(None), Account.account_scope != "business")),
    ]
