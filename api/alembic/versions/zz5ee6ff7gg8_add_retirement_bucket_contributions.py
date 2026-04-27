"""add retirement bucket contributions

Revision ID: zz5ee6ff7gg8
Revises: zz4dd5ee6ff7
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = "zz5ee6ff7gg8"
down_revision = "zz4dd5ee6ff7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("retirement_profiles", sa.Column("annual_contribution_401k", sa.Numeric(14, 2), nullable=True, server_default="0"))
    op.add_column("retirement_profiles", sa.Column("annual_contribution_roth", sa.Numeric(14, 2), nullable=True, server_default="0"))
    op.add_column("retirement_profiles", sa.Column("spouse_annual_contribution_401k", sa.Numeric(14, 2), nullable=True, server_default="0"))
    op.add_column("retirement_profiles", sa.Column("spouse_annual_contribution_roth", sa.Numeric(14, 2), nullable=True, server_default="0"))


def downgrade() -> None:
    op.drop_column("retirement_profiles", "spouse_annual_contribution_roth")
    op.drop_column("retirement_profiles", "spouse_annual_contribution_401k")
    op.drop_column("retirement_profiles", "annual_contribution_roth")
    op.drop_column("retirement_profiles", "annual_contribution_401k")
