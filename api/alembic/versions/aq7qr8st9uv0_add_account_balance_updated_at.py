"""add accounts.balance_updated_at

Revision ID: aq7qr8st9uv0
Revises: ap6pq7rs8tu9
Create Date: 2026-10-22

Records when an account's balance or holdings last came from a sync or a
manual edit. holdings.as_of_date can't serve for this because price refreshes
rewrite it, which makes a manual account look fresh while its quantities are
months old.

Backfill: linked accounts take their connection's last sync; manual accounts
take their newest holding's creation, else the account's own creation.
"""
import sqlalchemy as sa
from alembic import op

revision = "aq7qr8st9uv0"
down_revision = "ap6pq7rs8tu9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("balance_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.execute("""
        UPDATE accounts a SET balance_updated_at = p.last_synced_at
        FROM plaid_items p
        WHERE a.plaid_item_id = p.id AND p.last_synced_at IS NOT NULL
    """)
    op.execute("""
        UPDATE accounts a SET balance_updated_at = s.last_synced_at
        FROM snaptrade_connections s
        WHERE a.snaptrade_connection_id = s.id AND s.last_synced_at IS NOT NULL
    """)
    op.execute("""
        UPDATE accounts a SET balance_updated_at = GREATEST(
            a.created_at,
            (SELECT MAX(h.created_at) FROM holdings h WHERE h.account_id = a.id)
        )
        WHERE a.is_manual AND a.balance_updated_at IS NULL
    """)


def downgrade() -> None:
    op.drop_column("accounts", "balance_updated_at")
