import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.business_entity import BusinessEntity, EntityEmailWatch
from app.models.user import User
from app.schemas.email_watch import (
    EntityEmailWatchCreate,
    EntityEmailWatchResponse,
    EntityEmailWatchUpdate,
)

router = APIRouter(tags=["email-watches"])


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


async def _get_watch_or_404(
    watch_id: uuid.UUID, household_id: uuid.UUID, db: AsyncSession
) -> EntityEmailWatch:
    result = await db.execute(
        select(EntityEmailWatch).where(
            EntityEmailWatch.id == watch_id,
            EntityEmailWatch.household_id == household_id,
        )
    )
    watch = result.scalar_one_or_none()
    if not watch:
        raise HTTPException(status_code=404, detail="Email watch not found")
    return watch


# ── In-app CRUD (cookie auth, household-scoped) ───────────────────────────────

@router.get(
    "/business-entities/{entity_id}/email-watches",
    response_model=list[EntityEmailWatchResponse],
)
async def list_email_watches(
    entity_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity_or_404(entity_id, user.household_id, db)
    result = await db.execute(
        select(EntityEmailWatch)
        .where(EntityEmailWatch.entity_id == entity_id)
        .order_by(EntityEmailWatch.created_at)
    )
    return result.scalars().all()


@router.post(
    "/business-entities/{entity_id}/email-watches",
    response_model=EntityEmailWatchResponse,
    status_code=201,
)
async def create_email_watch(
    entity_id: uuid.UUID,
    payload: EntityEmailWatchCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity_or_404(entity_id, user.household_id, db)

    watch = EntityEmailWatch(
        household_id=user.household_id,
        entity_id=entity_id,
        gmail_address=payload.gmail_address,
        sender_allowlist=payload.sender_allowlist,
        notif_phone_override=payload.notif_phone_override,
        is_active=payload.is_active,
    )
    db.add(watch)
    await db.commit()
    await db.refresh(watch)
    return watch


@router.patch("/email-watches/{watch_id}", response_model=EntityEmailWatchResponse)
async def update_email_watch(
    watch_id: uuid.UUID,
    payload: EntityEmailWatchUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watch = await _get_watch_or_404(watch_id, user.household_id, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(watch, field, value)

    await db.commit()
    await db.refresh(watch)
    return watch


@router.delete("/email-watches/{watch_id}", status_code=204)
async def delete_email_watch(
    watch_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    watch = await _get_watch_or_404(watch_id, user.household_id, db)
    await db.delete(watch)
    await db.commit()
