"""add notification prefs

Revision ID: e9f0a1b2c3d4
Revises: d3e4f5a6b7c2
Create Date: 2026-03-02 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "e9f0a1b2c3d4"
down_revision = "d3e4f5a6b7c2"
branch_labels = None
depends_on = None

_COLS = [
    "notif_daily_summary",
    "notif_budget_alerts",
    "notif_bill_reminders",
    "notif_monthly_report",
    "notif_transaction_alerts",
]


def upgrade() -> None:
    for col in _COLS:
        op.add_column(
            "users",
            sa.Column(col, sa.Boolean(), nullable=False, server_default="true"),
        )


def downgrade() -> None:
    for col in reversed(_COLS):
        op.drop_column("users", col)
