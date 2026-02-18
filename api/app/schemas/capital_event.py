import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CapitalEventCreate(BaseModel):
    event_date: date
    event_type: str = "other"  # acquisition | additional_investment | refi_proceeds | sale | other
    amount: Decimal  # signed: negative = cash out, positive = cash in
    description: str | None = None
    notes: str | None = None


class CapitalEventUpdate(BaseModel):
    event_date: date | None = None
    event_type: str | None = None
    amount: Decimal | None = None
    description: str | None = None
    notes: str | None = None


class CapitalEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    event_date: date
    event_type: str
    amount: Decimal
    description: str | None
    notes: str | None
    created_at: datetime
