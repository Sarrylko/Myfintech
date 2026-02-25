import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

BUSINESS_DOC_CATEGORIES = [
    "ein_certificate",
    "operating_agreement",
    "articles_of_organization",
    "bylaws",
    "annual_report",
    "tax_return",
    "bank_statement",
    "legal_agreement",
    "shareholder_agreement",
    "insurance",
    "other",
]

BUSINESS_DOC_CATEGORY_LABELS: dict[str, str] = {
    "ein_certificate": "EIN Certificate",
    "operating_agreement": "Operating Agreement",
    "articles_of_organization": "Articles of Organization",
    "bylaws": "Bylaws",
    "annual_report": "Annual Report",
    "tax_return": "Tax Return",
    "bank_statement": "Bank Statement",
    "legal_agreement": "Legal Agreement",
    "shareholder_agreement": "Shareholder Agreement",
    "insurance": "Insurance",
    "other": "Other",
}


class BusinessDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entity_id: uuid.UUID
    filename: str
    file_size: int
    content_type: str
    category: str | None
    description: str | None
    uploaded_at: datetime
