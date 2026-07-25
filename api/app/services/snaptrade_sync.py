"""SnapTrade brokerage sync service.

Core sync logic extracted from routers/snaptrade.py so it can be called from
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
from app.models.account import Account
from app.models.investment import Holding
from app.models.snaptrade import SnapTradeConnection, SnapTradeUser
from app.worker import celery_app

logger = logging.getLogger(__name__)


# ── Attribute helpers (used throughout sync logic) ──────────────────────────────

def _attr(obj, key: str):
    """Get attribute from dict or object, returning None if missing."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _get_auth_id(acct_obj) -> str | None:
    """Extract brokerage_authorization ID from a SnapTrade account object."""
    ba = _attr(acct_obj, "brokerage_authorization")
    if ba is None:
        return None
    return _attr(ba, "id")


def _safe_decimal(val) -> Decimal | None:
    if val is None:
        return None
    try:
        return Decimal(str(val))
    except Exception:
        return None


def _get_snaptrade_client():
    if not settings.snaptrade_client_id or not settings.snaptrade_consumer_key:
        raise RuntimeError("SnapTrade is not configured (missing client_id or consumer_key)")
    from snaptrade_client import Configuration, SnapTrade
    conf = Configuration(
        consumer_key=settings.snaptrade_consumer_key,
        client_id=settings.snaptrade_client_id,
    )
    return SnapTrade(configuration=conf)


# ── Core async sync logic ───────────────────────────────────────────────────────

async def sync_snaptrade_connection(
    connection: SnapTradeConnection,
    snap_user: SnapTradeUser,
    db: AsyncSession,
) -> dict:
    """Pull accounts and holdings for one SnapTrade brokerage authorization."""
    client = _get_snaptrade_client()
    user_id = snap_user.snaptrade_user_id
    user_secret = decrypt_value(snap_user.encrypted_user_secret)

    # 1. Fetch all SnapTrade accounts for this user
    try:
        accounts_resp = client.account_information.list_user_accounts(
            user_id=user_id, user_secret=user_secret
        )
        all_accounts = accounts_resp.body if isinstance(accounts_resp.body, list) else []
    except Exception as exc:
        logger.error("SnapTrade list_user_accounts failed: %s", exc)
        connection.error_code = str(exc)[:255]
        return {"accounts_synced": 0, "holdings_synced": 0}

    auth_id = connection.snaptrade_authorization_id
    snap_accounts = [a for a in all_accounts if _get_auth_id(a) == auth_id] or all_accounts

    accounts_synced = 0
    holdings_synced = 0

    for sa_acct in snap_accounts:
        snap_acct_id = _attr(sa_acct, "id")
        acct_name = _attr(sa_acct, "name") or "Brokerage Account"
        balance_obj = _attr(sa_acct, "balance")
        total_val = _safe_decimal(_attr(balance_obj, "total")) if balance_obj else None

        # Upsert account
        result = await db.execute(
            select(Account).where(Account.snaptrade_account_id == snap_acct_id)
        )
        acct = result.scalar_one_or_none()
        if acct:
            acct.current_balance = total_val
            acct.name = acct_name
        else:
            acct = Account(
                snaptrade_connection_id=connection.id,
                snaptrade_account_id=snap_acct_id,
                household_id=connection.household_id,
                name=acct_name,
                institution_name=connection.brokerage_name,
                type="investment",
                subtype="brokerage",
                current_balance=total_val,
                is_manual=False,
                is_hidden=False,
            )
            db.add(acct)
        await db.flush()
        await db.refresh(acct)
        accounts_synced += 1

        # 2. Fetch holdings for this account
        try:
            holdings_resp = client.account_information.get_user_holdings(
                account_id=snap_acct_id,
                user_id=user_id,
                user_secret=user_secret,
            )
            body = holdings_resp.body if isinstance(holdings_resp.body, dict) else {}
            positions = body.get("positions") or []
        except Exception as exc:
            logger.warning("SnapTrade holdings fetch failed for account %s: %s", snap_acct_id, exc)
            positions = []

        # Delete stale holdings before re-inserting
        old_result = await db.execute(select(Holding).where(Holding.account_id == acct.id))
        for old_h in old_result.scalars().all():
            await db.delete(old_h)
        await db.flush()

        for pos in positions:
            sym_obj = _attr(pos, "symbol")
            inner_sym = _attr(sym_obj, "symbol") if sym_obj else None
            if inner_sym and not isinstance(inner_sym, str):
                ticker = _attr(inner_sym, "symbol")
                name = _attr(inner_sym, "description")
                sym_type = _attr(inner_sym, "type")
                is_crypto = _attr(sym_type, "code") == "crypto" if sym_type else False
            else:
                ticker = inner_sym
                name = _attr(sym_obj, "description") if sym_obj else None
                is_crypto = False
            units = _safe_decimal(_attr(pos, "units"))
            avg_price = _safe_decimal(_attr(pos, "average_purchase_price"))
            mkt_value = _safe_decimal(_attr(pos, "market_value"))
            cost_basis = (avg_price * units) if avg_price and units else None

            if units is None:
                continue

            db.add(Holding(
                account_id=acct.id,
                household_id=connection.household_id,
                ticker_symbol=ticker,
                name=name,
                quantity=units,
                cost_basis=cost_basis,
                current_value=mkt_value,
                asset_class="crypto" if is_crypto else None,
                as_of_date=datetime.now(timezone.utc),
            ))
            holdings_synced += 1

    connection.last_synced_at = datetime.now(timezone.utc)
    connection.error_code = None
    await db.flush()

    return {"accounts_synced": accounts_synced, "holdings_synced": holdings_synced}


