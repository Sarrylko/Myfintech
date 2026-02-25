"""add_business_documents

Revision ID: c2d3e4f5a6b1
Revises: b1c2d3e4f5a6
Create Date: 2026-02-24 13:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "c2d3e4f5a6b1"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "business_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "entity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "household_id",
            UUID(as_uuid=True),
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("stored_filename", sa.Text, nullable=False),
        sa.Column("file_size", sa.Integer, nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("extracted_text", sa.Text, nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_business_documents_entity_id", "business_documents", ["entity_id"])
    op.create_index("ix_business_documents_household_id", "business_documents", ["household_id"])


def downgrade() -> None:
    op.drop_index("ix_business_documents_household_id", table_name="business_documents")
    op.drop_index("ix_business_documents_entity_id", table_name="business_documents")
    op.drop_table("business_documents")
