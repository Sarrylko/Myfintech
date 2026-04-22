"""add household country profiles and active country

Revision ID: z0a1b2c3d4e5
Revises: y9z0a1b2c3d4
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "z0a1b2c3d4e5"
down_revision = "y9z0a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add active_country_code to households
    op.add_column(
        "households",
        sa.Column("active_country_code", sa.String(2), nullable=False, server_default="US"),
    )

    # New table: household_country_profiles
    op.create_table(
        "household_country_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "household_id",
            UUID(as_uuid=True),
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("country_name", sa.String(100), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("locale", sa.String(20), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("household_id", "country_code", name="uq_household_country_profile"),
    )

    # Seed: US profile for every existing household (mark as primary)
    op.execute("""
        INSERT INTO household_country_profiles
            (id, household_id, country_code, country_name, currency_code, locale, is_primary, display_order)
        SELECT
            gen_random_uuid(),
            id,
            'US',
            'United States',
            'USD',
            'en-US',
            true,
            0
        FROM households
        ON CONFLICT DO NOTHING
    """)

    # Seed: IN profile for all households (user requested India as a second country)
    op.execute("""
        INSERT INTO household_country_profiles
            (id, household_id, country_code, country_name, currency_code, locale, is_primary, display_order)
        SELECT
            gen_random_uuid(),
            id,
            'IN',
            'India',
            'INR',
            'en-IN',
            false,
            1
        FROM households
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.drop_table("household_country_profiles")
    op.drop_column("households", "active_country_code")
