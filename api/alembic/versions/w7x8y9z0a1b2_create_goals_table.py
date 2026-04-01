"""create goals table

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-04-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "w7x8y9z0a1b2"
down_revision = "v6w7x8y9z0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("household_id", UUID(as_uuid=True), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("goal_type", sa.String(20), nullable=False, server_default="savings"),
        sa.Column("target_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("current_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("linked_account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("linked_budget_id", UUID(as_uuid=True), sa.ForeignKey("budgets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_goals_household_id", "goals", ["household_id"])
    op.create_index("ix_goals_linked_account_id", "goals", ["linked_account_id"])
    op.create_index("ix_goals_linked_budget_id", "goals", ["linked_budget_id"])


def downgrade() -> None:
    op.drop_table("goals")
