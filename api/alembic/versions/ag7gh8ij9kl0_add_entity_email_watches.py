"""add_entity_email_watches

Revision ID: ag7gh8ij9kl0
Revises: af6fg7hi8jk9
Create Date: 2026-07-25

Adds entity_email_watches: maps a business entity (e.g. an LLC) to a Gmail
address monitored by a scheduled agent routine, with a sender allowlist for
flagging important mail. Configurable per entity so new inboxes can be
attached (or existing ones changed/paused) without code changes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ag7gh8ij9kl0"
down_revision = "af6fg7hi8jk9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "entity_email_watches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "household_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "entity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("gmail_address", sa.String(320), nullable=False),
        sa.Column(
            "sender_allowlist",
            postgresql.ARRAY(sa.String),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("notif_phone_override", sa.String(50), nullable=True),
        sa.Column(
            "is_active", sa.Boolean, server_default=sa.text("true"), nullable=False
        ),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_entity_email_watches_household_id", "entity_email_watches", ["household_id"]
    )
    op.create_index(
        "ix_entity_email_watches_entity_id", "entity_email_watches", ["entity_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_entity_email_watches_entity_id", table_name="entity_email_watches")
    op.drop_index("ix_entity_email_watches_household_id", table_name="entity_email_watches")
    op.drop_table("entity_email_watches")
