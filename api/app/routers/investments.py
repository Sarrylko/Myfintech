"""Investment price refresh settings and manual trigger endpoints."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import Household, User
from app.services.price_refresh import is_market_open, next_market_open, refresh_prices_for_household

router = APIRouter(prefix="/investments", tags=["investments"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class InvestmentRefreshSettings(BaseModel):
    price_refresh_enabled: bool
    price_refresh_interval_minutes: int


class RefreshStatus(BaseModel):
    last_refresh: datetime | None
    next_refresh: datetime | None
    enabled: bool
    interval_minutes: int


class MarketStatus(BaseModel):
    is_open: bool
    next_open: datetime | None


class RefreshResult(BaseModel):
    refreshed: int


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/market-status", response_model=MarketStatus)
async def market_status():
    """Return whether NYSE is currently open and when it next opens."""
    open_flag = is_market_open()
    return MarketStatus(
        is_open=open_flag,
        next_open=None if open_flag else next_market_open(),
    )


@router.get("/refresh-status", response_model=RefreshStatus)
async def refresh_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return refresh status for the current household."""
    result = await db.execute(
        select(Household).where(Household.id == user.household_id)
    )
    hh = result.scalar_one_or_none()

    last_refresh = hh.last_price_refresh_at if hh else None
    interval = hh.price_refresh_interval_minutes if hh else 15
    enabled = hh.price_refresh_enabled if hh else False

    next_refresh: datetime | None = None
    if last_refresh and enabled:
        next_refresh = last_refresh + timedelta(minutes=interval)

    return RefreshStatus(
        last_refresh=last_refresh,
        next_refresh=next_refresh,
        enabled=enabled,
        interval_minutes=interval,
    )


@router.post("/refresh-prices", response_model=RefreshResult)
async def manual_refresh_prices(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a price refresh (bypasses market hours check)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as SyncSession
    from app.core.config import settings as app_settings

    engine = create_engine(app_settings.database_url_sync, pool_pre_ping=True)
    try:
        with SyncSession(engine) as sync_session:
            count = refresh_prices_for_household(user.household_id, sync_session)
    finally:
        engine.dispose()

    # Refresh the async session view of the household so callers get updated timestamps
    await db.rollback()

    return RefreshResult(refreshed=count)


@router.get("/settings", response_model=InvestmentRefreshSettings)
async def get_refresh_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the household's investment price refresh configuration."""
    result = await db.execute(
        select(Household).where(Household.id == user.household_id)
    )
    hh = result.scalar_one_or_none()
    return InvestmentRefreshSettings(
        price_refresh_enabled=hh.price_refresh_enabled if hh else True,
        price_refresh_interval_minutes=hh.price_refresh_interval_minutes if hh else 15,
    )


@router.patch("/settings", response_model=InvestmentRefreshSettings)
async def update_refresh_settings(
    payload: InvestmentRefreshSettings,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the household's investment price refresh configuration."""
    result = await db.execute(
        select(Household).where(Household.id == user.household_id)
    )
    hh = result.scalar_one_or_none()
    if hh is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Household not found")

    hh.price_refresh_enabled = payload.price_refresh_enabled
    hh.price_refresh_interval_minutes = payload.price_refresh_interval_minutes
    await db.commit()
    await db.refresh(hh)

    return InvestmentRefreshSettings(
        price_refresh_enabled=hh.price_refresh_enabled,
        price_refresh_interval_minutes=hh.price_refresh_interval_minutes,
    )
