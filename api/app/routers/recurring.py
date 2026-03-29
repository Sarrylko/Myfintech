import uuid
from datetime import datetime, timezone, timedelta, date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Transaction
from app.models.recurring import RecurringPayment, RecurringTransaction
from app.models.user import User
from app.schemas.recurring import (
    RecurringCandidate,
    RecurringConfirmRequest,
    RecurringPaymentCreate,
    RecurringPaymentResponse,
    RecurringTransactionCreate,
    RecurringTransactionResponse,
    RecurringTransactionUpdate,
)
from app.services.recurring_detector import detect_recurring

router = APIRouter(prefix="/recurring", tags=["recurring"])

# ─── Frequency advance helpers ─────────────────────────────────────────────────

_FREQ_DAYS: dict[str, int] = {
    "weekly": 7,
    "biweekly": 14,
    "monthly": 30,
    "quarterly": 91,
    "annual": 365,
}


def _advance_due_date(current: date | None, frequency: str) -> date:
    """Return the next due date by advancing one period from current (or today)."""
    base = current if current else date.today()
    days = _FREQ_DAYS.get(frequency, 30)
    if frequency == "monthly":
        # Advance by one calendar month
        month = base.month + 1
        year = base.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        day = min(base.day, [31,29 if year % 4 == 0 else 28,31,30,31,30,31,31,30,31,30,31][month-1])
        return date(year, month, day)
    elif frequency == "annual":
        try:
            return base.replace(year=base.year + 1)
        except ValueError:
            return base.replace(year=base.year + 1, day=28)
    return base + timedelta(days=days)


# ─── Detection ─────────────────────────────────────────────────────────────────

@router.post("/detect", response_model=list[RecurringCandidate])
async def detect_recurring_patterns(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
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
    return detect_recurring(result.scalars().all())


# ─── Confirm detected ──────────────────────────────────────────────────────────

@router.post("/confirm", response_model=list[RecurringTransactionResponse], status_code=201)
async def confirm_recurring(
    payload: RecurringConfirmRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
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


# ─── Create manually ──────────────────────────────────────────────────────────

@router.post("/", response_model=RecurringTransactionResponse, status_code=201)
async def create_recurring(
    payload: RecurringTransactionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rec = RecurringTransaction(
        household_id=user.household_id,
        name=payload.name,
        merchant_name=payload.merchant_name,
        amount=payload.amount,
        frequency=payload.frequency,
        tag=payload.tag,
        spending_type=payload.spending_type,
        next_due_date=payload.next_due_date,
        start_date=payload.start_date,
        notes=payload.notes,
        is_active=True,
    )
    db.add(rec)
    await db.flush()
    await db.refresh(rec)
    await db.commit()
    return rec


# ─── List ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[RecurringTransactionResponse])
async def list_recurring(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecurringTransaction)
        .where(RecurringTransaction.household_id == user.household_id)
        .order_by(RecurringTransaction.name)
    )
    return result.scalars().all()


# ─── Update ────────────────────────────────────────────────────────────────────

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


# ─── Delete ────────────────────────────────────────────────────────────────────

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


# ─── Log payment ───────────────────────────────────────────────────────────────

@router.post("/{recurring_id}/payments", response_model=RecurringPaymentResponse, status_code=201)
async def log_payment(
    recurring_id: uuid.UUID,
    payload: RecurringPaymentCreate,
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

    # Use existing transaction or create a new one
    txn_id = None
    if payload.existing_transaction_id:
        # Verify the transaction belongs to the household
        txn_check = await db.execute(
            select(Transaction).where(
                Transaction.id == payload.existing_transaction_id,
                Transaction.household_id == user.household_id,
            )
        )
        if not txn_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Transaction not found")
        txn_id = payload.existing_transaction_id
    elif payload.create_transaction:
        txn = Transaction(
            household_id=user.household_id,
            name=rec.name,
            merchant_name=rec.merchant_name,
            amount=payload.amount,  # positive = expense (Plaid convention)
            date=datetime.combine(payload.paid_date, datetime.min.time()),
            pending=False,
            is_ignored=False,
            is_manual_category=False,
            notes=payload.notes,
        )
        db.add(txn)
        await db.flush()
        txn_id = txn.id

    payment = RecurringPayment(
        recurring_id=rec.id,
        household_id=user.household_id,
        amount=payload.amount,
        paid_date=payload.paid_date,
        notes=payload.notes,
        transaction_id=txn_id,
    )
    db.add(payment)

    # Advance next_due_date by one period
    rec.next_due_date = _advance_due_date(rec.next_due_date, rec.frequency)

    await db.flush()
    await db.refresh(payment)
    await db.commit()
    return payment


# ─── List payments ─────────────────────────────────────────────────────────────

@router.get("/{recurring_id}/payments", response_model=list[RecurringPaymentResponse])
async def list_payments(
    recurring_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify ownership
    result = await db.execute(
        select(RecurringTransaction).where(
            RecurringTransaction.id == recurring_id,
            RecurringTransaction.household_id == user.household_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Not found")

    payments = await db.execute(
        select(RecurringPayment)
        .where(RecurringPayment.recurring_id == recurring_id)
        .order_by(RecurringPayment.paid_date.desc())
    )
    return payments.scalars().all()


# ─── Delete payment ────────────────────────────────────────────────────────────

@router.delete("/{recurring_id}/payments/{payment_id}", status_code=204)
async def delete_payment(
    recurring_id: uuid.UUID,
    payment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecurringPayment)
        .join(RecurringTransaction, RecurringTransaction.id == RecurringPayment.recurring_id)
        .where(
            RecurringPayment.id == payment_id,
            RecurringPayment.recurring_id == recurring_id,
            RecurringTransaction.household_id == user.household_id,
        )
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    await db.delete(payment)
    await db.commit()


# ─── Find recurring linked to a transaction ────────────────────────────────────

@router.get("/by-transaction/{transaction_id}", response_model=RecurringTransactionResponse | None)
async def get_recurring_by_transaction(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the RecurringTransaction linked to a given transaction, or null."""
    result = await db.execute(
        select(RecurringTransaction)
        .join(RecurringPayment, RecurringPayment.recurring_id == RecurringTransaction.id)
        .where(
            RecurringPayment.transaction_id == transaction_id,
            RecurringTransaction.household_id == user.household_id,
        )
    )
    return result.scalar_one_or_none()


@router.delete("/unlink-transaction/{transaction_id}", status_code=204)
async def unlink_transaction(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove the RecurringPayment record linking this transaction to a recurring item."""
    result = await db.execute(
        select(RecurringPayment)
        .join(RecurringTransaction, RecurringTransaction.id == RecurringPayment.recurring_id)
        .where(
            RecurringPayment.transaction_id == transaction_id,
            RecurringTransaction.household_id == user.household_id,
        )
    )
    payment = result.scalar_one_or_none()
    if payment:
        await db.delete(payment)
        await db.commit()
