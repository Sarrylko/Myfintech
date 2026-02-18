"""add_property_closing_costs

Revision ID: e7f2a1b3c9d4
Revises: ac1826cd7110
Create Date: 2026-02-18 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7f2a1b3c9d4"
down_revision: Union[str, None] = "ac1826cd7110"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "properties",
        sa.Column("closing_costs", sa.Numeric(14, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("properties", "closing_costs")
