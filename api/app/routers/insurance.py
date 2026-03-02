import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.business_entity import BusinessEntity
from app.models.insurance import InsuranceBeneficiary, InsurancePolicy
from app.models.property import Property
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.insurance import (
    InsuranceBeneficiaryCreate,
    InsuranceBeneficiaryResponse,
    InsuranceBeneficiaryUpdate,
    InsurancePolicyCreate,
    InsurancePolicyDetail,
    InsurancePolicyResponse,
    InsurancePolicyUpdate,
)

router = APIRouter(prefix="/insurance", tags=["insurance"])


async def _get_policy_or_404(
    policy_id: uuid.UUID, household_id: uuid.UUID, db: AsyncSession
) -> InsurancePolicy:
    result = await db.execute(
        select(InsurancePolicy).where(
            InsurancePolicy.id == policy_id,
            InsurancePolicy.household_id == household_id,
        )
    )
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=404, detail="Insurance policy not found")
    return policy


async def _get_beneficiary_or_404(
    beneficiary_id: uuid.UUID, policy_id: uuid.UUID, db: AsyncSession
) -> InsuranceBeneficiary:
    result = await db.execute(
        select(InsuranceBeneficiary).where(
            InsuranceBeneficiary.id == beneficiary_id,
            InsuranceBeneficiary.policy_id == policy_id,
        )
    )
    ben = result.scalar_one_or_none()
    if not ben:
        raise HTTPException(status_code=404, detail="Beneficiary not found")
    return ben


async def _build_detail(
    policy: InsurancePolicy, db: AsyncSession
) -> InsurancePolicyDetail:
    """Resolve FK display names and load beneficiaries for the detail view."""
    # Beneficiaries
    ben_result = await db.execute(
        select(InsuranceBeneficiary)
        .where(InsuranceBeneficiary.policy_id == policy.id)
        .order_by(InsuranceBeneficiary.beneficiary_type, InsuranceBeneficiary.created_at)
    )
    beneficiaries = [
        InsuranceBeneficiaryResponse.model_validate(b) for b in ben_result.scalars().all()
    ]

    # Resolve linked entity display names
    property_address: str | None = None
    if policy.property_id:
        prop = await db.get(Property, policy.property_id)
        if prop:
            parts = [prop.address]
            if prop.city:
                parts.append(prop.city)
            if prop.state:
                parts.append(prop.state)
            property_address = ", ".join(parts)

    vehicle_label: str | None = None
    if policy.vehicle_id:
        veh = await db.get(Vehicle, policy.vehicle_id)
        if veh:
            parts = []
            if veh.year:
                parts.append(str(veh.year))
            parts.extend([veh.make, veh.model])
            vehicle_label = veh.nickname or " ".join(parts)

    insured_user_name: str | None = None
    if policy.insured_user_id:
        u = await db.get(User, policy.insured_user_id)
        if u:
            insured_user_name = getattr(u, "full_name", None) or getattr(u, "email", None)

    entity_name: str | None = None
    if policy.entity_id:
        ent = await db.get(BusinessEntity, policy.entity_id)
        if ent:
            entity_name = ent.name

    return InsurancePolicyDetail(
        **InsurancePolicyResponse.model_validate(policy).model_dump(),
        beneficiaries=beneficiaries,
        property_address=property_address,
        vehicle_label=vehicle_label,
        insured_user_name=insured_user_name,
        entity_name=entity_name,
    )


# ─── Policy CRUD ──────────────────────────────────────────────────────────────

