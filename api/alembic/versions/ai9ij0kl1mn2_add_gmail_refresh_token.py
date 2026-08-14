"""add encrypted_gmail_refresh_token to entity_email_watches

Revision ID: ai9ij0kl1mn2
Revises: ah8hi9jk0lm1
Create Date: 2026-07-25

Stores the Gmail API OAuth refresh token (Fernet-encrypted, same pattern as
Plaid access tokens) obtained via the one-time local OAuth consent script,
so the local Celery task can poll that inbox without any inbound network
exposure.
"""
from alembic import op
import sqlalchemy as sa

revision = "ai9ij0kl1mn2"
down_revision = "ah8hi9jk0lm1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "entity_email_watches",
        sa.Column("encrypted_gmail_refresh_token", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("entity_email_watches", "encrypted_gmail_refresh_token")
