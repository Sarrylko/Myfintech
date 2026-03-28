import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account, Transaction, TransactionSplit
from app.models.property_details import Loan
from app.models.rule import CategorizationRule
from app.models.user import User
from app.models.investment import Holding, InvestmentTransaction
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
from app.schemas.transaction_split import TransactionSplitRequest, TransactionSplitResponse

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

    # Always delete holdings and investment transactions (no orphan option for these)
    holdings_result = await db.execute(
        select(Holding).where(Holding.account_id == account_id)
    )
    for holding in holdings_result.scalars().all():
        await db.delete(holding)

    inv_txns_result = await db.execute(
        select(InvestmentTransaction).where(InvestmentTransaction.account_id == account_id)
    )
    for inv_txn in inv_txns_result.scalars().all():
        await db.delete(inv_txn)

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


@router.put(
    "/transactions/{transaction_id}/splits",
    response_model=list[TransactionSplitResponse],
    status_code=200,
)
async def set_transaction_splits(
    transaction_id: uuid.UUID,
    payload: TransactionSplitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replace all splits for a transaction. Splits must sum to the transaction amount (±$0.01)."""
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == user.household_id,
        )
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    from decimal import Decimal
    total = sum(s.amount for s in payload.splits)
    if abs(total - abs(txn.amount)) > Decimal("0.01"):
        raise HTTPException(
            status_code=422,
            detail=f"Split amounts ({total}) must equal transaction amount ({abs(txn.amount)})",
        )

    # Delete existing splits
    existing = await db.execute(
        select(TransactionSplit).where(TransactionSplit.transaction_id == transaction_id)
    )
    for sp in existing.scalars().all():
        await db.delete(sp)

    # Insert new splits
    new_splits = []
    for item in payload.splits:
        sp = TransactionSplit(
            transaction_id=transaction_id,
            household_id=user.household_id,
            amount=item.amount,
            category=item.category,
            notes=item.notes,
        )
        db.add(sp)
        new_splits.append(sp)

    txn.has_splits = True
    await db.flush()
    for sp in new_splits:
        await db.refresh(sp)
    await db.commit()
    return new_splits


@router.delete("/transactions/{transaction_id}/splits", status_code=204)
async def clear_transaction_splits(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove all splits from a transaction, reverting it to single-category."""
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == user.household_id,
        )
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    existing = await db.execute(
        select(TransactionSplit).where(TransactionSplit.transaction_id == transaction_id)
    )
    for sp in existing.scalars().all():
        await db.delete(sp)

    txn.has_splits = False
    await db.commit()


# ─── Rental income linking ────────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel  # local import to avoid top-level clutter


class _RentalLink(_BaseModel):
    lease_id: uuid.UUID
    amount: float


