"""SnapTrade brokerage integration router.

SnapTrade flow:
  1. Register household as a SnapTrade user (once).
  2. Generate a portal redirect URL; user connects their broker on SnapTrade's site.
  3. After redirect-back, call /sync-authorizations to discover new connections & pull accounts/holdings.
  4. Each brokerage connection is a SnapTradeConnection row; accounts use snaptrade_connection_id FK.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import decrypt_value, encrypt_value
from app.models.account import Account
from app.models.snaptrade import SnapTradeConnection, SnapTradeUser
from app.models.user import User
from app.schemas.snaptrade import (
    SnapTradeConnectUrlResponse,
    SnapTradeConnectionResponse,
    SnapTradeRegisterResponse,
    SnapTradeSyncResponse,
)
from app.services.snaptrade_sync import (
    _attr,
    _get_auth_id,
    _get_snaptrade_client,
    sync_snaptrade_connection,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/snaptrade", tags=["snaptrade"])

# Redirect URI sent to SnapTrade portal; frontend detects ?snaptrade_connected=1 and calls sync
_REDIRECT_URI = "http://localhost:3000/accounts?snaptrade_connected=1"


# ─── SDK helper ────────────────────────────────────────────────────────────────

def _get_client():
    try:
        return _get_snaptrade_client()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


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
    """Delegate to the snaptrade_sync service."""
    return await sync_snaptrade_connection(connection, snap_user, db)


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


@router.post("/connections/{connection_id}/reconnect-url", response_model=SnapTradeConnectUrlResponse)
async def get_reconnect_url(
    connection_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a SnapTrade portal URL for re-authenticating an existing brokerage
    connection (e.g. after the brokerage password changed). This reuses the same
    authorization instead of creating a duplicate connection."""
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
    if not snap_user:
        raise HTTPException(status_code=400, detail="SnapTrade user not registered")

    client = _get_client()
    user_secret = decrypt_value(snap_user.encrypted_user_secret)
    try:
        resp = client.authentication.login_snap_trade_user(
            user_id=snap_user.snaptrade_user_id,
            user_secret=user_secret,
            custom_redirect=_REDIRECT_URI,
            connection_type="read",
            reconnect=conn.snaptrade_authorization_id,
        )
        body = resp.body if isinstance(resp.body, dict) else {}
        redirect_url = body.get("redirectURI") or body.get("redirect_uri")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SnapTrade login failed: {exc}")

    if not redirect_url:
        raise HTTPException(status_code=502, detail="SnapTrade returned no redirect URL")

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

    try:
        stats = await _sync_connection(conn, snap_user, db)
    except Exception as exc:
        conn.error_code = str(exc)[:255]
        await db.commit()
        raise HTTPException(status_code=502, detail=str(exc))
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
