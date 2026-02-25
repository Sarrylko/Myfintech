"""
Property cost status — tracks whether property_tax / hoa / insurance
is paid or due for a given year, per property.

GET  /properties/{property_id}/cost-statuses?year=2025
PUT  /properties/{property_id}/cost-statuses/{year}/{category}
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.property import Property
from app.models.property_cost_status import PropertyCostStatus
from app.models.user import User
from app.schemas.property_cost_status import (
    TRACKED_CATEGORIES,
    PropertyCostStatusResponse,
    PropertyCostStatusUpsert,
)

router = APIRouter(tags=["property-cost-statuses"])


async def _get_property_or_404(property_id: uuid.UUID, user: User, db: AsyncSession) -> Property:
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.household_id == user.household_id,
        )
    )
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


# ── List statuses for a property (optionally filtered by year) ────────────────

@router.get(
    "/properties/{property_id}/cost-statuses",
    response_model=list[PropertyCostStatusResponse],
)
async def list_cost_statuses(
    property_id: uuid.UUID,
    year: int | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property_or_404(property_id, user, db)

    query = select(PropertyCostStatus).where(
        PropertyCostStatus.property_id == property_id,
        PropertyCostStatus.household_id == user.household_id,
    )
    if year is not None:
        query = query.where(PropertyCostStatus.year == year)

    result = await db.execute(query)
    return result.scalars().all()


# ── Upsert a single status (create or update) ────────────────────────────────

@router.put(
    "/properties/{property_id}/cost-statuses/{year}/{category}",
    response_model=PropertyCostStatusResponse,
)
async def upsert_cost_status(
    property_id: uuid.UUID,
    year: int,
    category: str,
    body: PropertyCostStatusUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if category not in TRACKED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Category must be one of: {', '.join(sorted(TRACKED_CATEGORIES))}",
        )
    if year < 2000 or year > 2100:
        raise HTTPException(status_code=400, detail="Year out of range")

    await _get_property_or_404(property_id, user, db)

    stmt = (
        pg_insert(PropertyCostStatus)
        .values(
            id=uuid.uuid4(),
            property_id=property_id,
            household_id=user.household_id,
            year=year,
            category=category,
            is_paid=body.is_paid,
            paid_date=body.paid_date,
        )
        .on_conflict_do_update(
            constraint="uq_property_cost_status",
            set_={"is_paid": body.is_paid, "paid_date": body.paid_date},
        )
        .returning(PropertyCostStatus)
    )
    result = await db.execute(stmt)
    await db.flush()
    row = result.scalar_one()
    await db.refresh(row)
    return row
