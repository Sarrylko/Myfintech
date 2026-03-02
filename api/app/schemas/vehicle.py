import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class VehicleCreate(BaseModel):
    make: str
    model: str
    year: int | None = None
    vin: str | None = None
    nickname: str | None = None
    color: str | None = None
    is_active: bool = True
    notes: str | None = None


class VehicleUpdate(BaseModel):
    make: str | None = None
    model: str | None = None
    year: int | None = None
    vin: str | None = None
    nickname: str | None = None
    color: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class VehicleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    make: str
    model: str
    year: int | None
    vin: str | None
    nickname: str | None
    color: str | None
    is_active: bool
    notes: str | None
    created_at: datetime
