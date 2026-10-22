"""add investment_value_snapshots

Revision ID: ap6pq7rs8tu9
Revises: ao5op6qr7st8
Create Date: 2026-10-21

net_worth_snapshots keeps a single household-wide investments total, which
can't be split by account or owner. This table stores each investment
account's value and cost basis daily, the history that contributions vs.
market growth and time-weighted returns are computed from.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "ap6pq7rs8tu9"
down_revision = "ao5op6qr7st8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "investment_value_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("market_value", sa.Numeric(14, 2), nullable=False),
        sa.Column("cost_basis", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "snapshot_date", name="uq_investment_value_snapshots_account_date"),
    )
    op.create_index("ix_investment_value_snapshots_household_id", "investment_value_snapshots", ["household_id"])
    op.create_index("ix_investment_value_snapshots_account_id", "investment_value_snapshots", ["account_id"])
    op.create_index("ix_investment_value_snapshots_snapshot_date", "investment_value_snapshots", ["snapshot_date"])


def downgrade() -> None:
    op.drop_table("investment_value_snapshots")
