"""add country to accounts

Revision ID: b2c3d4e5f6a7
Revises: z0a1b2c3d4e5
Create Date: 2026-04-22 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "zz1aa2bb3cc4"
down_revision = "z0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("country", sa.String(2), nullable=False, server_default="US"),
    )


def downgrade() -> None:
    op.drop_column("accounts", "country")