@router.get("/", response_model=list[InsurancePolicyResponse])
async def list_policies(
    policy_type: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(InsurancePolicy).where(InsurancePolicy.household_id == user.household_id)
    if policy_type:
        q = q.where(InsurancePolicy.policy_type == policy_type)
    if is_active is not None:
        q = q.where(InsurancePolicy.is_active == is_active)
    q = q.order_by(InsurancePolicy.policy_type, InsurancePolicy.provider)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/", response_model=InsurancePolicyResponse, status_code=201)
async def create_policy(
    payload: InsurancePolicyCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    policy = InsurancePolicy(
        household_id=user.household_id,
        **payload.model_dump(),
    )
    db.add(policy)
    await db.flush()
    await db.refresh(policy)
    return policy


@router.get("/{policy_id}", response_model=InsurancePolicyDetail)
async def get_policy(
    policy_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    policy = await _get_policy_or_404(policy_id, user.household_id, db)
    return await _build_detail(policy, db)


@router.patch("/{policy_id}", response_model=InsurancePolicyResponse)
async def update_policy(
    policy_id: uuid.UUID,
    payload: InsurancePolicyUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    policy = await _get_policy_or_404(policy_id, user.household_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(policy, field, value)
    await db.flush()
    await db.refresh(policy)
    return policy


@router.delete("/{policy_id}", status_code=204)
async def delete_policy(
    policy_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    policy = await _get_policy_or_404(policy_id, user.household_id, db)
    await db.delete(policy)


# ─── Beneficiary sub-resource ─────────────────────────────────────────────────

@router.get("/{policy_id}/beneficiaries", response_model=list[InsuranceBeneficiaryResponse])
async def list_beneficiaries(
    policy_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_policy_or_404(policy_id, user.household_id, db)
    result = await db.execute(
        select(InsuranceBeneficiary)
        .where(InsuranceBeneficiary.policy_id == policy_id)
        .order_by(InsuranceBeneficiary.beneficiary_type, InsuranceBeneficiary.created_at)
    )
    return result.scalars().all()


@router.post(
    "/{policy_id}/beneficiaries",
    response_model=InsuranceBeneficiaryResponse,
    status_code=201,
)
async def add_beneficiary(
    policy_id: uuid.UUID,
    payload: InsuranceBeneficiaryCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_policy_or_404(policy_id, user.household_id, db)

    # Validate primary beneficiary percentages don't exceed 100
    if payload.beneficiary_type == "primary":
        result = await db.execute(
            select(InsuranceBeneficiary).where(
                InsuranceBeneficiary.policy_id == policy_id,
                InsuranceBeneficiary.beneficiary_type == "primary",
            )
        )
        existing = result.scalars().all()
        total = sum(float(b.percentage) for b in existing) + float(payload.percentage)
        if total > 100:
            raise HTTPException(
                status_code=400,
                detail=f"Primary beneficiary percentages would total {total:.1f}% (max 100%)",
            )

    ben = InsuranceBeneficiary(policy_id=policy_id, **payload.model_dump())
    db.add(ben)
    await db.flush()
    await db.refresh(ben)
    return ben


@router.patch(
    "/{policy_id}/beneficiaries/{beneficiary_id}",
    response_model=InsuranceBeneficiaryResponse,
)
async def update_beneficiary(
    policy_id: uuid.UUID,
    beneficiary_id: uuid.UUID,
    payload: InsuranceBeneficiaryUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_policy_or_404(policy_id, user.household_id, db)
    ben = await _get_beneficiary_or_404(beneficiary_id, policy_id, db)

    # Validate percentage if being updated
    if payload.percentage is not None:
        ben_type = payload.beneficiary_type or ben.beneficiary_type
        if ben_type == "primary":
            result = await db.execute(
                select(InsuranceBeneficiary).where(
                    InsuranceBeneficiary.policy_id == policy_id,
                    InsuranceBeneficiary.beneficiary_type == "primary",
                    InsuranceBeneficiary.id != beneficiary_id,
                )
            )
            other_total = sum(float(b.percentage) for b in result.scalars().all())
            if other_total + float(payload.percentage) > 100:
                raise HTTPException(
                    status_code=400,
                    detail=f"Primary beneficiary percentages would exceed 100%",
                )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(ben, field, value)
    await db.flush()
    await db.refresh(ben)
    return ben


@router.delete("/{policy_id}/beneficiaries/{beneficiary_id}", status_code=204)
async def delete_beneficiary(
    policy_id: uuid.UUID,
    beneficiary_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_policy_or_404(policy_id, user.household_id, db)
    ben = await _get_beneficiary_or_404(beneficiary_id, policy_id, db)
    await db.delete(ben)
