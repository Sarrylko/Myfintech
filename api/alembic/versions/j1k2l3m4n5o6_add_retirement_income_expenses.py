"""add retirement income and expenses

Revision ID: j1k2l3m4n5o6
Revises: i1j2k3l4m5n6
Create Date: 2026-03-04 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "j1k2l3m4n5o6"
down_revision = "i1j2k3l4m5n6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "retirement_profiles",
        sa.Column("yearly_income", sa.Numeric(14, 2), nullable=True),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("spouse_yearly_income", sa.Numeric(14, 2), nullable=True),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("monthly_essential_expenses", sa.Numeric(10, 2), nullable=True),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("monthly_non_essential_expenses", sa.Numeric(10, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("retirement_profiles", "monthly_non_essential_expenses")
    op.drop_column("retirement_profiles", "monthly_essential_expenses")
    op.drop_column("retirement_profiles", "spouse_yearly_income")
    op.drop_column("retirement_profiles", "yearly_income")
