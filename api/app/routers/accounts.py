import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account, Transaction
from app.models.property_details import Loan
from app.models.rule import CategorizationRule
from app.models.user import User
from app.models.investment import Holding
from app.schemas.account import (
    AccountResponse,
    AccountUpdate,
    HoldingCreate,
    HoldingResponse,
    HoldingUpdate,
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
        owner_user_id=payload.owner_user_id,
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


@router.delete("/{account_id}", status_code=204)
async def delete_account(
    account_id: uuid.UUID,
    delete_transactions: bool = Query(default=True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an account. Optionally delete its transactions (default=True).
    If delete_transactions=False, transactions remain but are unlinked (account_id set to NULL).
    """
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.household_id == user.household_id,
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if delete_transactions:
        # Delete all transactions for this account
        txns_result = await db.execute(
            select(Transaction).where(Transaction.account_id == account_id)
        )
        for txn in txns_result.scalars().all():
            await db.delete(txn)
    else:
        # Unlink transactions (set account_id to NULL so they remain accessible)
        txns_result = await db.execute(
            select(Transaction).where(Transaction.account_id == account_id)
        )
        for txn in txns_result.scalars().all():
            txn.account_id = None

    await db.delete(account)
    await db.commit()


@router.patch("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: uuid.UUID,
    payload: AccountUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update editable fields on any account (manual or Plaid-linked)."""
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.household_id == user.household_id,
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(account, field, value)

    # Propagate new balance to any loan linked to this account
    if "current_balance" in data and data["current_balance"] is not None:
        linked_loans = await db.execute(select(Loan).where(Loan.account_id == account_id))
        for loan in linked_loans.scalars().all():
            loan.current_balance = data["current_balance"]

    await db.flush()
    await db.refresh(account)
    await db.commit()
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

    # Build fingerprint set from transactions already in this account
    # Fingerprint: "YYYY-MM-DD|description_lower|amount_normalized"
    existing_result = await db.execute(
        select(Transaction.date, Transaction.name, Transaction.amount)
        .where(Transaction.account_id == account.id)
    )
    existing_fps: set[str] = set()
    for ex_date, ex_name, ex_amount in existing_result.all():
        date_str = ex_date.strftime("%Y-%m-%d") if ex_date else ""
        existing_fps.add(f"{date_str}|{(ex_name or '').lower().strip()}|{float(ex_amount):.2f}")

    errors = []
    imported = 0
    duplicates = 0
    seen_in_file: set[str] = set()  # dedup within the same CSV upload
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

        # Deduplication check (use original amount before rule sign-flip)
        fp = f"{txn_date.strftime('%Y-%m-%d')}|{description.lower()}|{float(amount):.2f}"
        if fp in existing_fps or fp in seen_in_file:
            duplicates += 1
            continue
        seen_in_file.add(fp)

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
        matched = False
        if rules:
            from app.routers.rules import apply_rules_to_txn
            matched = apply_rules_to_txn(txn, account.type, rules)

        if not matched and not txn.plaid_category:
            txn.plaid_category = "Uncategorized"

        db.add(txn)
        imported += 1

    if imported > 0:
        await db.commit()

    return {
        "imported": imported,
        "duplicates": duplicates,
        "errors": errors,
        "total_rows": i - 1 if imported + len(errors) + duplicates > 0 else 0,
    }


@router.get("/{account_id}/holdings", response_model=list[HoldingResponse])
async def list_holdings(
    account_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all holdings for an investment account."""
    acct_result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.household_id == user.household_id,
        )
    )
    if not acct_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")

    result = await db.execute(
        select(Holding)
        .where(Holding.account_id == account_id)
        .order_by(Holding.current_value.desc())
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

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(txn, field, value)

    if "custom_category_id" in data:
        txn.is_manual_category = True

    await db.flush()
    await db.refresh(txn)
    await db.commit()
    return txn


# ─── Holdings CRUD (manual accounts only) ────────────────────────────────────

@router.post("/{account_id}/holdings", response_model=HoldingResponse, status_code=201)
async def create_holding(
    account_id: uuid.UUID,
    payload: HoldingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a manual holding to a manual investment account."""
    acct_result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.household_id == user.household_id,
        )
    )
    acct = acct_result.scalar_one_or_none()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    if not acct.is_manual:
        raise HTTPException(
            status_code=400,
            detail="Holdings can only be added manually to manual accounts; Plaid accounts are synced automatically.",
        )

    holding = Holding(
        account_id=account_id,
        household_id=user.household_id,
        ticker_symbol=payload.ticker_symbol,
        name=payload.name,
        quantity=payload.quantity,
        cost_basis=payload.cost_basis,
        current_value=payload.current_value,
        currency_code=payload.currency_code,
        as_of_date=datetime.now(timezone.utc),
    )
    db.add(holding)
    await db.flush()
    await db.refresh(holding)
    await db.commit()
    return holding


@router.patch("/holdings/{holding_id}", response_model=HoldingResponse)
async def update_holding(
    holding_id: uuid.UUID,
    payload: HoldingUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update fields on a manually-managed holding."""
    result = await db.execute(
        select(Holding).where(
            Holding.id == holding_id,
            Holding.household_id == user.household_id,
        )
    )
    holding = result.scalar_one_or_none()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(holding, field, value)

    holding.as_of_date = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(holding)
    await db.commit()
    return holding


@router.delete("/holdings/{holding_id}", status_code=204)
async def delete_holding(
    holding_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a holding (manual accounts only)."""
    result = await db.execute(
        select(Holding).where(
            Holding.id == holding_id,
            Holding.household_id == user.household_id,
        )
    )
    holding = result.scalar_one_or_none()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    await db.delete(holding)
    await db.commit()
