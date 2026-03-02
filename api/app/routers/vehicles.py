import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.insurance import InsurancePolicy
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleResponse, VehicleUpdate

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


async def _get_vehicle_or_404(
    vehicle_id: uuid.UUID, household_id: uuid.UUID, db: AsyncSession
) -> Vehicle:
    result = await db.execute(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.household_id == household_id,
        )
    )
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return v


@router.get("/", response_model=list[VehicleResponse])
async def list_vehicles(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Vehicle)
        .where(Vehicle.household_id == user.household_id)
        .order_by(Vehicle.make, Vehicle.model)
    )
    return result.scalars().all()


@router.post("/", response_model=VehicleResponse, status_code=201)
async def create_vehicle(
    payload: VehicleCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    v = Vehicle(
        household_id=user.household_id,
        **payload.model_dump(),
    )
    db.add(v)
    await db.flush()
    await db.refresh(v)
    return v


@router.patch("/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    payload: VehicleUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    v = await _get_vehicle_or_404(vehicle_id, user.household_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(v, field, value)
    await db.flush()
    await db.refresh(v)
    return v


@router.delete("/{vehicle_id}", status_code=204)
async def delete_vehicle(
    vehicle_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    v = await _get_vehicle_or_404(vehicle_id, user.household_id, db)
    # Check if any insurance policies reference this vehicle
    result = await db.execute(
        select(InsurancePolicy).where(InsurancePolicy.vehicle_id == vehicle_id).limit(1)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Cannot delete vehicle with linked insurance policies. Remove or reassign policies first.",
        )
    await db.delete(v)
