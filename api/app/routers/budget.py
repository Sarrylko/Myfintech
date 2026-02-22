import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import extract, func, select
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


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _actual_spent(
    db: AsyncSession,
    household_id: uuid.UUID,
    category_id: uuid.UUID,
    month: int,
    year: int,
    is_income: bool,
) -> Decimal:
    """
    Compute absolute spending for a budget category in a given month/year.
    Expense categories: sum abs(amount) for negative transactions.
    Income categories: sum amount for positive transactions.
    Excludes ignored and pending transactions.
    """
    if is_income:
        amount_filter = Transaction.amount > 0
        amount_expr = func.coalesce(func.sum(Transaction.amount), 0)
    else:
        amount_filter = Transaction.amount < 0
        amount_expr = func.coalesce(func.sum(func.abs(Transaction.amount)), 0)

    result = await db.execute(
        select(amount_expr).where(
            Transaction.household_id == household_id,
            Transaction.custom_category_id == category_id,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            extract("month", Transaction.date) == month,
            extract("year", Transaction.date) == year,
            amount_filter,
        )
    )
    return Decimal(str(result.scalar() or 0))


async def _enrich(
    budget: Budget,
    db: AsyncSession,
    household_id: uuid.UUID,
) -> BudgetWithActualResponse:
    spent = await _actual_spent(
        db, household_id, budget.category_id,
        budget.month, budget.year, budget.category.is_income,
    )
    remaining = budget.amount - spent
    percent = (spent / budget.amount * 100) if budget.amount else Decimal("0")
    return BudgetWithActualResponse(
        id=budget.id,
        household_id=budget.household_id,
        category_id=budget.category_id,
        category=budget.category,
        amount=budget.amount,
        month=budget.month,
        year=budget.year,
        rollover_enabled=budget.rollover_enabled,
        alert_threshold=budget.alert_threshold,
        created_at=budget.created_at,
        actual_spent=spent,
        remaining=remaining,
        percent_used=percent.quantize(Decimal("0.01")),
    )


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
            select(Budget).where(
                Budget.household_id == user.household_id,
                Budget.category_id == item.category_id,
                Budget.month == item.month,
                Budget.year == item.year,
            )
        )
        if existing.scalar_one_or_none():
            continue

        budget = Budget(
            household_id=user.household_id,
            category_id=item.category_id,
            amount=item.amount,
            month=item.month,
            year=item.year,
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
    """Copy all budgets from previous month into target month/year. Skips existing."""
    if month == 1:
        prev_month, prev_year = 12, year - 1
    else:
        prev_month, prev_year = month - 1, year

    prev_result = await db.execute(
        select(Budget).where(
            Budget.household_id == user.household_id,
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
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()
    if month is None:
        month = today.month
    if year is None:
        year = today.year

    result = await db.execute(
        select(Budget).where(
            Budget.household_id == user.household_id,
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
        select(Budget).where(
            Budget.household_id == user.household_id,
            Budget.category_id == payload.category_id,
            Budget.month == payload.month,
            Budget.year == payload.year,
        )
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
        month=payload.month,
        year=payload.year,
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
