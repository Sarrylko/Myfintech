"""add_snaptrade

Revision ID: a2b3c4d5e6f7
Revises: e1f2a3b4c5d6
Create Date: 2026-02-20 00:00:00.000000

"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── snaptrade_users ─────────────────────────────────────────────────────
    op.create_table(
        "snaptrade_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("households.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("snaptrade_user_id", sa.String(255), nullable=False, unique=True),
        sa.Column("encrypted_user_secret", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_snaptrade_users_household_id", "snaptrade_users", ["household_id"])

    # ── snaptrade_connections ───────────────────────────────────────────────
    op.create_table(
        "snaptrade_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("households.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snaptrade_authorization_id", sa.String(255), nullable=False),
        sa.Column("brokerage_name", sa.String(255), nullable=True),
        sa.Column("brokerage_slug", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("error_code", sa.String(255), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("snaptrade_authorization_id", name="uq_snaptrade_auth_id"),
    )
    op.create_index("ix_snaptrade_connections_household_id", "snaptrade_connections", ["household_id"])

    # ── accounts: add snaptrade columns ────────────────────────────────────
    op.add_column(
        "accounts",
        sa.Column(
            "snaptrade_connection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("snaptrade_connections.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "accounts",
        sa.Column("snaptrade_account_id", sa.String(255), nullable=True, unique=True),
    )
    op.create_index("ix_accounts_snaptrade_connection_id", "accounts", ["snaptrade_connection_id"])


def downgrade() -> None:
    op.drop_index("ix_accounts_snaptrade_connection_id", table_name="accounts")
    op.drop_column("accounts", "snaptrade_account_id")
    op.drop_column("accounts", "snaptrade_connection_id")

    op.drop_index("ix_snaptrade_connections_household_id", table_name="snaptrade_connections")
    op.drop_table("snaptrade_connections")

    op.drop_index("ix_snaptrade_users_household_id", table_name="snaptrade_users")
    op.drop_table("snaptrade_users")
