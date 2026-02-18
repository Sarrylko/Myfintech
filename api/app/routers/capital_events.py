import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.capital_event import CapitalEvent
from app.models.property import Property
from app.models.user import User
from app.schemas.capital_event import (
    CapitalEventCreate,
    CapitalEventResponse,
    CapitalEventUpdate,
)

router = APIRouter(tags=["capital-events"])


async def _get_property(
    property_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Property:
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


@router.get(
    "/properties/{property_id}/capital-events",
    response_model=list[CapitalEventResponse],
)
async def list_capital_events(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    result = await db.execute(
        select(CapitalEvent)
        .where(CapitalEvent.property_id == property_id)
        .order_by(CapitalEvent.event_date)
    )
    return result.scalars().all()


@router.post(
    "/properties/{property_id}/capital-events",
    response_model=CapitalEventResponse,
    status_code=201,
)
async def create_capital_event(
    property_id: uuid.UUID,
    payload: CapitalEventCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    event = CapitalEvent(property_id=property_id, **payload.model_dump())
    db.add(event)
    await db.flush()
    await db.refresh(event)
    return event


@router.patch("/capital-events/{event_id}", response_model=CapitalEventResponse)
async def update_capital_event(
    event_id: uuid.UUID,
    payload: CapitalEventUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CapitalEvent)
        .join(Property, CapitalEvent.property_id == Property.id)
        .where(
            CapitalEvent.id == event_id,
            Property.household_id == user.household_id,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Capital event not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    await db.flush()
    await db.refresh(event)
    return event


@router.delete("/capital-events/{event_id}", status_code=204)
async def delete_capital_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CapitalEvent)
        .join(Property, CapitalEvent.property_id == Property.id)
        .where(
            CapitalEvent.id == event_id,
            Property.household_id == user.household_id,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Capital event not found")
    await db.delete(event)
