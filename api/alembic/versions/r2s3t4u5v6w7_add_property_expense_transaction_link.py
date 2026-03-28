"""add_property_expense_transaction_link

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-03-27

Adds is_property_expense to categories and transaction_id to maintenance_expenses,
enabling property/business expense transactions to be excluded from personal totals
and linked to specific property maintenance records.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "r2s3t4u5v6w7"
down_revision = "q1r2s3t4u5v6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── categories: is_property_expense flag ─────────────────────────────────
    op.add_column(
        "categories",
        sa.Column("is_property_expense", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.execute(
        """
        UPDATE categories SET is_property_expense = true
        WHERE lower(name) IN (
            'property tax', 'hoa', 'rental maintenance', 'property insurance',
            'property utilities', 'rental utilities', 'rental insurance', 'maintenance'
        )
        """
    )

    # ── maintenance_expenses: link to source transaction ─────────────────────
    op.add_column(
        "maintenance_expenses",
        sa.Column(
            "transaction_id",
            UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_maintenance_expenses_transaction_id",
        "maintenance_expenses",
        ["transaction_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_maintenance_expenses_transaction_id", table_name="maintenance_expenses")
    op.drop_column("maintenance_expenses", "transaction_id")
    op.drop_column("categories", "is_property_expense")
