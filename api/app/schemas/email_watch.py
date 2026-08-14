import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EntityEmailWatchCreate(BaseModel):
    gmail_address: str
    sender_allowlist: list[str] = []
    notif_phone_override: str | None = None
    is_active: bool = True


class EntityEmailWatchUpdate(BaseModel):
    gmail_address: str | None = None
    sender_allowlist: list[str] | None = None
    notif_phone_override: str | None = None
    is_active: bool | None = None


class EntityEmailWatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    entity_id: uuid.UUID
    gmail_address: str
    sender_allowlist: list[str]
    notif_phone_override: str | None
    is_active: bool
    last_checked_at: datetime | None
    created_at: datetime


