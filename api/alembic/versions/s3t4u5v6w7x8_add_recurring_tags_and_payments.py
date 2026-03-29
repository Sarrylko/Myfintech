"""add recurring tags and payments

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "s3t4u5v6w7x8"
down_revision = "r2s3t4u5v6w7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to recurring_transactions
    op.add_column("recurring_transactions", sa.Column("tag", sa.String(30), nullable=False, server_default="other"))
    op.add_column("recurring_transactions", sa.Column("spending_type", sa.String(10), nullable=False, server_default="want"))
    op.add_column("recurring_transactions", sa.Column("next_due_date", sa.Date(), nullable=True))
    op.add_column("recurring_transactions", sa.Column("start_date", sa.Date(), nullable=True))

    # Create recurring_payments table
    op.create_table(
        "recurring_payments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("recurring_id", UUID(as_uuid=True), sa.ForeignKey("recurring_transactions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("household_id", UUID(as_uuid=True), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("paid_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("transaction_id", UUID(as_uuid=True), sa.ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_recurring_payments_recurring_id", "recurring_payments", ["recurring_id"])
    op.create_index("ix_recurring_payments_household_id", "recurring_payments", ["household_id"])


def downgrade() -> None:
    op.drop_table("recurring_payments")
    op.drop_column("recurring_transactions", "start_date")
    op.drop_column("recurring_transactions", "next_due_date")
    op.drop_column("recurring_transactions", "spending_type")
    op.drop_column("recurring_transactions", "tag")
