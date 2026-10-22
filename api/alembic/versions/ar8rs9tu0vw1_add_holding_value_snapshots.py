"""add holding_value_snapshots

Revision ID: ar8rs9tu0vw1
Revises: aq7qr8st9uv0
Create Date: 2026-10-22

investment_value_snapshots records each account's daily value but not what
it held, so allocation over time can't be rebuilt from it. This table stores
each holding's value daily with its ticker, name and asset_class, the inputs
the frontend classifies allocation buckets from. A day's rows are replaced
as a set, since SnapTrade re-creates holdings (new ids) on every sync.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "ar8rs9tu0vw1"
down_revision = "aq7qr8st9uv0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "holding_value_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("ticker_symbol", sa.String(20), nullable=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("asset_class", sa.String(20), nullable=True),
        sa.Column("quantity", sa.Numeric(18, 8), nullable=False),
        sa.Column("market_value", sa.Numeric(14, 2), nullable=False),
        sa.Column("cost_basis", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_holding_value_snapshots_household_id", "holding_value_snapshots", ["household_id"])
    op.create_index("ix_holding_value_snapshots_account_id", "holding_value_snapshots", ["account_id"])
    op.create_index("ix_holding_value_snapshots_snapshot_date", "holding_value_snapshots", ["snapshot_date"])


def downgrade() -> None:
    op.drop_table("holding_value_snapshots")
