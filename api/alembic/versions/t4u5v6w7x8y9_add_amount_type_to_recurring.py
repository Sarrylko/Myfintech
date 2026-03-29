"""add amount_type to recurring_transactions

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "t4u5v6w7x8y9"
down_revision = "s3t4u5v6w7x8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recurring_transactions",
        sa.Column(
            "amount_type",
            sa.String(10),
            nullable=False,
            server_default="fixed",
        ),
    )


def downgrade() -> None:
    op.drop_column("recurring_transactions", "amount_type")
