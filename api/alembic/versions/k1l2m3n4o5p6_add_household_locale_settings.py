"""add household locale settings

Revision ID: k1l2m3n4o5p6
Revises: j1k2l3m4n5o6
Create Date: 2026-03-05 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "k1l2m3n4o5p6"
down_revision = "j1k2l3m4n5o6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "households",
        sa.Column("default_currency", sa.String(3), nullable=False, server_default="USD"),
    )
    op.add_column(
        "households",
        sa.Column("default_locale", sa.String(10), nullable=False, server_default="en-US"),
    )
    op.add_column(
        "households",
        sa.Column("country_code", sa.String(2), nullable=False, server_default="US"),
    )


def downgrade() -> None:
    op.drop_column("households", "country_code")
    op.drop_column("households", "default_locale")
    op.drop_column("households", "default_currency")
