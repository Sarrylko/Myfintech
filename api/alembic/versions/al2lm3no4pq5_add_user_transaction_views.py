"""add transaction_views to users

Revision ID: al2lm3no4pq5
Revises: ak1kl2mn3op4
Create Date: 2026-10-21

Per-user saved filter views for the Transactions page:
[{"id": str, "name": str, "query": str}], query being the URL query string.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "al2lm3no4pq5"
down_revision = "ak1kl2mn3op4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "transaction_views",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "transaction_views")
