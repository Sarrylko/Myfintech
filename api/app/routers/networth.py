"""Net worth snapshot API endpoints."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account
from app.models.networth import NetWorthSnapshot
from app.models.property import Property
from app.models.property_details import Loan
from app.models.user import Household, User
from app.services.networth_metrics import compute_net_worth

router = APIRouter(prefix="/networth", tags=["networth"])


# ─── Schema ─────────────────────────────────────────────────────────────────────

class NetWorthSnapshotResponse(BaseModel):
    id: uuid.UUID
    snapshot_date: datetime
    total_cash: Decimal
    total_investments: Decimal
    total_real_estate: Decimal
    total_debts: Decimal
    net_worth: Decimal

    model_config = {"from_attributes": True}


# ─── Helpers ─────────────────────────────────────────────────────────────────────

async def _compute_metrics_async(db: AsyncSession, household_id: uuid.UUID) -> dict:
    """Compute the 5 snapshot metrics using the async session."""
    household = (await db.execute(
        select(Household).where(Household.id == household_id)
    )).scalar_one_or_none()
    home_currency = household.default_currency if household else "USD"
    home_country = household.country_code if household else "US"

    accounts = (await db.execute(
        select(Account).where(Account.household_id == household_id)
    )).scalars().all()
    properties = (await db.execute(
        select(Property).where(Property.household_id == household_id)
    )).scalars().all()
    loans = (await db.execute(
        select(Loan).where(Loan.property_id.in_([p.id for p in properties]))
    )).scalars().all() if properties else []
    return compute_net_worth(list(accounts), list(properties), list(loans), home_country, home_currency)


# ─── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/snapshots", response_model=list[NetWorthSnapshotResponse])
async def list_snapshots(
    days: int = Query(default=365, ge=1, le=365 * 5),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return daily snapshots for the current household, oldest first."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        select(NetWorthSnapshot)
        .where(
            NetWorthSnapshot.household_id == user.household_id,
            NetWorthSnapshot.snapshot_date >= since,
        )
        .order_by(NetWorthSnapshot.snapshot_date)
    )
    return result.scalars().all()


@router.post("/snapshots", response_model=NetWorthSnapshotResponse, status_code=201)
async def take_snapshot(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Compute and save (or refresh) today's net worth snapshot for the current household."""
    today = datetime.now(timezone.utc).date()

    existing = (await db.execute(
        select(NetWorthSnapshot).where(
            NetWorthSnapshot.household_id == user.household_id,
            func.date(NetWorthSnapshot.snapshot_date) == today,
        )
    )).scalar_one_or_none()

    metrics = await _compute_metrics_async(db, user.household_id)

    if existing:
        existing.snapshot_date = datetime.now(timezone.utc)
        existing.total_cash = metrics["total_cash"]
        existing.total_investments = metrics["total_investments"]
        existing.total_real_estate = metrics["total_real_estate"]
        existing.total_debts = metrics["total_debts"]
        existing.net_worth = metrics["net_worth"]
        await db.flush()
        return existing
    else:
        snap = NetWorthSnapshot(
            household_id=user.household_id,
            snapshot_date=datetime.now(timezone.utc),
            **metrics,
        )
        db.add(snap)
        await db.flush()
        await db.refresh(snap)
        return snap
