"""add retirement_account_ids to retirement_profiles

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "u5v6w7x8y9z0"
down_revision = "t4u5v6w7x8y9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "retirement_profiles",
        sa.Column("retirement_account_ids", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("retirement_profiles", "retirement_account_ids")
