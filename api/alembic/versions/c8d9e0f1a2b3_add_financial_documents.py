"""add_financial_documents

Revision ID: c8d9e0f1a2b3
Revises: b6c7d8e9f0a1
Create Date: 2026-02-23

Add financial_documents table — a household-scoped vault for all financial files:
tax forms (W-2, 1099s, 1098, 1040), investment statements, retirement docs,
insurance policies, estate documents, and more. Designed for Phase 2 Ollama
vision-model analysis and financial planning.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c8d9e0f1a2b3"
down_revision = "b6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "financial_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("document_type", sa.String(20), nullable=False, server_default="other"),
        sa.Column("category", sa.String(30), nullable=False, server_default="other"),
        sa.Column("reference_year", sa.Integer(), nullable=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("stored_filename", sa.Text(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_financial_documents_household_id", "financial_documents", ["household_id"])
    op.create_index("ix_financial_documents_owner_user_id", "financial_documents", ["owner_user_id"])
    op.create_index("ix_financial_documents_document_type", "financial_documents", ["document_type"])
    op.create_index("ix_financial_documents_reference_year", "financial_documents", ["reference_year"])


def downgrade() -> None:
    op.drop_index("ix_financial_documents_reference_year", table_name="financial_documents")
    op.drop_index("ix_financial_documents_document_type", table_name="financial_documents")
    op.drop_index("ix_financial_documents_owner_user_id", table_name="financial_documents")
    op.drop_index("ix_financial_documents_household_id", table_name="financial_documents")
    op.drop_table("financial_documents")
