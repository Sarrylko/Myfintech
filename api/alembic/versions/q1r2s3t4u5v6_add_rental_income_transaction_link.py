"""add_rental_income_transaction_link

Revision ID: q1r2s3t4u5v6
Revises: p1q2r3s4t5u6
Create Date: 2026-03-27

Adds is_rental_income to categories and transaction_id to payments,
enabling rental income transactions to be linked directly to lease payments.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "q1r2s3t4u5v6"
down_revision = "p1q2r3s4t5u6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── categories: is_rental_income flag ────────────────────────────────────
    op.add_column(
        "categories",
        sa.Column("is_rental_income", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.execute(
        "UPDATE categories SET is_rental_income = true WHERE lower(name) = 'rental income'"
    )

    # ── payments: link to source transaction ─────────────────────────────────
    op.add_column(
        "payments",
        sa.Column(
            "transaction_id",
            UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_payments_transaction_id", "payments", ["transaction_id"])


def downgrade() -> None:
    op.drop_index("ix_payments_transaction_id", table_name="payments")
    op.drop_column("payments", "transaction_id")
    op.drop_column("categories", "is_rental_income")