@router.post("/transactions/{transaction_id}/link-rental", status_code=204)
async def link_transaction_to_rental(
    transaction_id: uuid.UUID,
    payload: list[_RentalLink],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Link a rental income transaction to one or more leases.

    Creates Payment records for each lease assignment. If the transaction was
    previously linked, all prior links are replaced (atomic).
    Amounts must sum to the absolute transaction amount (±$0.01).
    """
    from decimal import Decimal
    from app.models.rental import Lease as _Lease, Payment as _Payment, Unit as _Unit
    from app.models.property import Property as _Property

    if not payload:
        raise HTTPException(status_code=422, detail="At least one lease assignment required")

    # Verify transaction
    txn_result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == user.household_id,
        )
    )
    txn = txn_result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Validate amounts sum to transaction amount
    total_assigned = sum(Decimal(str(link.amount)) for link in payload)
    if abs(total_assigned - abs(txn.amount)) > Decimal("0.01"):
        raise HTTPException(
            status_code=422,
            detail=f"Assigned amounts ({total_assigned}) must equal transaction amount ({abs(txn.amount)})",
        )

    # Verify all leases belong to this household
    for link in payload:
        lease_result = await db.execute(
            select(_Lease)
            .join(_Unit, _Lease.unit_id == _Unit.id)
            .join(_Property, _Unit.property_id == _Property.id)
            .where(
                _Lease.id == link.lease_id,
                _Property.household_id == user.household_id,
            )
        )
        if lease_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail=f"Lease {link.lease_id} not found")

    # Remove existing payment records for this transaction (atomic replace)
    existing_payments = await db.execute(
        select(_Payment).where(_Payment.transaction_id == transaction_id)
    )
    for p in existing_payments.scalars().all():
        await db.delete(p)

    # Create new payment records
    txn_date = txn.date.date() if hasattr(txn.date, "date") else txn.date
    for link in payload:
        payment = _Payment(
            lease_id=link.lease_id,
            payment_date=txn_date,
            amount=Decimal(str(link.amount)),
            method="bank",
            transaction_id=transaction_id,
            notes="Linked from bank transaction",
        )
        db.add(payment)

    # Auto-categorize as rental income if not already
    if txn.plaid_category is None or txn.plaid_category.lower() not in ("income > rental", "rental income"):
        if not txn.is_manual_category:
            txn.plaid_category = "Income > Rental"

    await db.commit()


@router.delete("/transactions/{transaction_id}/link-rental", status_code=204)
async def unlink_transaction_from_rental(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove all rental payment links for a transaction."""
    from app.models.rental import Payment as _Payment

    # Verify transaction ownership
    txn_result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == user.household_id,
        )
    )
    if txn_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    existing_payments = await db.execute(
        select(_Payment).where(_Payment.transaction_id == transaction_id)
    )
    for p in existing_payments.scalars().all():
        await db.delete(p)

    await db.commit()


# ─── Property expense linking ─────────────────────────────────────────────────

class _PropertyExpenseLink(_BaseModel):
    property_id: uuid.UUID
    expense_category: str  # repair | appliance | property_tax | hoa | insurance | utility | other
    amount: float
    is_capex: bool = False
    notes: str | None = None


# Maintenance expense categories that map to PropertyCostStatus categories
_PROPERTY_COST_STATUS_CATEGORIES = {"property_tax", "hoa", "insurance"}


