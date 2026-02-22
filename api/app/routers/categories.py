import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Category
from app.models.user import User
from app.schemas.account import CategoryCreate, CategoryResponse

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("/", response_model=list[CategoryResponse])
async def list_categories(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Category)
        .where(Category.household_id == user.household_id)
        .order_by(Category.name)
    )
    return result.scalars().all()


@router.post("/", response_model=CategoryResponse, status_code=201)
async def create_category(
    payload: CategoryCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    category = Category(
        household_id=user.household_id,
        name=payload.name,
        icon=payload.icon,
        color=payload.color,
        parent_id=payload.parent_id,
        is_income=payload.is_income,
    )
    db.add(category)
    await db.flush()
    await db.refresh(category)
    return category


_DEFAULT_EXPENSE_CATEGORIES: list[dict[str, Any]] = [
    {"name": "Housing",        "icon": "🏠", "color": "#6366f1"},
    {"name": "Food & Dining",  "icon": "🍔", "color": "#f59e0b"},
    {"name": "Transportation", "icon": "🚗", "color": "#3b82f6"},
    {"name": "Shopping",       "icon": "🛍️", "color": "#ec4899"},
    {"name": "Entertainment",  "icon": "🎬", "color": "#8b5cf6"},
    {"name": "Healthcare",     "icon": "🏥", "color": "#10b981"},
    {"name": "Utilities",      "icon": "⚡", "color": "#f97316"},
    {"name": "Subscriptions",  "icon": "📱", "color": "#06b6d4"},
    {"name": "Education",      "icon": "📚", "color": "#84cc16"},
    {"name": "Personal Care",  "icon": "💇", "color": "#f43f5e"},
    {"name": "Savings",        "icon": "💰", "color": "#14b8a6"},
    {"name": "Insurance",      "icon": "🛡️", "color": "#64748b"},
    {"name": "Travel",         "icon": "✈️", "color": "#0ea5e9"},
    {"name": "Gifts & Charity","icon": "🎁", "color": "#a855f7"},
    {"name": "Pets",           "icon": "🐾", "color": "#78716c"},
]

_DEFAULT_INCOME_CATEGORIES: list[dict[str, Any]] = [
    {"name": "Salary",           "icon": "💼", "color": "#10b981", "is_income": True},
    {"name": "Freelance",        "icon": "💻", "color": "#3b82f6", "is_income": True},
    {"name": "Investment Income","icon": "📈", "color": "#8b5cf6", "is_income": True},
    {"name": "Rental Income",    "icon": "🏘️", "color": "#f59e0b", "is_income": True},
    {"name": "Other Income",     "icon": "💵", "color": "#64748b", "is_income": True},
]


@router.post("/seed-defaults", response_model=list[CategoryResponse], status_code=201)
async def seed_default_categories(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create common default categories for the household. Skips any that already exist by name."""
    existing_result = await db.execute(
        select(Category.name).where(Category.household_id == user.household_id)
    )
    existing_names = {row[0].lower() for row in existing_result.fetchall()}

    created = []
    all_defaults = [
        {**d, "is_income": False} for d in _DEFAULT_EXPENSE_CATEGORIES
    ] + _DEFAULT_INCOME_CATEGORIES

    for defaults in all_defaults:
        if defaults["name"].lower() in existing_names:
            continue
        cat = Category(
            household_id=user.household_id,
            name=defaults["name"],
            icon=defaults.get("icon"),
            color=defaults.get("color"),
            is_income=defaults.get("is_income", False),
        )
        db.add(cat)
        await db.flush()
        await db.refresh(cat)
        created.append(cat)

    return created


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            Category.household_id == user.household_id,
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.delete(category)
