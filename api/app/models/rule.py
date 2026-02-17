import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CategorizationRule(Base):
    __tablename__ = "categorization_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id"), index=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True
    )
    # String-based category matching plaid_category field (e.g. "Food & Dining > Groceries")
    category_string: Mapped[str | None] = mapped_column(String(255), nullable=True)
    match_field: Mapped[str] = mapped_column(String(50))  # name, merchant_name, account_type
    match_type: Mapped[str] = mapped_column(String(20))   # contains, exact
    match_value: Mapped[str] = mapped_column(String(500))
    negate_amount: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