# ── Async runner for Celery tasks ───────────────────────────────────────────────

async def _run_sync_for_connection(connection_id: uuid.UUID) -> dict:
    """Create a fresh async session, load connection + snap_user, run sync, commit."""
    async_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    AsyncSessionLocal = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with AsyncSessionLocal() as db:
            conn_result = await db.execute(
                select(SnapTradeConnection).where(
                    SnapTradeConnection.id == connection_id,
                    SnapTradeConnection.is_active == True,  # noqa: E712
                )
            )
            conn = conn_result.scalar_one_or_none()
            if not conn:
                logger.warning("SnapTradeConnection %s not found or inactive", connection_id)
                return {}

            user_result = await db.execute(
                select(SnapTradeUser).where(SnapTradeUser.household_id == conn.household_id)
            )
            snap_user = user_result.scalar_one_or_none()
            if not snap_user:
                logger.warning("No SnapTradeUser for household %s", conn.household_id)
                return {}

            stats = await sync_snaptrade_connection(conn, snap_user, db)
            await db.commit()
            logger.info("SnapTrade sync complete for connection %s: %s", connection_id, stats)
            return stats
    except Exception:
        logger.exception("SnapTrade sync failed for connection %s", connection_id)
        raise
    finally:
        await async_engine.dispose()


# ── Celery tasks ────────────────────────────────────────────────────────────────

@celery_app.task(name="app.services.snaptrade_sync.sync_all_snaptrade_connections")
def sync_all_snaptrade_connections() -> None:
    """Iterate all active SnapTrade connections and sync those whose refresh interval has elapsed."""
    logger.info("sync_all_snaptrade_connections: starting")
    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    now = datetime.now(timezone.utc)

    with Session(engine) as db:
        connections = db.execute(
            select(SnapTradeConnection).where(SnapTradeConnection.is_active == True)  # noqa: E712
        ).scalars().all()

        logger.info("sync_all_snaptrade_connections: %d active connection(s) found", len(connections))

        for conn in connections:
            if conn.last_synced_at is not None:
                elapsed = now - conn.last_synced_at
                if elapsed < timedelta(hours=conn.refresh_interval_hours):
                    logger.debug(
                        "SnapTradeConnection %s not due (%.1fh elapsed, interval %dh)",
                        conn.id,
                        elapsed.total_seconds() / 3600,
                        conn.refresh_interval_hours,
                    )
                    continue

            logger.info("Syncing SnapTradeConnection %s (%s)", conn.id, conn.brokerage_name)
            try:
                asyncio.run(_run_sync_for_connection(conn.id))
            except Exception as exc:
                logger.error("SnapTradeConnection %s sync failed: %s", conn.id, exc)
                try:
                    stale = db.get(SnapTradeConnection, conn.id)
                    if stale:
                        stale.error_code = str(exc)[:255]
                        db.commit()
                except Exception:
                    pass

    engine.dispose()
    logger.info("sync_all_snaptrade_connections: done")


@celery_app.task(name="app.services.snaptrade_sync.sync_single_snaptrade_connection")
def sync_single_snaptrade_connection(connection_id_str: str) -> dict:
    """Sync a single SnapTrade connection on demand. Called from API or manually."""
    logger.info("sync_single_snaptrade_connection: connection_id=%s", connection_id_str)
    try:
        return asyncio.run(_run_sync_for_connection(uuid.UUID(connection_id_str))) or {}
    except Exception as exc:
        logger.error("sync_single_snaptrade_connection failed for %s: %s", connection_id_str, exc)
        engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
        try:
            with Session(engine) as db:
                conn = db.get(SnapTradeConnection, uuid.UUID(connection_id_str))
                if conn:
                    conn.error_code = str(exc)[:255]
                    db.commit()
        except Exception:
            logger.exception("Failed to persist error_code for SnapTradeConnection %s", connection_id_str)
        finally:
            engine.dispose()
        raise
