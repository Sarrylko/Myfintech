import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PropertyDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    property_id: uuid.UUID
    filename: str
    file_size: int
    content_type: str
    category: str | None
    description: str | None
    uploaded_at: datetime
