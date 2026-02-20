import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.property import Property, PropertyValuation
from app.models.user import User
from app.schemas.property import PropertyCreate, PropertyResponse, PropertyUpdate

router = APIRouter(prefix="/properties", tags=["properties"])


@router.get("/", response_model=list[PropertyResponse])
async def list_properties(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Property)
        .where(Property.household_id == user.household_id)
        .order_by(Property.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=PropertyResponse, status_code=201)
async def create_property(
    payload: PropertyCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prop = Property(
        household_id=user.household_id,
        address=payload.address,
        city=payload.city,
        state=payload.state,
        zip_code=payload.zip_code,
        property_type=payload.property_type,
        purchase_price=payload.purchase_price,
        purchase_date=payload.purchase_date,
        current_value=payload.current_value,
        last_valuation_date=datetime.now(timezone.utc) if payload.current_value else None,
        notes=payload.notes,
    )
    db.add(prop)
    await db.flush()
    await db.refresh(prop)
    return prop


@router.patch("/{property_id}", response_model=PropertyResponse)
async def update_property(
    property_id: uuid.UUID,
    payload: PropertyUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.household_id == user.household_id,
        )
    )
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(prop, field, value)

    if payload.current_value is not None:
        now = datetime.now(timezone.utc)
        prop.last_valuation_date = now
        db.add(PropertyValuation(
            property_id=prop.id,
            value=payload.current_value,
            source="manual",
            valuation_date=now,
        ))

    await db.flush()
    await db.refresh(prop)
    return prop


@router.delete("/{property_id}", status_code=204)
async def delete_property(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.household_id == user.household_id,
        )
    )
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    await db.delete(prop)
