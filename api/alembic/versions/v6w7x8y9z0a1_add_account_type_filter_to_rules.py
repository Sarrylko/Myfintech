"""add account_type_filter to categorization_rules

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-03-31

"""
from alembic import op
import sqlalchemy as sa

revision = "v6w7x8y9z0a1"
down_revision = "u5v6w7x8y9z0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "categorization_rules",
        sa.Column("account_type_filter", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("categorization_rules", "account_type_filter")
