import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict

ENTITY_TYPES = Literal["llc", "s_corp", "c_corp", "trust", "partnership", "sole_prop"]
ACCOUNT_SCOPES = Literal["personal", "business"]


# ── Business Entity ────────────────────────────────────────────────────────────

class BusinessEntityCreate(BaseModel):
    name: str
    entity_type: ENTITY_TYPES
    parent_id: uuid.UUID | None = None
    state_of_formation: str | None = None  # 2-char state code
    ein: str | None = None
    description: str | None = None
    is_active: bool = True


class BusinessEntityUpdate(BaseModel):
    name: str | None = None
    entity_type: ENTITY_TYPES | None = None
    parent_id: uuid.UUID | None = None
    state_of_formation: str | None = None
    ein: str | None = None
    description: str | None = None
    is_active: bool | None = None


class BusinessEntityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    entity_type: str
    state_of_formation: str | None
    ein: str | None
    description: str | None
    is_active: bool
    created_at: datetime


class BusinessEntityTree(BusinessEntityResponse):
    """Entity with nested children for hierarchy display."""
    children: list["BusinessEntityTree"] = []

BusinessEntityTree.model_rebuild()


# ── Entity Ownership ───────────────────────────────────────────────────────────

class EntityOwnershipCreate(BaseModel):
    owner_user_id: uuid.UUID | None = None
    owner_entity_id: uuid.UUID | None = None
    ownership_pct: Decimal


class EntityOwnershipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entity_id: uuid.UUID
    owner_user_id: uuid.UUID | None
    owner_entity_id: uuid.UUID | None
    ownership_pct: Decimal
    created_at: datetime

    # Resolved display names (populated in router, not from ORM)
    owner_name: str | None = None


# ── Entity Detail (single entity with linked data) ────────────────────────────

class LinkedPropertySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    address: str
    city: str | None
    state: str | None
    current_value: Decimal | None


class LinkedAccountSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: str
    institution_name: str | None
    current_balance: Decimal | None
    account_scope: str


class BusinessEntityDetail(BusinessEntityResponse):
    ownership: list[EntityOwnershipResponse] = []
    properties: list[LinkedPropertySummary] = []
    accounts: list[LinkedAccountSummary] = []
    children: list[BusinessEntityResponse] = []
