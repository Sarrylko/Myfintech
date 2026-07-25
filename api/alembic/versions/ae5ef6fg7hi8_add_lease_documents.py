"""add_lease_documents

Revision ID: ae5ef6fg7hi8
Revises: ad4de5ef6fg7
Create Date: 2026-07-10

Add lease_documents table for storing lease-level file attachments
(signed lease, addenda, move-in checklist, etc.).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ae5ef6fg7hi8"
down_revision = "ad4de5ef6fg7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lease_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lease_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("stored_filename", sa.Text(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lease_id"], ["leases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lease_documents_lease_id", "lease_documents", ["lease_id"])
    op.create_index("ix_lease_documents_household_id", "lease_documents", ["household_id"])


def downgrade() -> None:
    op.drop_index("ix_lease_documents_household_id", table_name="lease_documents")
    op.drop_index("ix_lease_documents_lease_id", table_name="lease_documents")
    op.drop_table("lease_documents")
