import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

TRACKED_CATEGORIES = {"property_tax", "hoa", "insurance"}


class PropertyCostStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    year: int
    category: str
    is_paid: bool
    paid_date: date | None
    updated_at: datetime


class PropertyCostStatusUpsert(BaseModel):
    is_paid: bool
    paid_date: date | None = None
