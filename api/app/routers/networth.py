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
from app.models.user import User

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
    accounts = (await db.execute(
        select(Account).where(
            Account.household_id == household_id,
            Account.is_hidden == False,  # noqa: E712
        )
    )).scalars().all()

    total_cash = Decimal(0)
    total_investments = Decimal(0)
    credit_debt = Decimal(0)

    for acc in accounts:
        bal = acc.current_balance or Decimal(0)
        if acc.type == "depository":
            total_cash += bal
        elif acc.type in ("investment", "brokerage"):
            total_investments += bal
        elif acc.type == "credit":
            credit_debt += bal

    properties = (await db.execute(
        select(Property).where(Property.household_id == household_id)
    )).scalars().all()

    total_real_estate = sum((p.current_value or Decimal(0)) for p in properties)

    total_mortgage = Decimal(0)
    if properties:
        prop_ids = [p.id for p in properties]
        loans = (await db.execute(
            select(Loan).where(Loan.property_id.in_(prop_ids))
        )).scalars().all()
        total_mortgage = sum((l.current_balance or Decimal(0)) for l in loans)

    total_debts = credit_debt + total_mortgage
    net_worth = total_cash + total_investments + Decimal(str(total_real_estate)) - total_debts

    return {
        "total_cash": total_cash,
        "total_investments": total_investments,
        "total_real_estate": Decimal(str(total_real_estate)),
        "total_debts": total_debts,
        "net_worth": net_worth,
    }


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
