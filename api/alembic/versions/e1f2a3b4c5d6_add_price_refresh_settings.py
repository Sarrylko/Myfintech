"""add_price_refresh_settings

Revision ID: e1f2a3b4c5d6
Revises: f6a7b8c9d0e1
Create Date: 2026-02-20 00:00:00.000000

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "households",
        sa.Column(
            "price_refresh_interval_minutes",
            sa.Integer(),
            nullable=False,
            server_default="15",
        ),
    )
    op.add_column(
        "households",
        sa.Column(
            "price_refresh_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )
    op.add_column(
        "households",
        sa.Column(
            "last_price_refresh_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("households", "last_price_refresh_at")
    op.drop_column("households", "price_refresh_enabled")
    op.drop_column("households", "price_refresh_interval_minutes")
