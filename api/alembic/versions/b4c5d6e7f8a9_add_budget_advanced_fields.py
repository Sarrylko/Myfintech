"""add_budget_advanced_fields

Revision ID: b4c5d6e7f8a9
Revises: a2b3c4d5e6f7
Create Date: 2026-02-21 00:00:00.000000
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "budgets",
        sa.Column(
            "rollover_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "budgets",
        sa.Column(
            "alert_threshold",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("80"),
        ),
    )


def downgrade() -> None:
    op.drop_column("budgets", "alert_threshold")
    op.drop_column("budgets", "rollover_enabled")
