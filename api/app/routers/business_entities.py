import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account
from app.models.business_entity import BusinessEntity, EntityOwnership
from app.models.property import Property
from app.models.user import User
from app.schemas.business_entity import (
    BusinessEntityCreate,
    BusinessEntityDetail,
    BusinessEntityResponse,
    BusinessEntityTree,
    BusinessEntityUpdate,
    EntityOwnershipCreate,
    EntityOwnershipResponse,
    LinkedAccountSummary,
    LinkedPropertySummary,
)

router = APIRouter(prefix="/business-entities", tags=["business-entities"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_entity_or_404(
    entity_id: uuid.UUID, household_id: uuid.UUID, db: AsyncSession
) -> BusinessEntity:
    result = await db.execute(
        select(BusinessEntity).where(
            BusinessEntity.id == entity_id,
            BusinessEntity.household_id == household_id,
        )
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Business entity not found")
    return entity


def _build_tree(
    entities: list[BusinessEntity], parent_id: uuid.UUID | None
) -> list[BusinessEntityTree]:
    nodes = []
    for e in entities:
        if e.parent_id == parent_id:
            node = BusinessEntityTree.model_validate(e)
            node.children = _build_tree(entities, e.id)
            nodes.append(node)
    return nodes


# ── List & Create ─────────────────────────────────────────────────────────────

@router.get("/", response_model=list[BusinessEntityResponse])
async def list_entities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BusinessEntity)
        .where(BusinessEntity.household_id == user.household_id)
        .order_by(BusinessEntity.name)
    )
    return result.scalars().all()


@router.get("/tree", response_model=list[BusinessEntityTree])
async def get_entity_tree(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all entities as a nested tree rooted at top-level (no parent) entities."""
    result = await db.execute(
        select(BusinessEntity)
        .where(BusinessEntity.household_id == user.household_id)
        .order_by(BusinessEntity.name)
    )
    all_entities = result.scalars().all()
    return _build_tree(all_entities, None)


@router.post("/", response_model=BusinessEntityResponse, status_code=201)
async def create_entity(
    payload: BusinessEntityCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate parent belongs to same household
    if payload.parent_id:
        await _get_entity_or_404(payload.parent_id, user.household_id, db)

    entity = BusinessEntity(
        household_id=user.household_id,
        name=payload.name,
        entity_type=payload.entity_type,
        parent_id=payload.parent_id,
        state_of_formation=payload.state_of_formation,
        ein=payload.ein,
        description=payload.description,
        is_active=payload.is_active,
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)
    return entity


# ── Single entity detail ──────────────────────────────────────────────────────

@router.get("/{entity_id}", response_model=BusinessEntityDetail)
async def get_entity(
    entity_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entity = await _get_entity_or_404(entity_id, user.household_id, db)

    # Ownership records
    own_rows = await db.execute(
        select(EntityOwnership).where(EntityOwnership.entity_id == entity_id)
    )
    ownership_records = own_rows.scalars().all()

    # Resolve owner names
    ownership_out: list[EntityOwnershipResponse] = []
    for rec in ownership_records:
        out = EntityOwnershipResponse.model_validate(rec)
        if rec.owner_user_id:
            u = await db.get(User, rec.owner_user_id)
            out.owner_name = u.full_name if u else None
        elif rec.owner_entity_id:
            oe = await db.get(BusinessEntity, rec.owner_entity_id)
            out.owner_name = oe.name if oe else None
        ownership_out.append(out)

    # Linked properties
    props_rows = await db.execute(
        select(Property).where(
            Property.entity_id == entity_id,
            Property.household_id == user.household_id,
        )
    )
    properties = [
        LinkedPropertySummary.model_validate(p) for p in props_rows.scalars().all()
    ]

    # Linked accounts
    acct_rows = await db.execute(
        select(Account).where(
            Account.entity_id == entity_id,
            Account.household_id == user.household_id,
        )
    )
    accounts = [
        LinkedAccountSummary.model_validate(a) for a in acct_rows.scalars().all()
    ]

    # Direct children
    child_rows = await db.execute(
        select(BusinessEntity).where(
            BusinessEntity.parent_id == entity_id,
            BusinessEntity.household_id == user.household_id,
        ).order_by(BusinessEntity.name)
    )
    children = child_rows.scalars().all()

    detail = BusinessEntityDetail.model_validate(entity)
    detail.ownership = ownership_out
    detail.properties = properties
    detail.accounts = accounts
    detail.children = children
    return detail


# ── Update & Delete ───────────────────────────────────────────────────────────

@router.patch("/{entity_id}", response_model=BusinessEntityResponse)
async def update_entity(
    entity_id: uuid.UUID,
    payload: BusinessEntityUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entity = await _get_entity_or_404(entity_id, user.household_id, db)

    if payload.parent_id is not None:
        if payload.parent_id == entity_id:
            raise HTTPException(status_code=400, detail="Entity cannot be its own parent")
        await _get_entity_or_404(payload.parent_id, user.household_id, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entity, field, value)

    await db.commit()
    await db.refresh(entity)
    return entity


@router.delete("/{entity_id}", status_code=204)
async def delete_entity(
    entity_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entity = await _get_entity_or_404(entity_id, user.household_id, db)
    await db.delete(entity)
    await db.commit()


# ── Ownership ─────────────────────────────────────────────────────────────────

@router.post("/{entity_id}/ownership", response_model=EntityOwnershipResponse, status_code=201)
async def add_ownership(
    entity_id: uuid.UUID,
    payload: EntityOwnershipCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity_or_404(entity_id, user.household_id, db)

    if not payload.owner_user_id and not payload.owner_entity_id:
        raise HTTPException(
            status_code=400, detail="Provide either owner_user_id or owner_entity_id"
        )
    if payload.owner_user_id and payload.owner_entity_id:
        raise HTTPException(
            status_code=400,
            detail="Provide only one of owner_user_id or owner_entity_id",
        )
    if payload.owner_entity_id:
        await _get_entity_or_404(payload.owner_entity_id, user.household_id, db)

    rec = EntityOwnership(
        entity_id=entity_id,
        owner_user_id=payload.owner_user_id,
        owner_entity_id=payload.owner_entity_id,
        ownership_pct=payload.ownership_pct,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return EntityOwnershipResponse.model_validate(rec)


@router.delete("/{entity_id}/ownership/{ownership_id}", status_code=204)
async def remove_ownership(
    entity_id: uuid.UUID,
    ownership_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity_or_404(entity_id, user.household_id, db)
    result = await db.execute(
        select(EntityOwnership).where(
            EntityOwnership.id == ownership_id,
            EntityOwnership.entity_id == entity_id,
        )
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Ownership record not found")
    await db.delete(rec)
    await db.commit()
