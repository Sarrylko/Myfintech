"""add category_report_types to households

Revision ID: aj0jk1lm2no3
Revises: 39aa4a1b9b1f
Create Date: 2026-10-21

Per-household mapping of category string ("Group" or "Group > Item") to how
it counts in reports: "cashflow", "transfer" or "savings". Only user
overrides are stored; defaults live in the frontend.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "aj0jk1lm2no3"
down_revision = "39aa4a1b9b1f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "households",
        sa.Column(
            "category_report_types",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("households", "category_report_types")
