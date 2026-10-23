"""Plaid account + transaction sync service.

Core sync logic extracted from routers/plaid.py so it can be called from
both the FastAPI router (async) and the Celery beat task (via asyncio.run).
"""
import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decrypt_value
from app.models.account import Account, PlaidItem, Transaction, TransactionReceipt
from app.models.property_details import Loan
from app.models.rule import CategorizationRule
from app.services.category_map import map_legacy_category
from app.worker import celery_app

logger = logging.getLogger(__name__)


# ── Plaid client builder ────────────────────────────────────────────────────────

# Plaid's legacy "Transfer > X" subcategories → the app's "Transfers > X"
# taxonomy (frontend TAXONOMY). Keep in sync with migration ak1kl2mn3op4.
_TRANSFER_SUBCATEGORIES = {
    "credit card payment": "Credit Card Payment",
    "internal account transfer": "Internal Transfer",
    "wire": "Wire Transfer",
    "loan payment": "Loan Payment",
    "debit": "Account Transfer",
    "credit": "Account Transfer",
    "deposit": "Account Transfer",
    "withdrawal": "Account Transfer",
    "third party": "Account Transfer",
}


def normalize_plaid_category(plaid_cat: str | None, account_type: str | None) -> str | None:
    """Map a raw Plaid "Group > Sub" category onto the app's taxonomy.

    All transfer-like categories land under "Transfers > …" so the UI shows a
    single Transfers group. Payroll deposits Plaid labels as transfers are
    salary, except on loan accounts where they are the loan payment arriving.
    """
    if not plaid_cat:
        return plaid_cat
    lower = plaid_cat.lower()
    if lower.startswith("payment > credit"):
        return "Transfers > Credit Card Payment"
    if lower.startswith("payment > loan"):
        return "Transfers > Loan Payment"
    if lower.startswith("transfer > payroll"):
        return "Transfers > Loan Payment" if account_type == "loan" else "Income > Salary"
    if lower.startswith("transfer"):
        _, _, sub = plaid_cat.partition(" > ")
        if not sub:
            return "Transfers"
        return f"Transfers > {_TRANSFER_SUBCATEGORIES.get(sub.strip().lower(), sub.strip())}"
    return map_legacy_category(plaid_cat)


