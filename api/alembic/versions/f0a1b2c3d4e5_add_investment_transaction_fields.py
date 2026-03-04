"""add_investment_transaction_fields

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-03-03 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "f0a1b2c3d4e5"
down_revision = "e9f0a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "investment_transactions",
        sa.Column("fees", sa.Numeric(precision=14, scale=4), nullable=True),
    )
    op.add_column(
        "investment_transactions",
        sa.Column(
            "currency_code",
            sa.String(length=3),
            nullable=False,
            server_default="USD",
        ),
    )


def downgrade() -> None:
    op.drop_column("investment_transactions", "currency_code")
    op.drop_column("investment_transactions", "fees")
