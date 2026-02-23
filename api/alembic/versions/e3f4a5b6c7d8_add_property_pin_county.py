"""add_property_pin_county

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-02-22

Add Property Index Number (PIN) and County to the properties table.
"""
from alembic import op
import sqlalchemy as sa

revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("pin", sa.Text(), nullable=True))
    op.add_column("properties", sa.Column("county", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("properties", "county")
    op.drop_column("properties", "pin")
