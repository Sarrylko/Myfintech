import uuid
from calendar import monthrange
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Category, Transaction
from app.models.budget import Budget
from app.models.user import User
from app.schemas.budget import (
    BudgetBulkCreate,
    BudgetCreate,
    BudgetUpdate,
    BudgetWithActualResponse,
)

router = APIRouter(prefix="/budgets", tags=["budgets"])

# ─── Plaid category prefix map ─────────────────────────────────────────────────
# Maps custom category name (lowercase) → Plaid category prefixes to match.
# Transactions are matched if their plaid_category starts with any of these strings.
# This lets budget actuals automatically count Plaid-imported transactions that
# haven't been manually re-categorized with custom_category_id.

_PLAID_PREFIXES: dict[str, list[str]] = {
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


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _date_range(budget: Budget) -> tuple[date, date]:
    """Return (start_date, end_date) for a budget based on its type."""
    if budget.budget_type == "monthly":
        last = monthrange(budget.year, budget.month)[1]
        return date(budget.year, budget.month, 1), date(budget.year, budget.month, last)
    # annual / quarterly / custom all store start_date and end_date
    return budget.start_date, budget.end_date


async def _actual_spent(
    db: AsyncSession,
    household_id: uuid.UUID,
    category_id: uuid.UUID,
    category_name: str,
    start_date: date,
    end_date: date,
    is_income: bool,
) -> Decimal:
    """
    Compute absolute spending for a budget category within a date range.

    Matches transactions by:
      1. custom_category_id (explicitly tagged by the user), OR
      2. plaid_category prefix (automatic match for Plaid-imported transactions
         that haven't been manually re-categorized yet).

    Expense categories: sums positive-amount transactions (Plaid convention: spending = positive).
    Income categories: sums abs(negative-amount) transactions (Plaid convention: deposits = negative).
    Excludes ignored transactions; includes pending for a real-time view.
    """
    if is_income:
        amount_filter = Transaction.amount < 0
        amount_expr = func.coalesce(func.sum(func.abs(Transaction.amount)), 0)
    else:
        amount_filter = Transaction.amount > 0
        amount_expr = func.coalesce(func.sum(Transaction.amount), 0)

    # Build category match: explicitly tagged OR plaid_category prefix
    prefixes = _PLAID_PREFIXES.get(category_name.lower(), [category_name.lower()])
    plaid_conditions = [
        func.lower(Transaction.plaid_category).like(f"{p.lower()}%")
        for p in prefixes
    ]
    category_match = or_(
        Transaction.custom_category_id == category_id,
        *plaid_conditions,
    )

    result = await db.execute(
        select(amount_expr).where(
            Transaction.household_id == household_id,
            category_match,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.date >= start_date,
            Transaction.date <= end_date,
            amount_filter,
        )
    )
    return Decimal(str(result.scalar() or 0))


async def _enrich(
    budget: Budget,
    db: AsyncSession,
    household_id: uuid.UUID,
) -> BudgetWithActualResponse:
    start, end = _date_range(budget)
    spent = await _actual_spent(
        db, household_id, budget.category_id,
        budget.category.name, start, end, budget.category.is_income,
    )
    remaining = budget.amount - spent
    percent = (spent / budget.amount * 100) if budget.amount else Decimal("0")
    return BudgetWithActualResponse(
        id=budget.id,
        household_id=budget.household_id,
        category_id=budget.category_id,
        category=budget.category,
        amount=budget.amount,
        budget_type=budget.budget_type,
        month=budget.month,
        year=budget.year,
        start_date=budget.start_date,
        end_date=budget.end_date,
        rollover_enabled=budget.rollover_enabled,
        alert_threshold=budget.alert_threshold,
        created_at=budget.created_at,
        actual_spent=spent,
        remaining=remaining,
        percent_used=percent.quantize(Decimal("0.01")),
    )


def _duplicate_filters(item: BudgetCreate, household_id: uuid.UUID):
    """Return SQLAlchemy WHERE conditions to detect a duplicate budget."""
    base = [Budget.household_id == household_id, Budget.category_id == item.category_id]
    if item.budget_type.value == "monthly":
        return base + [Budget.month == item.month, Budget.year == item.year,
                       Budget.budget_type == "monthly"]
    elif item.budget_type.value == "annual":
        return base + [Budget.budget_type == "annual", Budget.year == item.year]
    else:
        # quarterly / custom — match on exact date range
        return base + [Budget.start_date == item.start_date, Budget.end_date == item.end_date]


# ─── POST /budgets/bulk (BEFORE /{id} to avoid path collision) ────────────────

@router.post("/bulk", response_model=list[BudgetWithActualResponse], status_code=201)
async def create_budgets_bulk(
    payload: BudgetBulkCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple budgets at once (wizard final step). Silently skips duplicates."""
    created = []
    for item in payload.budgets:
        existing = await db.execute(
            select(Budget).where(*_duplicate_filters(item, user.household_id))
        )
        if existing.scalar_one_or_none():
            continue

        budget = Budget(
            household_id=user.household_id,
            category_id=item.category_id,
            amount=item.amount,
            budget_type=item.budget_type.value,
            month=item.month,
            year=item.year,
            start_date=item.start_date,
            end_date=item.end_date,
            rollover_enabled=item.rollover_enabled,
            alert_threshold=item.alert_threshold,
        )
        db.add(budget)
        await db.flush()
        await db.refresh(budget, attribute_names=["category"])
        created.append(await _enrich(budget, db, user.household_id))

    return created


# ─── POST /budgets/copy-from-last-month (BEFORE /{id}) ────────────────────────

@router.post(
    "/copy-from-last-month",
    response_model=list[BudgetWithActualResponse],
    status_code=201,
)
async def copy_from_last_month(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Copy all monthly budgets from previous month into target month/year. Skips existing."""
    if month == 1:
        prev_month, prev_year = 12, year - 1
    else:
        prev_month, prev_year = month - 1, year

    prev_result = await db.execute(
        select(Budget).where(
            Budget.household_id == user.household_id,
            Budget.budget_type == "monthly",
            Budget.month == prev_month,
            Budget.year == prev_year,
        )
    )
    prev_budgets = prev_result.scalars().all()

    if not prev_budgets:
        raise HTTPException(
            status_code=404,
            detail=f"No budgets found for {prev_year}-{prev_month:02d} to copy from.",
        )

    created = []
    for src in prev_budgets:
        existing = await db.execute(
            select(Budget).where(
                Budget.household_id == user.household_id,
                Budget.category_id == src.category_id,
                Budget.budget_type == "monthly",
                Budget.month == month,
                Budget.year == year,
            )
        )
        if existing.scalar_one_or_none():
            continue

        new_budget = Budget(
            household_id=user.household_id,
            category_id=src.category_id,
            amount=src.amount,
            budget_type="monthly",
            month=month,
            year=year,
            rollover_enabled=src.rollover_enabled,
            alert_threshold=src.alert_threshold,
        )
        db.add(new_budget)
        await db.flush()
        await db.refresh(new_budget, attribute_names=["category"])
        created.append(await _enrich(new_budget, db, user.household_id))

    return created


# ─── GET /budgets/ ────────────────────────────────────────────────────────────

@router.get("/", response_model=list[BudgetWithActualResponse])
async def list_budgets(
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2000),
    budget_type: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()

    if budget_type and budget_type != "monthly":
        # Long-term view: return all non-monthly budgets for the given year
        if year is None:
            year = today.year
        result = await db.execute(
            select(Budget).where(
                Budget.household_id == user.household_id,
                Budget.budget_type != "monthly",
                Budget.year == year,
            )
        )
    else:
        # Monthly view (default)
        if month is None:
            month = today.month
        if year is None:
            year = today.year
        result = await db.execute(
            select(Budget).where(
                Budget.household_id == user.household_id,
                Budget.budget_type == "monthly",
                Budget.month == month,
                Budget.year == year,
            )
        )

    budgets = result.scalars().all()
    return [await _enrich(b, db, user.household_id) for b in budgets]


# ─── POST /budgets/ ───────────────────────────────────────────────────────────

@router.post("/", response_model=BudgetWithActualResponse, status_code=201)
async def create_budget(
    payload: BudgetCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(Budget).where(*_duplicate_filters(payload, user.household_id))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="A budget for this category and period already exists.",
        )

    budget = Budget(
        household_id=user.household_id,
        category_id=payload.category_id,
        amount=payload.amount,
        budget_type=payload.budget_type.value,
        month=payload.month,
        year=payload.year,
        start_date=payload.start_date,
        end_date=payload.end_date,
        rollover_enabled=payload.rollover_enabled,
        alert_threshold=payload.alert_threshold,
    )
    db.add(budget)
    await db.flush()
    await db.refresh(budget, attribute_names=["category"])
    return await _enrich(budget, db, user.household_id)


# ─── PATCH /budgets/{id} ──────────────────────────────────────────────────────

@router.patch("/{budget_id}", response_model=BudgetWithActualResponse)
async def update_budget(
    budget_id: uuid.UUID,
    payload: BudgetUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(
            Budget.id == budget_id,
            Budget.household_id == user.household_id,
        )
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(budget, field, value)

    await db.flush()
    await db.refresh(budget, attribute_names=["category"])
    return await _enrich(budget, db, user.household_id)


# ─── DELETE /budgets/{id} ─────────────────────────────────────────────────────

@router.delete("/{budget_id}", status_code=204)
async def delete_budget(
    budget_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(
            Budget.id == budget_id,
            Budget.household_id == user.household_id,
        )
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    await db.delete(budget)
