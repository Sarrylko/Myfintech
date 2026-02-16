import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account, Transaction
from app.models.user import User
from app.schemas.account import (
    AccountResponse,
    TransactionResponse,
    TransactionUpdate,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/", response_model=list[AccountResponse])
async def list_accounts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account)
        .where(Account.household_id == user.household_id)
        .order_by(Account.name)
    )
    return result.scalars().all()


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.household_id == user.household_id,
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.get("/{account_id}/transactions", response_model=list[TransactionResponse])
async def list_transactions(
    account_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.account_id == account_id,
            Transaction.household_id == user.household_id,
        )
        .order_by(Transaction.date.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


@router.patch(
    "/transactions/{transaction_id}",
    response_model=TransactionResponse,
)
async def update_transaction(
    transaction_id: uuid.UUID,
    payload: TransactionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == user.household_id,
        )
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if payload.custom_category_id is not None:
        txn.custom_category_id = payload.custom_category_id
        txn.is_manual_category = True
    if payload.notes is not None:
        txn.notes = payload.notes

    await db.flush()
    await db.refresh(txn)
    return txn
