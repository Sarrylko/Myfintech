import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.user import (
    HouseholdMemberCreate,
    HouseholdMemberUpdate,
    UserPasswordChange,
    UserProfileUpdate,
    UserResponse,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_profile(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    payload: UserProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump(exclude_unset=True)

    # Check email uniqueness if changing email
    if "email" in data and data["email"] != user.email:
        existing = await db.execute(
            select(User).where(User.email == data["email"], User.id != user.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already in use",
            )

    for field, value in data.items():
        setattr(user, field, value)

    user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/me/change-password", status_code=204)
async def change_password(
    payload: UserPasswordChange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    if len(payload.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="New password must be at least 8 characters",
        )

    user.hashed_password = hash_password(payload.new_password)
    user.updated_at = datetime.now(timezone.utc)
    await db.commit()


# ─── Household member management ──────────────────────────────────────────────

@router.get("/household/members", response_model=list[UserResponse])
async def list_household_members(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all members of the current user's household."""
    result = await db.execute(
        select(User)
        .where(User.household_id == user.household_id)
        .order_by(User.created_at)
    )
    return result.scalars().all()


@router.post("/household/members", response_model=UserResponse, status_code=201)
async def add_household_member(
    payload: HouseholdMemberCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a new member to the household (owner only)."""
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Only household owners can add members")

    # Check email not already taken
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already in use")

    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    member = User(
        household_id=user.household_id,
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(member)
    await db.flush()
    await db.refresh(member)
    await db.commit()
    return member


@router.patch("/household/members/{member_id}", response_model=UserResponse)
async def update_household_member(
    member_id: uuid.UUID,
    payload: HouseholdMemberUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a household member's info (owner only)."""
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Only household owners can edit members")

    result = await db.execute(
        select(User).where(User.id == member_id, User.household_id == user.household_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(member, field, value)

    member.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/household/members/{member_id}", status_code=204)
async def remove_household_member(
    member_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from the household (owner only, cannot remove self)."""
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Only household owners can remove members")

    if member_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from the household")

    result = await db.execute(
        select(User).where(User.id == member_id, User.household_id == user.household_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    await db.delete(member)
    await db.commit()
