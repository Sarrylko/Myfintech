"""add_previous_close_to_holdings

Revision ID: o1p2q3r4s5t6
Revises: n1o2p3q4r5s6
Create Date: 2026-03-26

Adds previous_close column to holdings for daily P&L calculation.
"""

from alembic import op
import sqlalchemy as sa

revision = "o1p2q3r4s5t6"
down_revision = "n1o2p3q4r5s6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "holdings",
        sa.Column("previous_close", sa.Numeric(14, 4), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("holdings", "previous_close")
