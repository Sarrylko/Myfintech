"""add_effective_date_to_property_costs

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-02-23

Add effective_date to property_costs so each cost entry records when that
rate/amount took effect. Supports tracking annual changes to property tax,
HOA fees, insurance premiums, etc. for accurate per-year tax calculations.
"""
from alembic import op
import sqlalchemy as sa

revision = "b6c7d8e9f0a1"
down_revision = "a5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "property_costs",
        sa.Column("effective_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("property_costs", "effective_date")
