"""add retirement fidelity methodology fields

Revision ID: aa1bb2cc3dd4
Revises: zz5ee6ff7gg8
Create Date: 2026-04-26

Adds fields supporting the 10 Fidelity-methodology improvements:
  - social_security_start_age / spouse_social_security_start_age (SS delay credits)
  - monthly_healthcare_expenses (separate healthcare inflation)
  - long_term_care_start_age / long_term_care_years / long_term_care_annual_cost
  - state (per-state income tax personalization)
  - gender (actuarial life expectancy suggestion)
"""
from alembic import op
import sqlalchemy as sa

revision = "aa1bb2cc3dd4"
down_revision = "zz5ee6ff7gg8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("retirement_profiles", sa.Column("social_security_start_age", sa.Integer(), nullable=True))
    op.add_column("retirement_profiles", sa.Column("spouse_social_security_start_age", sa.Integer(), nullable=True))
    op.add_column("retirement_profiles", sa.Column("monthly_healthcare_expenses", sa.Numeric(10, 2), nullable=True))
    op.add_column("retirement_profiles", sa.Column("long_term_care_start_age", sa.Integer(), nullable=True))
    op.add_column("retirement_profiles", sa.Column("long_term_care_years", sa.Integer(), nullable=True))
    op.add_column("retirement_profiles", sa.Column("long_term_care_annual_cost", sa.Numeric(14, 2), nullable=True))
    op.add_column("retirement_profiles", sa.Column("state", sa.String(2), nullable=True))
    op.add_column("retirement_profiles", sa.Column("gender", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column("retirement_profiles", "gender")
    op.drop_column("retirement_profiles", "state")
    op.drop_column("retirement_profiles", "long_term_care_annual_cost")
    op.drop_column("retirement_profiles", "long_term_care_years")
    op.drop_column("retirement_profiles", "long_term_care_start_age")
    op.drop_column("retirement_profiles", "monthly_healthcare_expenses")
    op.drop_column("retirement_profiles", "spouse_social_security_start_age")
    op.drop_column("retirement_profiles", "social_security_start_age")
