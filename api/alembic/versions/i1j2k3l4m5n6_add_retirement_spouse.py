"""add retirement spouse fields

Revision ID: i1j2k3l4m5n6
Revises: h1i2j3k4l5m6
Create Date: 2026-03-03 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "i1j2k3l4m5n6"
down_revision = "h1i2j3k4l5m6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "retirement_profiles",
        sa.Column("include_spouse", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("spouse_birth_year", sa.Integer(), nullable=True),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("spouse_retirement_age", sa.Integer(), nullable=True, server_default="65"),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("spouse_social_security_estimate", sa.Numeric(14, 2), nullable=True),
    )
    op.add_column(
        "retirement_profiles",
        sa.Column("spouse_annual_contribution", sa.Numeric(14, 2), nullable=True, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("retirement_profiles", "spouse_annual_contribution")
    op.drop_column("retirement_profiles", "spouse_social_security_estimate")
    op.drop_column("retirement_profiles", "spouse_retirement_age")
    op.drop_column("retirement_profiles", "spouse_birth_year")
    op.drop_column("retirement_profiles", "include_spouse")
