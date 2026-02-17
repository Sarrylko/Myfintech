import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account, Transaction
from app.models.rule import CategorizationRule
from app.models.user import User
from app.schemas.account import (
    AccountResponse,
    ManualAccountCreate,
    TransactionResponse,
    TransactionUpdate,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])

# Required CSV columns (case-insensitive)
CSV_REQUIRED = {"date", "description", "amount"}
CSV_OPTIONAL = {"merchant", "category", "notes"}
CSV_DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d-%m-%Y"]


def _parse_csv_date(val: str) -> datetime | None:
    for fmt in CSV_DATE_FORMATS:
        try:
            return datetime.strptime(val.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


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


@router.post("/", response_model=AccountResponse, status_code=201)
async def create_manual_account(
    payload: ManualAccountCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a manually-entered account (no Plaid required)."""
    acct = Account(
        plaid_item_id=None,
        plaid_account_id=None,
        household_id=user.household_id,
        name=payload.name,
        institution_name=payload.institution_name,
        type=payload.type,
        subtype=payload.subtype,
        mask=payload.mask,
        current_balance=payload.current_balance,
        available_balance=payload.current_balance,
        currency_code=payload.currency_code,
        is_manual=True,
    )
    db.add(acct)
    await db.flush()
    await db.refresh(acct)
    await db.commit()
    return acct


@router.get("/transactions", response_model=list[TransactionResponse])
async def list_all_transactions(
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .where(Transaction.household_id == user.household_id)
        .order_by(Transaction.date.desc())
        .limit(limit)
        .offset(offset)
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


@router.post(
    "/{account_id}/import-csv",
    status_code=200,
)
async def import_csv_transactions(
    account_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import transactions from a CSV file. Returns import summary + row-level errors."""
    # Verify account belongs to household
    acct_result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.household_id == user.household_id,
        )
    )
    account = acct_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    # Normalize headers to lowercase
    headers = {h.lower().strip() for h in reader.fieldnames}
    missing = CSV_REQUIRED - headers
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {', '.join(sorted(missing))}. "
                   f"Required: date, description, amount",
        )

    # Find column name mappings (case-insensitive)
    col_map: dict[str, str] = {}
    for h in reader.fieldnames:
        col_map[h.lower().strip()] = h

    # Load active rules once for the whole import
    rules_result = await db.execute(
        select(CategorizationRule)
        .where(
            CategorizationRule.household_id == user.household_id,
            CategorizationRule.is_active == True,  # noqa: E712
        )
        .order_by(CategorizationRule.priority.desc())
    )
    rules = rules_result.scalars().all()

    errors = []
    imported = 0
    i = 1  # track last row number for total_rows calculation

    for i, raw_row in enumerate(reader, start=2):  # row 1 = header
        row = {k.lower().strip(): v.strip() for k, v in raw_row.items() if k}

        # Date
        date_val = row.get("date", "")
        txn_date = _parse_csv_date(date_val)
        if not txn_date:
            errors.append({"row": i, "error": f"Invalid date '{date_val}'. Use YYYY-MM-DD or MM/DD/YYYY"})
            continue

        # Amount
        amount_str = row.get("amount", "").replace(",", "").replace("$", "").strip()
        try:
            from decimal import Decimal, InvalidOperation
            amount = Decimal(amount_str)
        except (InvalidOperation, ValueError):
            errors.append({"row": i, "error": f"Invalid amount '{row.get('amount', '')}'"})
            continue

        # Description
        description = row.get("description", "").strip()
        if not description:
            errors.append({"row": i, "error": "Description is required"})
            continue

        merchant = row.get("merchant", "") or None
        category = row.get("category", "") or None
        notes = row.get("notes", "") or None

        txn = Transaction(
            account_id=account.id,
            household_id=user.household_id,
            plaid_transaction_id=None,
            amount=amount,
            date=txn_date,
            name=description,
            merchant_name=merchant,
            pending=False,
            plaid_category=category,
            notes=notes,
        )

        # Apply categorization rules (rules can override category and flip sign)
        if rules:
            from app.routers.rules import apply_rules_to_txn
            apply_rules_to_txn(txn, account.type, rules)

        db.add(txn)
        imported += 1

    if imported > 0:
        await db.commit()

    return {
        "imported": imported,
        "errors": errors,
        "total_rows": i - 1 if imported + len(errors) > 0 else 0,
    }


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

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(txn, field, value)

    if "custom_category_id" in data:
        txn.is_manual_category = True

    await db.flush()
    await db.refresh(txn)
    await db.commit()
    return txn
