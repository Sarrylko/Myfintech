"""add salary withholdings

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "y9z0a1b2c3d4"
down_revision = "x8y9z0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "salary_withholdings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("household_id", UUID(as_uuid=True), sa.ForeignKey("households.id"), nullable=False, index=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("employer_name", sa.String(255), nullable=True),
        sa.Column("gross_wages", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("federal_wages", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("medicare_wages", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("federal_income_tax", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("state_income_tax", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("social_security_tax", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("medicare_tax", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("traditional_401k", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("roth_401k", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("esop_income", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("hsa", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("health_insurance", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("group_term_life", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("fsa_section125", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("household_id", "user_id", "year", name="uq_salary_withholdings_household_user_year"),
    )


def downgrade() -> None:
    op.drop_table("salary_withholdings")
