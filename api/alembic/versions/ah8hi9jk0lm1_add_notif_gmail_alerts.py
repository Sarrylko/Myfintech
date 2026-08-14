"""add notif_gmail_alerts to users

Revision ID: ah8hi9jk0lm1
Revises: ag7gh8ij9kl0
Create Date: 2026-07-25
"""
from alembic import op
import sqlalchemy as sa

revision = "ah8hi9jk0lm1"
down_revision = "ag7gh8ij9kl0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("notif_gmail_alerts", sa.Boolean(), nullable=False, server_default="true"),
    )


def downgrade() -> None:
    op.drop_column("users", "notif_gmail_alerts")
