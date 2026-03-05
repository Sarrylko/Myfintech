"""add country and currency to assets

Revision ID: l1m2n3o4p5q6
Revises: k1l2m3n4o5p6
Create Date: 2026-03-05 09:05:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "l1m2n3o4p5q6"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Properties — country + currency
    op.add_column(
        "properties",
        sa.Column("country", sa.String(2), nullable=False, server_default="US"),
    )
    op.add_column(
        "properties",
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
    )

    # Insurance policies — currency
    op.add_column(
        "insurance_policies",
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
    )

    # Budgets — currency
    op.add_column(
        "budgets",
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
    )

    # Leases — currency
    op.add_column(
        "leases",
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
    )

    # Retirement profiles — currency
    op.add_column(
        "retirement_profiles",
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="USD"),
    )


def downgrade() -> None:
    op.drop_column("retirement_profiles", "currency_code")
    op.drop_column("leases", "currency_code")
    op.drop_column("budgets", "currency_code")
    op.drop_column("insurance_policies", "currency_code")
    op.drop_column("properties", "currency_code")
    op.drop_column("properties", "country")
