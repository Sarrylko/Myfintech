"""add_crypto_to_holdings

Revision ID: n1o2p3q4r5s6
Revises: m1n2o3p4q5r6
Create Date: 2026-03-17

Adds two nullable columns to the holdings table to support cryptocurrency assets:
  - asset_class: discriminator ("crypto" for crypto holdings, NULL = stock/ETF)
  - coingecko_id: CoinGecko coin ID used for live price fetching (e.g. "bitcoin")
"""
from alembic import op
import sqlalchemy as sa

revision = "n1o2p3q4r5s6"
down_revision = "m1n2o3p4q5r6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("holdings", sa.Column("asset_class", sa.String(20), nullable=True))
    op.add_column("holdings", sa.Column("coingecko_id", sa.String(100), nullable=True))
    op.create_index("ix_holdings_asset_class", "holdings", ["asset_class"])


def downgrade():
    op.drop_index("ix_holdings_asset_class", table_name="holdings")
    op.drop_column("holdings", "coingecko_id")
    op.drop_column("holdings", "asset_class")
