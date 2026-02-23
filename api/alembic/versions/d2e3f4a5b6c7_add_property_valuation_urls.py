"""add_property_valuation_urls

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-02-22

Add zillow_url and redfin_url to properties table so users can store
direct links to each property's Zillow/Redfin listing page.
"""
from alembic import op
import sqlalchemy as sa

revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("zillow_url", sa.Text(), nullable=True))
    op.add_column("properties", sa.Column("redfin_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("properties", "redfin_url")
    op.drop_column("properties", "zillow_url")
