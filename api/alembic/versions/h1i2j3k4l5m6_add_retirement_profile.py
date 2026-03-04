"""add retirement profile

Revision ID: h1i2j3k4l5m6
Revises: g1h2i3j4k5l6
Create Date: 2026-03-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "h1i2j3k4l5m6"
down_revision = "g1h2i3j4k5l6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "retirement_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "household_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("birth_year", sa.Integer(), nullable=False),
        sa.Column("retirement_age", sa.Integer(), nullable=False, server_default="65"),
        sa.Column("life_expectancy_age", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("desired_annual_income", sa.Numeric(14, 2), nullable=False),
        sa.Column("social_security_estimate", sa.Numeric(14, 2), nullable=True),
        sa.Column("expected_return_rate", sa.Numeric(5, 4), nullable=False, server_default="0.07"),
        sa.Column("inflation_rate", sa.Numeric(5, 4), nullable=False, server_default="0.03"),
        sa.Column("annual_contribution", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("retirement_profiles")