def build_plaid_client():
    if not settings.plaid_client_id or not settings.plaid_secret:
        raise RuntimeError("Plaid is not configured (missing client_id or secret)")

    import plaid
    from plaid.api import plaid_api

    configuration = plaid.Configuration(
        host=getattr(plaid.Environment, settings.plaid_env.capitalize()),
        api_key={
            "clientId": settings.plaid_client_id,
            "secret": settings.plaid_secret,
        },
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


# ── Core async sync logic ───────────────────────────────────────────────────────

def _map_plaid_investment_type(ptype, psubtype) -> str:
    """Map Plaid's investment transaction type/subtype to our internal enum
    (buy, sell, dividend, split, transfer_in, transfer_out, other)."""
    t = (ptype.value if hasattr(ptype, "value") else str(ptype or "")).lower()
    s = (psubtype.value if hasattr(psubtype, "value") else str(psubtype or "")).lower()

    if t == "buy":
        return "buy"
    if t == "sell":
        return "sell"
    if "dividend" in s or "interest" in s:
        return "dividend"
    if "split" in s:
        return "split"
    if s in ("deposit", "contribution"):
        return "transfer_in"
    if s in ("withdrawal", "distribution"):
        return "transfer_out"
    return "other"


def _plaid_asset_class(sec) -> str | None:
    """Map a Plaid security's type to our holding asset_class
    (equity, etf, mutual_fund, fixed_income, cash, crypto, derivative, other).
    The investments page classifies allocation from this; crypto also routes
    the holding to CoinGecko pricing."""
    if sec is None:
        return None
    if getattr(sec, "is_cash_equivalent", False):
        return "cash"
    raw = getattr(sec, "type", None)
    t = (raw.value if hasattr(raw, "value") else str(raw or "")).lower().strip()
    if not t:
        return None
    return {
        "cryptocurrency": "crypto",
        "fixed income": "fixed_income",
        "mutual fund": "mutual_fund",
    }.get(t, t.replace(" ", "_"))[:20]


async def sync_plaid_item(item: PlaidItem, db: AsyncSession) -> dict:
    """Pull accounts, holdings, and new transactions from Plaid and upsert into DB."""
    from plaid.model.accounts_get_request import AccountsGetRequest
    from plaid.model.transactions_sync_request import TransactionsSyncRequest
    from app.routers.rules import apply_rules_to_txn

    client = build_plaid_client()
    access_token = decrypt_value(item.encrypted_access_token)

    # ── 1. Sync accounts ─────────────────────────────────────────────
    accts_resp = client.accounts_get(AccountsGetRequest(access_token=access_token))
    account_count = 0

    for pa in accts_resp.accounts:
        result = await db.execute(
            select(Account).where(Account.plaid_account_id == pa.account_id)
        )
        acct = result.scalar_one_or_none()
        curr_bal = Decimal(str(pa.balances.current)) if pa.balances.current is not None else None
        avail_bal = Decimal(str(pa.balances.available)) if pa.balances.available is not None else None

        if acct:
            acct.current_balance = curr_bal
            acct.available_balance = avail_bal
            acct.balance_updated_at = datetime.now(timezone.utc)
            if not acct.institution_name:
                acct.institution_name = item.institution_name
            if curr_bal is not None:
                linked_loans = await db.execute(select(Loan).where(Loan.account_id == acct.id))
                for loan in linked_loans.scalars().all():
                    loan.current_balance = curr_bal
                    loan.balance_as_of = date.today()
        else:
            type_str = pa.type.value if hasattr(pa.type, "value") else str(pa.type)
            sub_str = pa.subtype.value if pa.subtype and hasattr(pa.subtype, "value") else (str(pa.subtype) if pa.subtype else None)
            acct = Account(
                plaid_item_id=item.id,
                household_id=item.household_id,
                plaid_account_id=pa.account_id,
                name=pa.name,
                official_name=pa.official_name,
                institution_name=item.institution_name,
                type=type_str,
                subtype=sub_str,
                mask=pa.mask,
                current_balance=curr_bal,
                available_balance=avail_bal,
                balance_updated_at=datetime.now(timezone.utc),
                currency_code=pa.balances.iso_currency_code or "USD",
            )
            db.add(acct)
        account_count += 1

    await db.flush()

    # ── 1.5 Sync investment holdings ──────────────────────────────────────────
    try:
        from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest
        from app.models.investment import Holding

        holdings_resp = client.investments_holdings_get(
            InvestmentsHoldingsGetRequest(access_token=access_token)
        )
        sec_map = {s.security_id: s for s in (holdings_resp.securities or [])}

        item_accts_result = await db.execute(
            select(Account).where(Account.plaid_item_id == item.id)
        )
        item_acct_ids = [a.id for a in item_accts_result.scalars().all()]

        for acct_id in item_acct_ids:
            old_h_result = await db.execute(select(Holding).where(Holding.account_id == acct_id))
            for old_h in old_h_result.scalars().all():
                await db.delete(old_h)
        await db.flush()

        for ph in (holdings_resp.holdings or []):
            a_result = await db.execute(
                select(Account).where(Account.plaid_account_id == ph.account_id)
            )
            h_acct = a_result.scalar_one_or_none()
            if not h_acct:
                continue
            sec = sec_map.get(ph.security_id)
            db.add(Holding(
                account_id=h_acct.id,
                household_id=item.household_id,
                security_id=ph.security_id,
                ticker_symbol=sec.ticker_symbol if sec else None,
                name=sec.name if sec else None,
                quantity=Decimal(str(ph.quantity)),
                cost_basis=Decimal(str(ph.cost_basis)) if ph.cost_basis is not None else None,
                current_value=Decimal(str(ph.institution_value)) if ph.institution_value is not None else None,
                asset_class=_plaid_asset_class(sec),
                as_of_date=datetime.now(timezone.utc),
            ))
    except Exception:
        pass  # Item may not have investments product enabled

    # ── 1.6 Sync investment transactions (buys, sells, dividends, etc.) ────────
    try:
        from plaid.model.investments_transactions_get_request import InvestmentsTransactionsGetRequest
        from plaid.model.investments_transactions_get_request_options import InvestmentsTransactionsGetRequestOptions
        from app.models.investment import InvestmentTransaction

        item_accts_result = await db.execute(
            select(Account).where(Account.plaid_item_id == item.id)
        )
        acct_by_plaid_id = {a.plaid_account_id: a for a in item_accts_result.scalars().all()}

        start_date = (datetime.now(timezone.utc) - timedelta(days=730)).date()
        end_date = datetime.now(timezone.utc).date()

        offset = 0
        total = None
        inv_txn_added = 0
        while total is None or offset < total:
            it_resp = client.investments_transactions_get(
                InvestmentsTransactionsGetRequest(
                    access_token=access_token,
                    start_date=start_date,
                    end_date=end_date,
                    options=InvestmentsTransactionsGetRequestOptions(count=500, offset=offset),
                )
            )
            total = it_resp.total_investment_transactions
            it_sec_map = {s.security_id: s for s in (it_resp.securities or [])}
            page = it_resp.investment_transactions or []

            for pit in page:
                it_acct = acct_by_plaid_id.get(pit.account_id)
                if not it_acct:
                    continue

                existing = await db.execute(
                    select(InvestmentTransaction).where(
                        InvestmentTransaction.plaid_investment_transaction_id
                        == pit.investment_transaction_id
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                sec = it_sec_map.get(pit.security_id)
                d = pit.date
                txn_dt = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)

                db.add(InvestmentTransaction(
                    account_id=it_acct.id,
                    household_id=item.household_id,
                    plaid_investment_transaction_id=pit.investment_transaction_id,
                    security_id=pit.security_id,
                    ticker_symbol=sec.ticker_symbol if sec else None,
                    name=pit.name,
                    type=_map_plaid_investment_type(pit.type, pit.subtype),
                    amount=Decimal(str(pit.amount)),
                    quantity=Decimal(str(pit.quantity)) if pit.quantity is not None else None,
                    price=Decimal(str(pit.price)) if pit.price is not None else None,
                    date=txn_dt,
                    fees=Decimal(str(pit.fees)) if pit.fees is not None else None,
                    currency_code=pit.iso_currency_code or "USD",
                    notes=f"Plaid: {pit.type}/{pit.subtype}" if pit.subtype else None,
                ))
                inv_txn_added += 1

            if not page:
                break
            offset += len(page)
        await db.flush()
    except Exception:
        inv_txn_added = 0
        pass  # Item may not have investments product enabled, or transactions unavailable

    # Load active household rules once for the whole sync
    rules_result = await db.execute(
        select(CategorizationRule)
        .where(
            CategorizationRule.household_id == item.household_id,
            CategorizationRule.is_active == True,  # noqa: E712
        )
        .order_by(CategorizationRule.priority.desc())
    )
    rules = rules_result.scalars().all()

    accts_map_result = await db.execute(
        select(Account).where(Account.household_id == item.household_id)
    )
    account_type_map: dict[str, str] = {
        a.plaid_account_id: a.type
        for a in accts_map_result.scalars().all()
        if a.plaid_account_id
    }

    # ── 2. Sync transactions (cursor-based) ───────────────────────────
    has_more = True
    cursor = item.cursor
    added_count = 0

    while has_more:
        if cursor:
            sync_req = TransactionsSyncRequest(access_token=access_token, cursor=cursor)
        else:
            sync_req = TransactionsSyncRequest(access_token=access_token)

        sync_resp = client.transactions_sync(sync_req)

        for pt in sync_resp.added:
            acct_result = await db.execute(
                select(Account).where(Account.plaid_account_id == pt.account_id)
            )
            acct = acct_result.scalar_one_or_none()
            if not acct:
                continue

            existing = await db.execute(
                select(Transaction).where(
                    Transaction.plaid_transaction_id == pt.transaction_id
                )
            )
            if existing.scalar_one_or_none():
                continue

            d = pt.date
            txn_dt = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)

            if pt.category and len(pt.category) >= 2:
                plaid_cat = f"{pt.category[0]} > {pt.category[1]}"
            elif pt.category:
                plaid_cat = pt.category[0]
            else:
                plaid_cat = None

            txn = Transaction(
                account_id=acct.id,
                household_id=item.household_id,
                plaid_transaction_id=pt.transaction_id,
                amount=Decimal(str(pt.amount)),
                date=txn_dt,
                name=pt.name,
                merchant_name=pt.merchant_name,
                pending=pt.pending,
                plaid_category=plaid_cat,
                plaid_category_id=pt.category_id,
            )

            txn.plaid_category = normalize_plaid_category(plaid_cat, acct.type)

            matched = False
            if rules:
                account_type = account_type_map.get(pt.account_id, acct.type)
                matched = apply_rules_to_txn(txn, account_type, rules)

            if not matched and not txn.plaid_category:
                txn.plaid_category = "Uncategorized"

            # A posted transaction replacing a pending one keeps the user's edits
            if pt.pending_transaction_id:
                prev = (await db.execute(
                    select(Transaction).where(Transaction.plaid_transaction_id == pt.pending_transaction_id)
                )).scalar_one_or_none()
                if prev is not None:
                    if prev.is_manual_category:
                        txn.plaid_category = prev.plaid_category
                        txn.is_manual_category = True
                    txn.notes = prev.notes

            db.add(txn)
            added_count += 1

        # Plaid revises transactions (e.g. a pending amount settling differently)
        for pt in sync_resp.modified:
            row = (await db.execute(
                select(Transaction).where(Transaction.plaid_transaction_id == pt.transaction_id)
            )).scalar_one_or_none()
            if row is None:
                continue
            row.amount = Decimal(str(pt.amount))
            row.date = datetime(pt.date.year, pt.date.month, pt.date.day, tzinfo=timezone.utc)
            row.name = pt.name
            row.merchant_name = pt.merchant_name
            row.pending = pt.pending

        # ...and removes them — chiefly pending charges once their posted
        # version arrives (as a new transaction above). Without this every
        # pending charge lingered next to its posted copy.
        for removed in sync_resp.removed:
            row = (await db.execute(
                select(Transaction).where(Transaction.plaid_transaction_id == removed.transaction_id)
            )).scalar_one_or_none()
            if row is None:
                continue
            has_receipt = (await db.execute(
                select(TransactionReceipt.id).where(TransactionReceipt.transaction_id == row.id)
            )).first() is not None
            if row.has_splits or has_receipt or row.notes or row.is_manual_category:
                row.is_ignored = True  # keep the user's attachments; just hide it
            else:
                await db.delete(row)

        cursor = sync_resp.next_cursor
        has_more = sync_resp.has_more

    item.cursor = cursor
    item.last_synced_at = datetime.now(timezone.utc)
    item.error_code = None
    await db.flush()

    return {
        "accounts": account_count,
        "transactions_added": added_count,
        "investment_transactions_added": inv_txn_added,
    }


# ── Async runner for Celery tasks ───────────────────────────────────────────────

async def _run_sync_for_item(item_id: uuid.UUID) -> dict:
    """Create a fresh async session, load item, run sync, commit, dispose engine."""
    async_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    AsyncSessionLocal = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(PlaidItem).where(
                    PlaidItem.id == item_id,
                    PlaidItem.is_active == True,  # noqa: E712
                )
            )
            item = result.scalar_one_or_none()
            if not item:
                logger.warning("PlaidItem %s not found or inactive", item_id)
                return {}
            stats = await sync_plaid_item(item, db)
            await db.commit()
            logger.info("Plaid sync complete for item %s: %s", item_id, stats)
            return stats
    except Exception:
        logger.exception("Plaid sync failed for item %s", item_id)
        raise
    finally:
        await async_engine.dispose()


