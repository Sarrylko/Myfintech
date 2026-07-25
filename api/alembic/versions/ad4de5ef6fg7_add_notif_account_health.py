"""add notif_account_health to users

Revision ID: ad4de5ef6fg7
Revises: ac3cd4de5ef6
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa

revision = "ad4de5ef6fg7"
down_revision = "ac3cd4de5ef6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("notif_account_health", sa.Boolean(), nullable=False, server_default="true"),
    )


def downgrade() -> None:
    op.drop_column("users", "notif_account_health")
