"""
Receipt endpoints — attach, view, delete, confirm, and re-parse receipts on transactions.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import ReceiptLineItem, Transaction, TransactionReceipt
from app.models.user import User

router = APIRouter(prefix="/transactions", tags=["receipts"])

ALLOWED_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "image/heic", "image/heif", "application/pdf",
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB


# ─── Schemas ──────────────────────────────────────────────────────────────────

class LineItemIn(BaseModel):
    id: uuid.UUID | None = None
    description: str
    amount: Decimal
    ai_category: str | None = None
    notes: str | None = None
    sort_order: int = 0


class LineItemOut(BaseModel):
    id: uuid.UUID
    description: str
    amount: str
    ai_category: str | None
    notes: str | None
    sort_order: int
    is_confirmed: bool

    model_config = {"from_attributes": True}


class ReceiptOut(BaseModel):
    id: uuid.UUID
    transaction_id: uuid.UUID
    filename: str
    file_size: int
    content_type: str
    status: str
    parse_error: str | None
    parsed_at: datetime | None
    uploaded_at: datetime
    line_items: list[LineItemOut]

    model_config = {"from_attributes": True}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _receipt_out(receipt: TransactionReceipt) -> dict[str, Any]:
    return {
        "id": receipt.id,
        "transaction_id": receipt.transaction_id,
        "filename": receipt.filename,
        "file_size": receipt.file_size,
        "content_type": receipt.content_type,
        "status": receipt.status,
        "parse_error": receipt.parse_error,
        "parsed_at": receipt.parsed_at,
        "uploaded_at": receipt.uploaded_at,
        "line_items": [
            {
                "id": item.id,
                "description": item.description,
                "amount": str(item.amount),
                "ai_category": item.ai_category,
                "notes": item.notes,
                "sort_order": item.sort_order,
                "is_confirmed": item.is_confirmed,
            }
            for item in sorted(receipt.line_items, key=lambda x: x.sort_order)
        ],
    }


async def _get_transaction(
    transaction_id: uuid.UUID, household_id: uuid.UUID, db: AsyncSession
) -> Transaction:
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == household_id,
        )
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


# ─── Upload receipt ────────────────────────────────────────────────────────────

@router.post("/{transaction_id}/receipt", status_code=201)
async def upload_receipt(
    transaction_id: uuid.UUID,
    file: UploadFile = File(...),
    provider: str = Form("local"),  # "local" | "claude"
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    txn = await _get_transaction(transaction_id, user.household_id, db)

    # Check no existing receipt
    existing = await db.execute(
        select(TransactionReceipt).where(TransactionReceipt.transaction_id == transaction_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Receipt already attached. Delete it first.")

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")

    original_name = file.filename or "receipt"

    # Stream to memory with size limit
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 50 MB)")
        chunks.append(chunk)
    content = b"".join(chunks)

    # Store file
    stored_name = f"{uuid.uuid4()}_{original_name}"
    dir_path = Path(settings.upload_dir) / "receipts" / str(user.household_id)
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / stored_name).write_bytes(content)

    receipt = TransactionReceipt(
        transaction_id=transaction_id,
        household_id=user.household_id,
        filename=original_name,
        stored_filename=stored_name,
        file_size=total,
        content_type=content_type,
        status="pending",
    )
    db.add(receipt)
    await db.flush()
    await db.refresh(receipt)
    await db.commit()

    # Enqueue parsing task
    from app.services.receipt_tasks import parse_receipt_task
    parse_receipt_task.delay(str(receipt.id), provider)

    return _receipt_out(receipt)


# ─── Get receipt ───────────────────────────────────────────────────────────────

@router.get("/{transaction_id}/receipt")
async def get_receipt(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_transaction(transaction_id, user.household_id, db)

    result = await db.execute(
        select(TransactionReceipt).where(TransactionReceipt.transaction_id == transaction_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="No receipt attached to this transaction")

    return _receipt_out(receipt)


# ─── Delete receipt ────────────────────────────────────────────────────────────

@router.delete("/{transaction_id}/receipt", status_code=204)
async def delete_receipt(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_transaction(transaction_id, user.household_id, db)

    result = await db.execute(
        select(TransactionReceipt).where(TransactionReceipt.transaction_id == transaction_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="No receipt found")

    # Delete file from disk
    file_path = (
        Path(settings.upload_dir) / "receipts" / str(user.household_id) / receipt.stored_filename
    )
    if file_path.exists():
        file_path.unlink()

    await db.delete(receipt)
    await db.commit()


# ─── Confirm splits from line items ───────────────────────────────────────────

@router.post("/{transaction_id}/receipt/confirm")
async def confirm_receipt_splits(
    transaction_id: uuid.UUID,
    body: list[LineItemIn],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Replace transaction splits with the confirmed receipt line items.
    Reuses existing split replacement logic.
    """
    txn = await _get_transaction(transaction_id, user.household_id, db)

    result = await db.execute(
        select(TransactionReceipt).where(TransactionReceipt.transaction_id == transaction_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="No receipt found")

    if not body:
        raise HTTPException(status_code=400, detail="At least one line item required")

    total = sum(item.amount for item in body)
    if abs(total - txn.amount) > Decimal("0.10"):
        raise HTTPException(
            status_code=400,
            detail=f"Line items total ${total} does not match transaction amount ${txn.amount} (tolerance ±$0.10)",
        )

    # Update line items to confirmed
    existing_items = await db.execute(
        select(ReceiptLineItem).where(ReceiptLineItem.receipt_id == receipt.id)
    )
    for item in existing_items.scalars().all():
        await db.delete(item)

    for idx, item_in in enumerate(body):
        line_item = ReceiptLineItem(
            receipt_id=receipt.id,
            transaction_id=transaction_id,
            household_id=user.household_id,
            description=item_in.description,
            amount=item_in.amount,
            ai_category=item_in.ai_category,
            notes=item_in.notes,
            sort_order=item_in.sort_order if item_in.sort_order else idx,
            is_confirmed=True,
        )
        db.add(line_item)

    # Replace transaction splits (reuse existing split logic)
    from app.models.account import TransactionSplit
    existing_splits = await db.execute(
        select(TransactionSplit).where(TransactionSplit.transaction_id == transaction_id)
    )
    for split in existing_splits.scalars().all():
        await db.delete(split)

    for item_in in body:
        split = TransactionSplit(
            transaction_id=transaction_id,
            household_id=user.household_id,
            amount=item_in.amount,
            category=item_in.ai_category or "Other",
            notes=item_in.notes,
        )
        db.add(split)

    txn.has_splits = True
    await db.commit()

    result2 = await db.execute(
        select(TransactionReceipt).where(TransactionReceipt.transaction_id == transaction_id)
    )
    receipt2 = result2.scalar_one()
    return _receipt_out(receipt2)


# ─── Re-parse receipt ──────────────────────────────────────────────────────────

@router.post("/{transaction_id}/receipt/reparse")
async def reparse_receipt(
    transaction_id: uuid.UUID,
    provider: str = Form("local"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_transaction(transaction_id, user.household_id, db)

    result = await db.execute(
        select(TransactionReceipt).where(TransactionReceipt.transaction_id == transaction_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="No receipt found")

    receipt.status = "pending"
    receipt.parse_error = None
    await db.commit()

    from app.services.receipt_tasks import parse_receipt_task
    parse_receipt_task.delay(str(receipt.id), provider)

    return {"status": "queued"}
