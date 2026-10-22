"""add balance_as_of to loans

Revision ID: ao5op6qr7st8
Revises: an4no5pq6rs7
Create Date: 2026-10-21

Loan payments were split into interest and principal from the original loan
terms, which drifts once any extra principal has been paid. Recording the
date the current balance was true lets the split amortize from the actual
balance instead. Existing loans get NULL and keep the old behaviour until
their balance is next updated.
"""
import sqlalchemy as sa
from alembic import op

revision = "ao5op6qr7st8"
down_revision = "an4no5pq6rs7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("loans", sa.Column("balance_as_of", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("loans", "balance_as_of")
