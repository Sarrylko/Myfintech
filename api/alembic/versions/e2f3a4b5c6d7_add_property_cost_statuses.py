"""add_property_cost_statuses

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-02-24

Tracks whether property tax, HOA, and insurance are paid or due for a given year.
One row per (property_id, year, category) — upserted via the API.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "property_cost_statuses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),   # property_tax | hoa | insurance
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("paid_date", sa.Date(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("property_id", "year", "category", name="uq_property_cost_status"),
    )
    op.create_index("ix_property_cost_statuses_property_id", "property_cost_statuses", ["property_id"])
    op.create_index("ix_property_cost_statuses_household_id", "property_cost_statuses", ["household_id"])


def downgrade() -> None:
    op.drop_index("ix_property_cost_statuses_household_id", "property_cost_statuses")
    op.drop_index("ix_property_cost_statuses_property_id", "property_cost_statuses")
    op.drop_table("property_cost_statuses")
