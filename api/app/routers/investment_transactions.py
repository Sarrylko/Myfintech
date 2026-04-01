"""Investment transaction CRUD, WAVG rollup, and CSV import endpoints."""

import csv
import io
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account
from app.models.investment import InvestmentTransaction
from app.models.user import User
from app.schemas.investment_transaction import (
    AccountTransactionSummary,
    CSVImportResult,
    InvestmentTransactionCreate,
    InvestmentTransactionResponse,
    InvestmentTransactionUpdate,
    TickerRollup,
)

router = APIRouter(tags=["investment-transactions"])

# Transaction types bucketed for WAVG calculation
_BUY_TYPES = {"buy", "transfer_in", "split"}
_SELL_TYPES = {"sell", "transfer_out"}

# Accepted date formats for CSV import
_DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"]

# Type aliases for CSV normalization
_TYPE_ALIASES = {
    "b": "buy",
    "s": "sell",
    "div": "dividend",
    "divd": "dividend",
    "ti": "transfer_in",
    "to": "transfer_out",
    "xferin": "transfer_in",
    "xferout": "transfer_out",
}

_VALID_TYPES = {
    "buy", "sell", "dividend", "split",
    "transfer_in", "transfer_out", "other",
}

CSV_TEMPLATE = (
    "ticker_symbol,type,date,quantity,price,amount,fees,notes\n"
    "AAPL,buy,2024-01-15,10,150.00,1500.00,0.00,Example buy\n"
    "AAPL,sell,2024-06-15,5,200.00,1000.00,0.00,Example sell\n"
    "MSFT,dividend,2024-03-15,,,50.00,,Q1 dividend\n"
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_investment_account(
    account_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Account:
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.household_id == user.household_id,
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.type != "investment":
        raise HTTPException(
            status_code=400,
            detail="Transactions can only be added to investment accounts",
        )
    return account


async def _get_txn(
    txn_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> InvestmentTransaction:
    result = await db.execute(
        select(InvestmentTransaction)
        .join(Account, InvestmentTransaction.account_id == Account.id)
        .where(
            InvestmentTransaction.id == txn_id,
            Account.household_id == user.household_id,
        )
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


def _build_rollup(
    account_id: uuid.UUID,
    txns: list[InvestmentTransaction],
) -> AccountTransactionSummary:
    """Compute per-ticker WAVG rollup from a flat list of transactions."""
    groups: dict[str, dict] = {}

    for txn in txns:
        key = (txn.ticker_symbol or "UNKNOWN").upper()
        if key not in groups:
            groups[key] = {
                "ticker_symbol": key,
                "name": txn.name,
                "buy_qty": Decimal(0),
                "buy_amount": Decimal(0),
                "sell_qty": Decimal(0),
                "sell_amount": Decimal(0),
                "total_fees": Decimal(0),
                "last_transaction_date": txn.date,
                "txns": [],
            }
        g = groups[key]
        g["txns"].append(txn)
        g["last_transaction_date"] = max(g["last_transaction_date"], txn.date)

        qty = txn.quantity or Decimal(0)
        amt = abs(txn.amount)

        if txn.type in _BUY_TYPES:
            g["buy_qty"] += qty
            g["buy_amount"] += amt
        elif txn.type in _SELL_TYPES:
            g["sell_qty"] += qty
            g["sell_amount"] += amt

        if txn.fees:
            g["total_fees"] += txn.fees

    positions: list[TickerRollup] = []
    for key in sorted(groups):
        g = groups[key]
        buy_qty: Decimal = g["buy_qty"]
        buy_amount: Decimal = g["buy_amount"]
        sell_qty: Decimal = g["sell_qty"]
        sell_amount: Decimal = g["sell_amount"]

        avg_cost = (buy_amount / buy_qty) if buy_qty > 0 else None
        net_shares = buy_qty - sell_qty
        total_cost_basis = (avg_cost * net_shares) if avg_cost is not None else None
        realized_gain = (
            sell_amount - (avg_cost * sell_qty)
            if avg_cost is not None
            else Decimal(0)
        )

        positions.append(
            TickerRollup(
                ticker_symbol=g["ticker_symbol"],
                name=g["name"],
                net_shares=net_shares,
                avg_cost_per_share=avg_cost,
                total_cost_basis=total_cost_basis,
                total_fees=g["total_fees"],
                realized_gain=realized_gain,
                transaction_count=len(g["txns"]),
                last_transaction_date=g["last_transaction_date"],
                transactions=[
                    InvestmentTransactionResponse.model_validate(t)
                    for t in sorted(g["txns"], key=lambda t: t.date, reverse=True)
                ],
            )
        )

    return AccountTransactionSummary(account_id=account_id, positions=positions)


def _parse_date(value: str) -> datetime | None:
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _normalize_type(value: str) -> str:
    v = value.strip().lower().replace(" ", "_")
    return _TYPE_ALIASES.get(v, v)


def _parse_decimal(value: str) -> Decimal | None:
    v = value.strip().replace(",", "")
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/accounts/{account_id}/investment-transactions",
    response_model=AccountTransactionSummary,
)
async def list_investment_transactions(
    account_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_investment_account(account_id, user, db)
    result = await db.execute(
        select(InvestmentTransaction)
        .where(InvestmentTransaction.account_id == account_id)
        .order_by(InvestmentTransaction.date)
    )
    txns = list(result.scalars().all())
    return _build_rollup(account_id, txns)


@router.post(
    "/accounts/{account_id}/investment-transactions",
    response_model=InvestmentTransactionResponse,
    status_code=201,
)
async def create_investment_transaction(
    account_id: uuid.UUID,
    payload: InvestmentTransactionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_investment_account(account_id, user, db)
    data = payload.model_dump()
    if data.get("date") is None:
        data["date"] = datetime.now(timezone.utc)
    txn = InvestmentTransaction(
        account_id=account_id,
        household_id=account.household_id,
        **data,
    )
    db.add(txn)
    await db.flush()
    await db.refresh(txn)
    return txn


@router.patch(
    "/investment-transactions/{txn_id}",
    response_model=InvestmentTransactionResponse,
)
async def update_investment_transaction(
    txn_id: uuid.UUID,
    payload: InvestmentTransactionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    txn = await _get_txn(txn_id, user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(txn, field, value)
    await db.flush()
    await db.refresh(txn)
    return txn


@router.delete("/investment-transactions/{txn_id}", status_code=204)
async def delete_investment_transaction(
    txn_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    txn = await _get_txn(txn_id, user, db)
    await db.delete(txn)


@router.get("/investment-transactions/csv-template")
async def download_csv_template():
    return StreamingResponse(
        io.StringIO(CSV_TEMPLATE),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="investment_transactions_template.csv"'
        },
    )


@router.post(
    "/accounts/{account_id}/investment-transactions/import-csv",
    response_model=CSVImportResult,
)
async def import_investment_transactions_csv(
    account_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_investment_account(account_id, user, db)

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # strip BOM if present
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    required_cols = {"ticker_symbol", "type", "date", "amount"}

    if not reader.fieldnames or not required_cols.issubset(
        {c.strip().lower() for c in reader.fieldnames}
    ):
        raise HTTPException(
            status_code=400,
            detail=f"CSV must contain columns: {', '.join(sorted(required_cols))}",
        )

    # Normalize fieldnames to lowercase
    fieldnames_map = {c: c.strip().lower() for c in (reader.fieldnames or [])}

    # Load existing fingerprints to prevent duplicates
    existing_result = await db.execute(
        select(
            InvestmentTransaction.date,
            InvestmentTransaction.ticker_symbol,
            InvestmentTransaction.type,
            InvestmentTransaction.amount,
        ).where(InvestmentTransaction.account_id == account_id)
    )
    existing_fps: set[str] = set()
    for ex_date, ex_ticker, ex_type, ex_amount in existing_result.all():
        date_str = ex_date.strftime("%Y-%m-%d") if ex_date else ""
        existing_fps.add(f"{date_str}|{ex_ticker}|{ex_type}|{float(ex_amount):.2f}")

    imported = 0
    duplicates = 0
    errors: list[str] = []
    seen_in_file: set[str] = set()

    for row_num, raw_row in enumerate(reader, start=2):
        row = {fieldnames_map.get(k, k): v for k, v in raw_row.items()}

        ticker = (row.get("ticker_symbol") or "").strip().upper()
        if not ticker:
            errors.append(f"Row {row_num}: missing ticker_symbol")
            continue

        raw_type = (row.get("type") or "").strip()
        txn_type = _normalize_type(raw_type)
        if txn_type not in _VALID_TYPES:
            errors.append(f"Row {row_num}: unknown type '{raw_type}'")
            continue

        raw_date = row.get("date") or ""
        txn_date = _parse_date(raw_date) if raw_date else None
        if txn_date is None and raw_date:
            errors.append(f"Row {row_num}: cannot parse date '{raw_date}'")
            continue
        if txn_date is None:
            txn_date = datetime.now(timezone.utc)

        amount = _parse_decimal(row.get("amount") or "")
        if amount is None:
            errors.append(f"Row {row_num}: missing or invalid amount")
            continue

        quantity = _parse_decimal(row.get("quantity") or "")
        price = _parse_decimal(row.get("price") or "")
        fees = _parse_decimal(row.get("fees") or "")
        notes = (row.get("notes") or "").strip() or None
        name = (row.get("name") or "").strip() or ticker

        fp = f"{txn_date.strftime('%Y-%m-%d')}|{ticker}|{txn_type}|{float(amount):.2f}"
        if fp in existing_fps or fp in seen_in_file:
            duplicates += 1
            continue
        seen_in_file.add(fp)

        txn = InvestmentTransaction(
            account_id=account_id,
            household_id=account.household_id,
            ticker_symbol=ticker,
            name=name,
            type=txn_type,
            date=txn_date,
            quantity=quantity,
            price=price,
            amount=amount,
            fees=fees,
            notes=notes,
        )
        db.add(txn)
        imported += 1

    if imported > 0:
        await db.flush()

    return CSVImportResult(imported=imported, duplicates=duplicates, errors=errors)
