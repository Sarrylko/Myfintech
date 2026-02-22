"""add_budget_types

Revision ID: c1d2e3f4a5b6
Revises: b4c5d6e7f8a9
Create Date: 2026-02-22 00:00:00.000000
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make month nullable (not needed for annual/quarterly/custom budgets)
    op.alter_column("budgets", "month", nullable=True)

    # Add budget_type column (monthly is the default for backward compat)
    op.add_column(
        "budgets",
        sa.Column(
            "budget_type",
            sa.String(10),
            nullable=False,
            server_default="monthly",
        ),
    )

    # Add date range columns for non-monthly budget types
    op.add_column(
        "budgets",
        sa.Column("start_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "budgets",
        sa.Column("end_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("budgets", "end_date")
    op.drop_column("budgets", "start_date")
    op.drop_column("budgets", "budget_type")
    op.alter_column("budgets", "month", nullable=False)
