import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account, Transaction
from app.models.budget import Budget
from app.models.goal import Goal
from app.models.user import User
from app.schemas.goal import GoalCreate, GoalUpdate, GoalWithProgressResponse

router = APIRouter(prefix="/goals", tags=["goals"])


async def _fetch_goal(goal_id: uuid.UUID, db: AsyncSession) -> Goal | None:
    """Fetch a goal with relationships eagerly loaded (avoids MissingGreenlet in async)."""
    result = await db.execute(
        select(Goal)
        .options(selectinload(Goal.linked_account), selectinload(Goal.linked_budget))
        .where(Goal.id == goal_id)
    )
    return result.scalar_one_or_none()


async def _compute_progress(
    goal: Goal,
    db: AsyncSession,
    household_id: uuid.UUID,
) -> tuple[Decimal, Decimal, int, bool]:
    """Returns (progress_amount, progress_percent, days_remaining, is_on_track)."""
    today = date.today()
    days_remaining = max(0, (goal.target_date - today).days)
    total_days = max(1, (goal.target_date - goal.start_date).days)
    days_elapsed = max(0, (today - goal.start_date).days)

    if goal.linked_account_id:
        result = await db.execute(
            select(Account.current_balance).where(
                Account.id == goal.linked_account_id,
                Account.household_id == household_id,
            )
        )
        balance = result.scalar_one_or_none()
        progress_amount = Decimal(str(balance or 0))
    elif goal.linked_budget_id:
        result = await db.execute(select(Budget).where(Budget.id == goal.linked_budget_id))
        budget = result.scalar_one_or_none()
        if budget:
            from datetime import datetime
            start_dt = datetime.combine(goal.start_date, datetime.min.time())
            end_dt = datetime.combine(today, datetime.max.time())
            stmt = (
                select(func.sum(Transaction.amount))
                .where(
                    Transaction.household_id == household_id,
                    Transaction.custom_category_id == budget.category_id,
                    Transaction.is_ignored == False,  # noqa: E712
                    Transaction.pending == False,  # noqa: E712
                    Transaction.date >= start_dt,
                    Transaction.date <= end_dt,
                )
            )
            result = await db.execute(stmt)
            spent = result.scalar_one_or_none()
            progress_amount = Decimal(str(abs(spent or 0)))
        else:
            progress_amount = Decimal(str(goal.current_amount or 0))
    else:
        progress_amount = Decimal(str(goal.current_amount or 0))

    target = Decimal(str(goal.target_amount))
    if target > 0:
        progress_percent = min(Decimal("100"), (progress_amount / target * 100).quantize(Decimal("0.01")))
    else:
        progress_percent = Decimal("0")

    expected_fraction = Decimal(str(days_elapsed)) / Decimal(str(total_days))
    expected_amount = target * expected_fraction
    is_on_track = progress_amount >= expected_amount

    return progress_amount, progress_percent, days_remaining, is_on_track


def _build_response(
    goal: Goal,
    progress_amount: Decimal,
    progress_percent: Decimal,
    days_remaining: int,
    is_on_track: bool,
) -> GoalWithProgressResponse:
    return GoalWithProgressResponse(
        **{c.name: getattr(goal, c.name) for c in Goal.__table__.columns},
        linked_account=goal.linked_account,
        linked_budget=goal.linked_budget,
        progress_amount=progress_amount,
        progress_percent=progress_percent,
        days_remaining=days_remaining,
        is_on_track=is_on_track,
    )


@router.get("/", response_model=list[GoalWithProgressResponse])
async def list_goals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Goal)
        .options(selectinload(Goal.linked_account), selectinload(Goal.linked_budget))
        .where(Goal.household_id == current_user.household_id)
        .order_by(Goal.target_date)
    )
    goals = result.scalars().all()

    out = []
    for goal in goals:
        progress = await _compute_progress(goal, db, current_user.household_id)
        out.append(_build_response(goal, *progress))
    return out


@router.post("/", response_model=GoalWithProgressResponse, status_code=201)
async def create_goal(
    data: GoalCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.linked_account_id:
        result = await db.execute(
            select(Account).where(
                Account.id == data.linked_account_id,
                Account.household_id == current_user.household_id,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Account not found")

    if data.linked_budget_id:
        result = await db.execute(
            select(Budget).where(
                Budget.id == data.linked_budget_id,
                Budget.household_id == current_user.household_id,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Budget not found")

    goal = Goal(household_id=current_user.household_id, **data.model_dump())
    db.add(goal)
    await db.commit()

    # Re-fetch with relationships eagerly loaded
    goal = await _fetch_goal(goal.id, db)

    progress = await _compute_progress(goal, db, current_user.household_id)
    return _build_response(goal, *progress)


@router.patch("/{goal_id}", response_model=GoalWithProgressResponse)
async def update_goal(
    goal_id: uuid.UUID,
    data: GoalUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Goal).where(
            Goal.id == goal_id,
            Goal.household_id == current_user.household_id,
        )
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)

    await db.commit()

    # Re-fetch with relationships eagerly loaded
    goal = await _fetch_goal(goal_id, db)

    progress = await _compute_progress(goal, db, current_user.household_id)
    return _build_response(goal, *progress)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Goal).where(
            Goal.id == goal_id,
            Goal.household_id == current_user.household_id,
        )
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    await db.delete(goal)
    await db.commit()
