"""add_is_escrowed_to_property_costs

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-02-23

Add is_escrowed flag to property_costs so that insurance and property tax
amounts can be recorded even when paid via mortgage escrow. Escrowed costs
are excluded from the monthly cost total but retained for tax reporting.
"""
from alembic import op
import sqlalchemy as sa

revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "property_costs",
        sa.Column(
            "is_escrowed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("property_costs", "is_escrowed")
