"""How a transaction's category counts in reports.

Every category string ("Group" or "Group > Item") resolves to one of:
  cashflow — income or spending, by the sign of the amount
  transfer — moving money between own accounts; excluded everywhere
  savings  — contributions to savings/investments; not spending

Resolution order (first hit wins), mirroring frontend/src/lib/reportTypes.ts:
  household override for the full string → household override for its group →
  built-in default for the full string → built-in default for its group →
  transfer if it starts with a transfer prefix, else cashflow.
"""
import uuid

from sqlalchemy import and_, case, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models.account import Account, Transaction
from app.models.user import Household

# Keep in sync with DEFAULT_REPORT_TYPES in frontend/src/lib/reportTypes.ts
DEFAULT_REPORT_TYPES: dict[str, str] = {
    "Savings & Investments": "savings",
}

TRANSFER_PREFIXES = ("transfer", "payment > credit card", "payment > credit", "payment > loan")
RENTAL_INCOME_PREFIXES = ("income > rental", "rental income")
PROPERTY_EXPENSE_PREFIXES = ("home improvement", "home services", "property tax", "home insurance")


def _like_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def category_starts_with(prefixes: tuple[str, ...]) -> ColumnElement[bool]:
    """Case-insensitive prefix match on Transaction.plaid_category."""
    cat = func.lower(func.coalesce(Transaction.plaid_category, ""))
    return or_(*[cat.like(f"{p}%") for p in prefixes])


def category_group_expr() -> ColumnElement[str]:
    """"Food & Dining > Restaurants" → "Food & Dining" (NULL → "Uncategorized")."""
    return func.split_part(func.coalesce(Transaction.plaid_category, "Uncategorized"), " > ", 1)


def personal_cashflow_filters(report_types: dict[str, str]) -> list[ColumnElement[bool]]:
    """Settled, non-ignored, income/spending transactions on personal accounts.

    Callers must outer-join Account on Transaction.account_id.
    """
    return [
        Transaction.is_ignored == False,  # noqa: E712
        Transaction.pending == False,  # noqa: E712
        report_type_expr(report_types) == "cashflow",
        or_(Account.id.is_(None), and_(Account.entity_id.is_(None), Account.account_scope != "business")),
    ]


def spending_filters(report_types: dict[str, str]) -> list[ColumnElement[bool]]:
    """Personal spending, matching the Transactions page "Expenses" figure."""
    return [
        *personal_cashflow_filters(report_types),
        Transaction.amount > 0,
        not_(category_starts_with(PROPERTY_EXPENSE_PREFIXES)),
    ]


def income_filters(report_types: dict[str, str]) -> list[ColumnElement[bool]]:
    """Personal income (negative amounts), matching the Transactions page "Income"."""
    return [
        *personal_cashflow_filters(report_types),
        Transaction.amount < 0,
        not_(category_starts_with(RENTAL_INCOME_PREFIXES)),
    ]


def report_type_expr(overrides: dict[str, str] | None) -> ColumnElement[str]:
    """SQL expression giving the report type of Transaction.plaid_category."""
    cat = func.coalesce(Transaction.plaid_category, "")
    whens = []
    for source in (overrides or {}, DEFAULT_REPORT_TYPES):
        # Full "Group > Item" keys outrank group keys within the same source
        for key, rtype in source.items():
            if " > " in key:
                whens.append((cat == key, rtype))
        for key, rtype in source.items():
            if " > " not in key:
                whens.append((or_(cat == key, cat.like(f"{_like_escape(key)} > %", escape="\\")), rtype))
    implicit = case((category_starts_with(TRANSFER_PREFIXES), "transfer"), else_="cashflow")
    return case(*whens, else_=implicit) if whens else implicit


async def load_report_types(db: AsyncSession, household_id: uuid.UUID) -> dict[str, str]:
    result = await db.execute(
        select(Household.category_report_types).where(Household.id == household_id)
    )
    return result.scalar_one_or_none() or {}


def load_report_types_sync(db: Session, household_id: uuid.UUID) -> dict[str, str]:
    return db.execute(
        select(Household.category_report_types).where(Household.id == household_id)
    ).scalar_one_or_none() or {}
