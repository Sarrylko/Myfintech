"""add refresh_interval_hours to plaid_items and snaptrade_connections

Revision ID: ac3cd4de5ef6
Revises: ab2bc3cd4de5
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa

revision = "ac3cd4de5ef6"
down_revision = "ab2bc3cd4de5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plaid_items",
        sa.Column("refresh_interval_hours", sa.Integer(), nullable=False, server_default="24"),
    )
    op.add_column(
        "snaptrade_connections",
        sa.Column("refresh_interval_hours", sa.Integer(), nullable=False, server_default="24"),
    )


def downgrade() -> None:
    op.drop_column("plaid_items", "refresh_interval_hours")
    op.drop_column("snaptrade_connections", "refresh_interval_hours")
