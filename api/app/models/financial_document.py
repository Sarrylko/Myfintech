import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FinancialDocument(Base):
    __tablename__ = "financial_documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    household_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # ── Classification ─────────────────────────────────────────────────────────
    document_type: Mapped[str] = mapped_column(
        String(20), default="other", index=True
    )  # tax | investment | retirement | insurance | banking | income | estate | other
    category: Mapped[str] = mapped_column(
        String(30), default="other"
    )  # see full taxonomy in schemas/financial_document.py
    reference_year: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )  # tax/fiscal year — None for timeless docs (wills, insurance policies)
    # ── File Storage ───────────────────────────────────────────────────────────
    filename: Mapped[str] = mapped_column(String(255))        # original user-facing name
    stored_filename: Mapped[str] = mapped_column(Text)        # {uuid}_{filename} on disk
    file_size: Mapped[int] = mapped_column(Integer)           # bytes
    content_type: Mapped[str] = mapped_column(String(100))    # MIME type
    # ── Metadata ───────────────────────────────────────────────────────────────
    description: Mapped[str | None] = mapped_column(Text)     # e.g. "Employer: Acme Corp"
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
