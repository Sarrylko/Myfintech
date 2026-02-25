"""add_extracted_text

Revision ID: d1e2f3a4b5c6
Revises: c8d9e0f1a2b3
Create Date: 2026-02-24

Add extracted_text TEXT NULL to financial_documents and property_documents.
Text is extracted from PDFs at upload / inbox-import time so the Phase 2
Ollama LLM agent can read text directly instead of running vision inference
on every document (10x faster for digital PDFs; scanned docs stay NULL and
fall back to vision).
"""
from alembic import op
import sqlalchemy as sa

revision = "d1e2f3a4b5c6"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "financial_documents",
        sa.Column("extracted_text", sa.Text(), nullable=True),
    )
    op.add_column(
        "property_documents",
        sa.Column("extracted_text", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("property_documents", "extracted_text")
    op.drop_column("financial_documents", "extracted_text")
