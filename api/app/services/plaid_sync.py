"""Plaid account + transaction sync service.

Core sync logic extracted from routers/plaid.py so it can be called from
both the FastAPI router (async) and the Celery beat task (via asyncio.run).
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decrypt_value
from app.models.account import Account, PlaidItem, Transaction
from app.models.property_details import Loan
from app.models.rule import CategorizationRule
from app.worker import celery_app

logger = logging.getLogger(__name__)


# ── Plaid client builder ────────────────────────────────────────────────────────

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
            if not acct.institution_name:
                acct.institution_name = item.institution_name
            if curr_bal is not None:
                linked_loans = await db.execute(select(Loan).where(Loan.account_id == acct.id))
                for loan in linked_loans.scalars().all():
                    loan.current_balance = curr_bal
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
                as_of_date=datetime.now(timezone.utc),
            ))
    except Exception:
        pass  # Item may not have investments product enabled

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

            if plaid_cat and plaid_cat.lower().startswith("transfer"):
                txn.plaid_category = plaid_cat
            elif plaid_cat and plaid_cat.lower().startswith("payment > credit"):
                txn.plaid_category = "Transfer > Credit Card Payment"
            elif plaid_cat and plaid_cat.lower().startswith("payment > loan"):
                txn.plaid_category = "Transfer > Loan Payment"

            matched = False
            if rules:
                account_type = account_type_map.get(pt.account_id, acct.type)
                matched = apply_rules_to_txn(txn, account_type, rules)

            if not matched and not txn.plaid_category:
                txn.plaid_category = "Uncategorized"

            db.add(txn)
            added_count += 1

        cursor = sync_resp.next_cursor
        has_more = sync_resp.has_more

    item.cursor = cursor
    item.last_synced_at = datetime.now(timezone.utc)
    item.error_code = None
    await db.flush()

    return {"accounts": account_count, "transactions_added": added_count}


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
