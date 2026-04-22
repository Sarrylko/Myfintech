"""add country to tenants

Revision ID: zz3cc4dd5ee6
Revises: zz2bb3cc4dd5
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa

revision = "zz3cc4dd5ee6"
down_revision = "zz2bb3cc4dd5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("country", sa.String(2), nullable=False, server_default="US"),
    )


def downgrade() -> None:
    op.drop_column("tenants", "country")
