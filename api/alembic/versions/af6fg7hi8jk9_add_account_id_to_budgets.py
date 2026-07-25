"""add_account_id_to_budgets

Revision ID: af6fg7hi8jk9
Revises: ae5ef6fg7hi8
Create Date: 2026-07-24

Add optional account_id to budgets so a budget can track its progress from a
dedicated account's balance (e.g. a sinking-fund brokerage account for
property tax) instead of transaction-category matching.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "af6fg7hi8jk9"
down_revision = "ae5ef6fg7hi8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "budgets",
        sa.Column("account_id", postgresql.UUID(as_uuid=True),
                   sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_budgets_account_id", "budgets", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_budgets_account_id", table_name="budgets")
    op.drop_column("budgets", "account_id")
