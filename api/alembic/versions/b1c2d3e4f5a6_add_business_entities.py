"""add_business_entities

Revision ID: b1c2d3e4f5a6
Revises: e2f3a4b5c6d7
Create Date: 2026-02-24 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── business_entities ──────────────────────────────────────────────────────
    op.create_table(
        "business_entities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "household_id",
            UUID(as_uuid=True),
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("entity_type", sa.String(30), nullable=False),
        sa.Column("state_of_formation", sa.String(2), nullable=True),
        sa.Column("ein", sa.String(20), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "is_active", sa.Boolean, server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_business_entities_household_id", "business_entities", ["household_id"]
    )
    op.create_index(
        "ix_business_entities_parent_id", "business_entities", ["parent_id"]
    )

    # ── entity_ownership ───────────────────────────────────────────────────────
    op.create_table(
        "entity_ownership",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "entity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "owner_entity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("ownership_pct", sa.Numeric(5, 2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_entity_ownership_entity_id", "entity_ownership", ["entity_id"]
    )

    # ── properties.entity_id ───────────────────────────────────────────────────
    op.add_column(
        "properties",
        sa.Column(
            "entity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_properties_entity_id", "properties", ["entity_id"])

    # ── accounts.entity_id + account_scope ────────────────────────────────────
    op.add_column(
        "accounts",
        sa.Column(
            "entity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "accounts",
        sa.Column(
            "account_scope",
            sa.String(10),
            server_default="personal",
            nullable=False,
        ),
    )
    op.create_index("ix_accounts_entity_id", "accounts", ["entity_id"])


def downgrade() -> None:
    op.drop_index("ix_accounts_entity_id", table_name="accounts")
    op.drop_column("accounts", "account_scope")
    op.drop_column("accounts", "entity_id")

    op.drop_index("ix_properties_entity_id", table_name="properties")
    op.drop_column("properties", "entity_id")

    op.drop_index("ix_entity_ownership_entity_id", table_name="entity_ownership")
    op.drop_table("entity_ownership")

    op.drop_index("ix_business_entities_parent_id", table_name="business_entities")
    op.drop_index("ix_business_entities_household_id", table_name="business_entities")
    op.drop_table("business_entities")