# ── Celery tasks ────────────────────────────────────────────────────────────────

@celery_app.task(name="app.services.plaid_sync.sync_all_plaid_items")
def sync_all_plaid_items() -> None:
    """Iterate all active PlaidItems and sync those whose refresh interval has elapsed."""
    logger.info("sync_all_plaid_items: starting")
    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    now = datetime.now(timezone.utc)

    with Session(engine) as db:
        items = db.execute(
            select(PlaidItem).where(PlaidItem.is_active == True)  # noqa: E712
        ).scalars().all()

        logger.info("sync_all_plaid_items: %d active item(s) found", len(items))

        for item in items:
            if item.last_synced_at is not None:
                elapsed = now - item.last_synced_at
                if elapsed < timedelta(hours=item.refresh_interval_hours):
                    logger.debug(
                        "PlaidItem %s not due (%.1fh elapsed, interval %dh)",
                        item.id,
                        elapsed.total_seconds() / 3600,
                        item.refresh_interval_hours,
                    )
                    continue

            logger.info("Syncing PlaidItem %s (%s)", item.id, item.institution_name)
            try:
                asyncio.run(_run_sync_for_item(item.id))
            except Exception as exc:
                logger.error("PlaidItem %s sync failed: %s", item.id, exc)
                try:
                    stale = db.get(PlaidItem, item.id)
                    if stale:
                        stale.error_code = str(exc)[:100]
                        db.commit()
                except Exception:
                    pass

    engine.dispose()
    logger.info("sync_all_plaid_items: done")


@celery_app.task(name="app.services.plaid_sync.sync_single_plaid_item")
def sync_single_plaid_item(item_id_str: str) -> dict:
    """Sync a single PlaidItem on demand. Called from API or manually."""
    logger.info("sync_single_plaid_item: item_id=%s", item_id_str)
    try:
        return asyncio.run(_run_sync_for_item(uuid.UUID(item_id_str))) or {}
    except Exception as exc:
        logger.error("sync_single_plaid_item failed for %s: %s", item_id_str, exc)
        engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
        try:
            with Session(engine) as db:
                item = db.get(PlaidItem, uuid.UUID(item_id_str))
                if item:
                    item.error_code = str(exc)[:100]
                    db.commit()
        except Exception:
            logger.exception("Failed to persist error_code for PlaidItem %s", item_id_str)
        finally:
            engine.dispose()
        raise
