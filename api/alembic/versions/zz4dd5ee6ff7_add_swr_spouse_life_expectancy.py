"""add safe_withdrawal_rate and spouse_life_expectancy_age to retirement_profiles

Revision ID: zz4dd5ee6ff7
Revises: zz3cc4dd5ee6
Create Date: 2026-04-23

"""
from alembic import op
import sqlalchemy as sa

revision = "zz4dd5ee6ff7"
down_revision = "zz3cc4dd5ee6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "retirement_profiles",
        sa.Column("safe_withdrawal_rate", sa.Numeric(5, 4), nullable=False, server_default="0.04"),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("spouse_life_expectancy_age", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("retirement_profiles", "safe_withdrawal_rate")
    op.drop_column("retirement_profiles", "spouse_life_expectancy_age")
