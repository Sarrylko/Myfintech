import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Transaction
from app.models.recurring import RecurringTransaction
from app.models.user import User
from app.schemas.recurring import (
    RecurringCandidate,
    RecurringConfirmRequest,
    RecurringTransactionResponse,
    RecurringTransactionUpdate,
)
from app.services.recurring_detector import detect_recurring

router = APIRouter(prefix="/recurring", tags=["recurring"])


@router.post("/detect", response_model=list[RecurringCandidate])
async def detect_recurring_patterns(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Analyse the last 13 months of transactions and return detected recurring
    patterns. Results are NOT saved — call /recurring/confirm to save selected.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=395)
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.household_id == user.household_id,
            Transaction.date >= cutoff,
            Transaction.is_ignored == False,  # noqa: E712
        )
        .order_by(Transaction.date)
    )
    transactions = result.scalars().all()

    candidates = detect_recurring(transactions)
    return candidates


@router.post("/confirm", response_model=list[RecurringTransactionResponse], status_code=201)
async def confirm_recurring(
    payload: RecurringConfirmRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save the user-selected recurring candidates to the DB."""
    saved = []
    for c in payload.candidates:
        rec = RecurringTransaction(
            household_id=user.household_id,
            name=c.name,
            merchant_name=c.merchant_name,
            amount=c.amount,
            frequency=c.frequency,
            is_active=True,
        )
        db.add(rec)
        await db.flush()
        await db.refresh(rec)
        saved.append(rec)

    await db.commit()
    return saved


@router.get("/", response_model=list[RecurringTransactionResponse])
async def list_recurring(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all saved recurring transactions for the household."""
    result = await db.execute(
        select(RecurringTransaction)
        .where(RecurringTransaction.household_id == user.household_id)
        .order_by(RecurringTransaction.name)
    )
    return result.scalars().all()


@router.patch("/{recurring_id}", response_model=RecurringTransactionResponse)
async def update_recurring(
    recurring_id: uuid.UUID,
    payload: RecurringTransactionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecurringTransaction).where(
            RecurringTransaction.id == recurring_id,
            RecurringTransaction.household_id == user.household_id,
        )
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rec, field, value)

    await db.commit()
    await db.refresh(rec)
    return rec


@router.delete("/{recurring_id}", status_code=204)
async def delete_recurring(
    recurring_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecurringTransaction).where(
            RecurringTransaction.id == recurring_id,
            RecurringTransaction.household_id == user.household_id,
        )
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")

    await db.delete(rec)
    await db.commit()