@router.post("/transactions/{transaction_id}/link-property-expense", status_code=204)
async def link_transaction_to_property_expense(
    transaction_id: uuid.UUID,
    payload: list[_PropertyExpenseLink],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Link a property expense transaction to one or more properties.

    Creates MaintenanceExpense records for each property assignment.
    For property_tax/hoa/insurance categories, also marks PropertyCostStatus as paid.
    If the transaction was previously linked, all prior links are replaced (atomic).
    Amounts must sum to the absolute transaction amount (±$0.01).
    """
    from decimal import Decimal
    from app.models.property_details import MaintenanceExpense as _MaintenanceExpense
    from app.models.property import Property as _Property
    from app.models.property_cost_status import PropertyCostStatus as _PropertyCostStatus

    if not payload:
        raise HTTPException(status_code=422, detail="At least one property assignment required")

    # Verify transaction
    txn_result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == user.household_id,
        )
    )
    txn = txn_result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Validate amounts sum to transaction amount
    total_assigned = sum(Decimal(str(link.amount)) for link in payload)
    if abs(total_assigned - abs(txn.amount)) > Decimal("0.01"):
        raise HTTPException(
            status_code=422,
            detail=f"Assigned amounts ({total_assigned}) must equal transaction amount ({abs(txn.amount)})",
        )

    # Verify all properties belong to this household
    for link in payload:
        prop_result = await db.execute(
            select(_Property).where(
                _Property.id == link.property_id,
                _Property.household_id == user.household_id,
            )
        )
        if prop_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail=f"Property {link.property_id} not found")

    # Remove existing maintenance expense records for this transaction (atomic replace)
    existing_expenses = await db.execute(
        select(_MaintenanceExpense).where(_MaintenanceExpense.transaction_id == transaction_id)
    )
    old_expenses = existing_expenses.scalars().all()
    # Track which property+category combos need PropertyCostStatus revert
    old_status_keys = {
        (e.property_id, e.category)
        for e in old_expenses
        if e.category in _PROPERTY_COST_STATUS_CATEGORIES
    }
    for e in old_expenses:
        await db.delete(e)

    # Revert PropertyCostStatus for removed links that aren't being re-linked
    txn_date = txn.date.date() if hasattr(txn.date, "date") else txn.date
    new_status_keys = {
        (link.property_id, link.expense_category)
        for link in payload
        if link.expense_category in _PROPERTY_COST_STATUS_CATEGORIES
    }
    for prop_id, cat in old_status_keys - new_status_keys:
        status_result = await db.execute(
            select(_PropertyCostStatus).where(
                _PropertyCostStatus.property_id == prop_id,
                _PropertyCostStatus.year == txn_date.year,
                _PropertyCostStatus.category == cat,
            )
        )
        status = status_result.scalar_one_or_none()
        if status:
            status.is_paid = False
            status.paid_date = None

    # Create new maintenance expense records
    for link in payload:
        expense = _MaintenanceExpense(
            property_id=link.property_id,
            expense_date=txn_date,
            amount=Decimal(str(link.amount)),
            category=link.expense_category,
            description=txn.name,
            vendor=link.notes,
            is_capex=link.is_capex,
            transaction_id=transaction_id,
        )
        db.add(expense)

        # Auto-mark PropertyCostStatus as paid for tax/hoa/insurance
        if link.expense_category in _PROPERTY_COST_STATUS_CATEGORIES:
            status_result = await db.execute(
                select(_PropertyCostStatus).where(
                    _PropertyCostStatus.property_id == link.property_id,
                    _PropertyCostStatus.year == txn_date.year,
                    _PropertyCostStatus.category == link.expense_category,
                )
            )
            status = status_result.scalar_one_or_none()
            if status:
                status.is_paid = True
                status.paid_date = txn_date
            else:
                db.add(_PropertyCostStatus(
                    property_id=link.property_id,
                    household_id=user.household_id,
                    year=txn_date.year,
                    category=link.expense_category,
                    is_paid=True,
                    paid_date=txn_date,
                ))

    await db.commit()


@router.delete("/transactions/{transaction_id}/link-property-expense", status_code=204)
async def unlink_transaction_from_property_expense(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove all property expense links for a transaction and revert paid statuses."""
    from app.models.property_details import MaintenanceExpense as _MaintenanceExpense
    from app.models.property_cost_status import PropertyCostStatus as _PropertyCostStatus

    txn_result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == user.household_id,
        )
    )
    txn = txn_result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    txn_date = txn.date.date() if hasattr(txn.date, "date") else txn.date

    existing_expenses = await db.execute(
        select(_MaintenanceExpense).where(_MaintenanceExpense.transaction_id == transaction_id)
    )
    for e in existing_expenses.scalars().all():
        # Revert PropertyCostStatus for recurring cost categories
        if e.category in _PROPERTY_COST_STATUS_CATEGORIES:
            status_result = await db.execute(
                select(_PropertyCostStatus).where(
                    _PropertyCostStatus.property_id == e.property_id,
                    _PropertyCostStatus.year == txn_date.year,
                    _PropertyCostStatus.category == e.category,
                )
            )
            status = status_result.scalar_one_or_none()
            if status:
                status.is_paid = False
                status.paid_date = None
        await db.delete(e)

    await db.commit()


# ─── Holdings CRUD (manual accounts only) ────────────────────────────────────

async def _sync_account_balance(account_id: uuid.UUID, db: AsyncSession) -> None:
    """Recompute current_balance for a manual account from its holdings total."""
    result = await db.execute(
        select(Holding).where(Holding.account_id == account_id)
    )
    holdings = result.scalars().all()
    from decimal import Decimal
    total = sum(h.current_value or Decimal(0) for h in holdings)
    acct = await db.get(Account, account_id)
    if acct and acct.is_manual:
        acct.current_balance = total

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
        asset_class=payload.asset_class,
        coingecko_id=payload.coingecko_id,
        as_of_date=datetime.now(timezone.utc),
    )
    db.add(holding)
    await db.flush()
    await db.refresh(holding)
    await _sync_account_balance(account_id, db)
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
    if holding.account_id:
        await _sync_account_balance(holding.account_id, db)
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

    account_id = holding.account_id
    await db.delete(holding)
    await db.flush()
    if account_id:
        await _sync_account_balance(account_id, db)
    await db.commit()
