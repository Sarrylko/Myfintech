import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import hash_password, verify_password
from sqlalchemy.orm import selectinload

from app.models.user import Household, HouseholdCountryProfile, User
from app.schemas.user import (
    ActiveCountryUpdate,
    CountryProfile,
    CountryProfileCreate,
    HouseholdMemberCreate,
    HouseholdMemberUpdate,
    HouseholdSettings,
    HouseholdSettingsUpdate,
    NotificationPreferences,
    UserPasswordChange,
    UserProfileUpdate,
    UserResponse,
    _validate_password,
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

    try:
        _validate_password(payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    user.hashed_password = hash_password(payload.new_password)
    user.updated_at = datetime.now(timezone.utc)
    await db.commit()


# ─── Notification preferences ─────────────────────────────────────────────────

@router.get("/me/notification-preferences", response_model=NotificationPreferences)
async def get_notification_prefs(user: User = Depends(get_current_user)):
    return NotificationPreferences(
        daily_summary=user.notif_daily_summary,
        budget_alerts=user.notif_budget_alerts,
        bill_reminders=user.notif_bill_reminders,
        monthly_report=user.notif_monthly_report,
        transaction_alerts=user.notif_transaction_alerts,
    )


@router.patch("/me/notification-preferences", response_model=NotificationPreferences)
async def update_notification_prefs(
    payload: NotificationPreferences,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user.notif_daily_summary = payload.daily_summary
    user.notif_budget_alerts = payload.budget_alerts
    user.notif_bill_reminders = payload.bill_reminders
    user.notif_monthly_report = payload.monthly_report
    user.notif_transaction_alerts = payload.transaction_alerts
    user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return NotificationPreferences(
        daily_summary=user.notif_daily_summary,
        budget_alerts=user.notif_budget_alerts,
        bill_reminders=user.notif_bill_reminders,
        monthly_report=user.notif_monthly_report,
        transaction_alerts=user.notif_transaction_alerts,
    )


# ─── Household locale / currency settings ─────────────────────────────────────

async def _load_household_settings(household: Household) -> HouseholdSettings:
    """Build HouseholdSettings from a household with country_profiles loaded."""
    profiles = [CountryProfile.model_validate(p) for p in household.country_profiles]
    # Derive active locale/currency from active country profile; fall back to household defaults
    active = next((p for p in profiles if p.country_code == household.active_country_code), None)
    return HouseholdSettings(
        default_currency=active.currency_code if active else household.default_currency,
        default_locale=active.locale if active else household.default_locale,
        country_code=household.country_code,
        active_country_code=household.active_country_code,
        country_profiles=profiles,
    )


@router.get("/household/settings", response_model=HouseholdSettings)
async def get_household_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return locale and currency preferences for the household."""
    result = await db.execute(
        select(Household)
        .options(selectinload(Household.country_profiles))
        .where(Household.id == user.household_id)
    )
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    return await _load_household_settings(household)


@router.patch("/household/settings", response_model=HouseholdSettings)
async def update_household_settings(
    payload: HouseholdSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update locale and currency preferences (owner only)."""
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Only household owners can change locale settings")
    result = await db.execute(
        select(Household)
        .options(selectinload(Household.country_profiles))
        .where(Household.id == user.household_id)
    )
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(household, field, value)
    await db.commit()
    await db.refresh(household)
    await db.execute(
        select(Household)
        .options(selectinload(Household.country_profiles))
        .where(Household.id == household.id)
    )
    result2 = await db.execute(
        select(Household)
        .options(selectinload(Household.country_profiles))
        .where(Household.id == household.id)
    )
    household = result2.scalar_one()
    return await _load_household_settings(household)


@router.patch("/household/active-country", response_model=HouseholdSettings)
async def switch_active_country(
    payload: ActiveCountryUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Switch the household's active country context (any member can toggle)."""
    result = await db.execute(
        select(Household)
        .options(selectinload(Household.country_profiles))
        .where(Household.id == user.household_id)
    )
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    # Validate that this country profile exists for the household
    valid_codes = {p.country_code for p in household.country_profiles}
    if payload.country_code not in valid_codes:
        raise HTTPException(status_code=400, detail=f"Country '{payload.country_code}' is not configured for this household")
    household.active_country_code = payload.country_code
    await db.commit()
    result2 = await db.execute(
        select(Household)
        .options(selectinload(Household.country_profiles))
        .where(Household.id == household.id)
    )
    household = result2.scalar_one()
    return await _load_household_settings(household)


@router.get("/household/country-profiles", response_model=list[CountryProfile])
async def list_country_profiles(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all country profiles for the household."""
    result = await db.execute(
        select(HouseholdCountryProfile)
        .where(HouseholdCountryProfile.household_id == user.household_id)
        .order_by(HouseholdCountryProfile.display_order)
    )
    return result.scalars().all()


@router.post("/household/country-profiles", response_model=CountryProfile, status_code=201)
async def add_country_profile(
    payload: CountryProfileCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a new country profile to the household (owner only)."""
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Only household owners can add country profiles")
    existing = await db.execute(
        select(HouseholdCountryProfile).where(
            HouseholdCountryProfile.household_id == user.household_id,
            HouseholdCountryProfile.country_code == payload.country_code,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Country profile already exists")
    profile = HouseholdCountryProfile(
        household_id=user.household_id,
        **payload.model_dump(),
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return CountryProfile.model_validate(profile)


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
