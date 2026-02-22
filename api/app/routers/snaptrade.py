"""SnapTrade brokerage integration router.

SnapTrade flow:
  1. Register household as a SnapTrade user (once).
  2. Generate a portal redirect URL; user connects their broker on SnapTrade's site.
  3. After redirect-back, call /sync-authorizations to discover new connections & pull accounts/holdings.
  4. Each brokerage connection is a SnapTradeConnection row; accounts use snaptrade_connection_id FK.
"""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import decrypt_value, encrypt_value
from app.models.account import Account
from app.models.investment import Holding
from app.models.snaptrade import SnapTradeConnection, SnapTradeUser
from app.models.user import User
from app.schemas.snaptrade import (
    SnapTradeConnectUrlResponse,
    SnapTradeConnectionResponse,
    SnapTradeRegisterResponse,
    SnapTradeSyncResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/snaptrade", tags=["snaptrade"])

# Redirect URI sent to SnapTrade portal; frontend detects ?snaptrade_connected=1 and calls sync
_REDIRECT_URI = "http://localhost:3000/accounts?snaptrade_connected=1"


# ─── SDK helper ────────────────────────────────────────────────────────────────

def _get_client():
    if not settings.snaptrade_client_id or not settings.snaptrade_consumer_key:
        raise HTTPException(status_code=503, detail="SnapTrade is not configured")
    from snaptrade_client import SnapTrade, Configuration
    conf = Configuration(
        consumer_key=settings.snaptrade_consumer_key,
        client_id=settings.snaptrade_client_id,
    )
    return SnapTrade(configuration=conf)


# ─── Internal helpers ───────────────────────────────────────────────────────────

async def _get_or_register_snaptrade_user(
    household_id: uuid.UUID, db: AsyncSession
) -> SnapTradeUser:
    """Return existing SnapTradeUser for household, or register a new one."""
    result = await db.execute(
        select(SnapTradeUser).where(SnapTradeUser.household_id == household_id)
    )
    snap_user = result.scalar_one_or_none()
    if snap_user:
        return snap_user

    client = _get_client()
    user_id = str(household_id)
    try:
        resp = client.authentication.register_snap_trade_user(body={"userId": user_id})
        body = resp.body if isinstance(resp.body, dict) else {}
        user_secret = body.get("userSecret") or body.get("user_secret", "")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SnapTrade registration failed: {exc}")

    snap_user = SnapTradeUser(
        household_id=household_id,
        snaptrade_user_id=user_id,
        encrypted_user_secret=encrypt_value(user_secret),
    )
    db.add(snap_user)
    await db.flush()
    await db.refresh(snap_user)
    return snap_user


async def _sync_connection(
    connection: SnapTradeConnection,
    snap_user: SnapTradeUser,
    db: AsyncSession,
) -> dict:
    """Pull accounts and holdings for one SnapTrade brokerage authorization."""
    client = _get_client()
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

    # Filter to accounts belonging to this brokerage authorization
    auth_id = connection.snaptrade_authorization_id
    snap_accounts = [a for a in all_accounts if _get_auth_id(a) == auth_id]

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

        # Delete stale holdings for this account before re-inserting
        old_result = await db.execute(select(Holding).where(Holding.account_id == acct.id))
        for old_h in old_result.scalars().all():
            await db.delete(old_h)
        await db.flush()

        for pos in positions:
            sym_obj = _attr(pos, "symbol")
            # symbol.symbol may be a nested object with a .symbol attribute
            ticker = _attr(sym_obj, "symbol") if sym_obj else None
            if ticker and not isinstance(ticker, str):
                ticker = _attr(ticker, "symbol")
            name = _attr(sym_obj, "description") if sym_obj else None
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
                as_of_date=datetime.now(timezone.utc),
            ))
            holdings_synced += 1

    connection.last_synced_at = datetime.now(timezone.utc)
    connection.error_code = None
    await db.flush()

    return {"accounts_synced": accounts_synced, "holdings_synced": holdings_synced}


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


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register-user", response_model=SnapTradeRegisterResponse)
async def register_user(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register this household as a SnapTrade user (idempotent)."""
    snap_user = await _get_or_register_snaptrade_user(user.household_id, db)
    await db.commit()
    return SnapTradeRegisterResponse(
        registered=True,
        snaptrade_user_id=snap_user.snaptrade_user_id,
    )


@router.post("/connect-url", response_model=SnapTradeConnectUrlResponse)
async def get_connect_url(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a SnapTrade portal URL for connecting a brokerage account."""
    snap_user = await _get_or_register_snaptrade_user(user.household_id, db)
    await db.flush()

    client = _get_client()
    user_secret = decrypt_value(snap_user.encrypted_user_secret)
    try:
        resp = client.authentication.login_snap_trade_user(
            user_id=snap_user.snaptrade_user_id,
            user_secret=user_secret,
            custom_redirect=_REDIRECT_URI,
            connection_type="read",
        )
        body = resp.body if isinstance(resp.body, dict) else {}
        redirect_url = body.get("redirectURI") or body.get("redirect_uri")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SnapTrade login failed: {exc}")

    if not redirect_url:
        raise HTTPException(status_code=502, detail="SnapTrade returned no redirect URL")

    await db.commit()
    return SnapTradeConnectUrlResponse(redirect_url=redirect_url)


@router.get("/connections", response_model=list[SnapTradeConnectionResponse])
async def list_connections(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active SnapTrade brokerage connections for this household."""
    result = await db.execute(
        select(SnapTradeConnection).where(
            SnapTradeConnection.household_id == user.household_id,
            SnapTradeConnection.is_active == True,  # noqa: E712
        )
    )
    connections = result.scalars().all()

    out = []
    for conn in connections:
        acct_result = await db.execute(
            select(Account).where(Account.snaptrade_connection_id == conn.id)
        )
        account_count = len(acct_result.scalars().all())
        out.append(SnapTradeConnectionResponse(
            id=conn.id,
            brokerage_name=conn.brokerage_name,
            brokerage_slug=conn.brokerage_slug,
            snaptrade_authorization_id=conn.snaptrade_authorization_id,
            is_active=conn.is_active,
            last_synced_at=conn.last_synced_at,
            account_count=account_count,
        ))
    return out


@router.post("/sync-authorizations", response_model=list[SnapTradeConnectionResponse])
async def sync_authorizations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Discover new SnapTrade brokerage authorizations and sync their accounts/holdings.

    Call this after the user returns from the SnapTrade connect portal.
    """
    snap_user_result = await db.execute(
        select(SnapTradeUser).where(SnapTradeUser.household_id == user.household_id)
    )
    snap_user = snap_user_result.scalar_one_or_none()
    if not snap_user:
        raise HTTPException(status_code=400, detail="SnapTrade user not registered")

    client = _get_client()
    user_secret = decrypt_value(snap_user.encrypted_user_secret)

    # Fetch all authorizations from SnapTrade
    try:
        auths_resp = client.connections.list_brokerage_authorizations(
            user_id=snap_user.snaptrade_user_id,
            user_secret=user_secret,
        )
        authorizations = auths_resp.body if isinstance(auths_resp.body, list) else []
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SnapTrade error: {exc}")

    out = []
    for auth in authorizations:
        auth_id = _attr(auth, "id")
        broker_obj = _attr(auth, "brokerage")
        broker_name = _attr(broker_obj, "name") if broker_obj else None
        broker_slug = _attr(broker_obj, "slug") if broker_obj else None

        # Upsert connection record
        result = await db.execute(
            select(SnapTradeConnection).where(
                SnapTradeConnection.snaptrade_authorization_id == auth_id
            )
        )
        conn = result.scalar_one_or_none()
        if conn:
            conn.is_active = True
            conn.brokerage_name = broker_name
            conn.brokerage_slug = broker_slug
        else:
            conn = SnapTradeConnection(
                household_id=user.household_id,
                snaptrade_authorization_id=auth_id,
                brokerage_name=broker_name,
                brokerage_slug=broker_slug,
            )
            db.add(conn)
        await db.flush()
        await db.refresh(conn)

        # Sync accounts and holdings for this connection
        try:
            await _sync_connection(conn, snap_user, db)
        except Exception as exc:
            logger.error("Sync failed for connection %s: %s", conn.id, exc)
            conn.error_code = str(exc)[:255]

        acct_result = await db.execute(
            select(Account).where(Account.snaptrade_connection_id == conn.id)
        )
        account_count = len(acct_result.scalars().all())
        out.append(SnapTradeConnectionResponse(
            id=conn.id,
            brokerage_name=conn.brokerage_name,
            brokerage_slug=conn.brokerage_slug,
            snaptrade_authorization_id=conn.snaptrade_authorization_id,
            is_active=conn.is_active,
            last_synced_at=conn.last_synced_at,
            account_count=account_count,
        ))

    await db.commit()
    return out


@router.post("/connections/{connection_id}/sync", response_model=SnapTradeSyncResponse)
async def sync_connection(
    connection_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a sync for one brokerage connection."""
    conn_result = await db.execute(
        select(SnapTradeConnection).where(
            SnapTradeConnection.id == connection_id,
            SnapTradeConnection.household_id == user.household_id,
            SnapTradeConnection.is_active == True,  # noqa: E712
        )
    )
    conn = conn_result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    snap_user_result = await db.execute(
        select(SnapTradeUser).where(SnapTradeUser.household_id == user.household_id)
    )
    snap_user = snap_user_result.scalar_one_or_none()
    if not snap_user:
        raise HTTPException(status_code=400, detail="SnapTrade user not registered")

    stats = await _sync_connection(conn, snap_user, db)
    await db.commit()
    return SnapTradeSyncResponse(**stats)


@router.delete("/connections/{connection_id}", status_code=204)
async def disconnect_connection(
    connection_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a SnapTrade brokerage authorization and soft-delete the connection."""
    conn_result = await db.execute(
        select(SnapTradeConnection).where(
            SnapTradeConnection.id == connection_id,
            SnapTradeConnection.household_id == user.household_id,
        )
    )
    conn = conn_result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    snap_user_result = await db.execute(
        select(SnapTradeUser).where(SnapTradeUser.household_id == user.household_id)
    )
    snap_user = snap_user_result.scalar_one_or_none()

    # Attempt to revoke on SnapTrade's side (best-effort)
    if snap_user:
        try:
            client = _get_client()
            user_secret = decrypt_value(snap_user.encrypted_user_secret)
            client.connections.remove_brokerage_authorization(
                authorization_id=conn.snaptrade_authorization_id,
                user_id=snap_user.snaptrade_user_id,
                user_secret=user_secret,
            )
        except Exception as exc:
            logger.warning("SnapTrade revoke failed (continuing): %s", exc)

    conn.is_active = False
    await db.commit()
