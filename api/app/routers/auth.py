from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.redis import (
    blacklist_token,
    clear_login_failures,
    is_blacklisted,
    is_locked_out,
    record_login_failure,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import Household, User
from app.schemas.user import UserCreate, UserLogin, UserResponse

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/auth", tags=["auth"])

# httpOnly cookie settings — strict+secure in production, lax in dev for cross-port localhost
_SECURE = settings.environment != "development"
_SAMESITE = "strict" if settings.environment != "development" else "lax"


def _set_auth_cookies(response: Response, user_id: str) -> None:
    response.set_cookie(
        key="access_token",
        value=create_access_token({"sub": user_id}),
        httponly=True,
        secure=_SECURE,
        samesite=_SAMESITE,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=create_refresh_token({"sub": user_id}),
        httponly=True,
        secure=_SECURE,
        samesite=_SAMESITE,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )


@router.post("/register", response_model=UserResponse, status_code=201)
@limiter.limit("5/hour")
async def register(request: Request, payload: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    household = Household(name=payload.household_name or f"{payload.full_name}'s Household")
    db.add(household)
    await db.flush()

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role="owner",
        household_id=household.id,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.post("/login", response_model=UserResponse)
@limiter.limit("10/minute;30/hour")
async def login(
    request: Request,
    payload: UserLogin,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    # Lockout check before hitting the DB — avoids timing oracle
    if await is_locked_out(payload.email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Account temporarily locked due to too many failed attempts. Try again in 15 minutes.",
        )

    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.hashed_password):
        # Always record a failure (even for unknown emails — prevents user enumeration via timing)
        await record_login_failure(payload.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    await clear_login_failures(payload.email)
    _set_auth_cookies(response, str(user.id))
    return user


@router.post("/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    refresh = request.cookies.get("refresh_token")
    if not refresh:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token",
        )

    token_data = decode_token(refresh)
    if token_data is None or token_data.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    jti = token_data.get("jti")
    if jti and await is_blacklisted(jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    user_id = token_data.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Blacklist the old refresh token before issuing new cookies (token rotation)
    if jti:
        exp = token_data.get("exp", 0)
        ttl = max(0, int(exp - datetime.now(timezone.utc).timestamp()))
        await blacklist_token(jti, ttl)

    _set_auth_cookies(response, str(user.id))
    return {"ok": True}


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response):
    refresh = request.cookies.get("refresh_token")
    if refresh:
        token_data = decode_token(refresh)
        if token_data:
            jti = token_data.get("jti")
            exp = token_data.get("exp", 0)
            if jti:
                ttl = max(0, int(exp - datetime.now(timezone.utc).timestamp()))
                await blacklist_token(jti, ttl)

    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user
