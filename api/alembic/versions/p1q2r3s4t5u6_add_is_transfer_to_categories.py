"""add_is_transfer_to_categories

Revision ID: p1q2r3s4t5u6
Revises: o1p2q3r4s5t6
Create Date: 2026-03-27

Adds is_transfer boolean to categories table. Transfer-tagged categories
(credit card payments, internal account transfers) are excluded from
income and expense calculations to prevent double-counting.
"""

from alembic import op
import sqlalchemy as sa

revision = "p1q2r3s4t5u6"
down_revision = "o1p2q3r4s5t6"
branch_labels = None
depends_on = None

# Category names (case-insensitive) that represent transfers
_TRANSFER_NAMES = [
    "internal transfer",
    "credit card payment",
    "account transfer",
    "transfers in",
    "transfers out",
    "transfer",
    "transfers",
    "loan payment",
]


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("is_transfer", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Mark existing transfer-named categories
    op.execute(
        f"""
        UPDATE categories
        SET is_transfer = true
        WHERE lower(name) IN ({", ".join(f"'{n}'" for n in _TRANSFER_NAMES)})
        """
    )


def downgrade() -> None:
    op.drop_column("categories", "is_transfer")
