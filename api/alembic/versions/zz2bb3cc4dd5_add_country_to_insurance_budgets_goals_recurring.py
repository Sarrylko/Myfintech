"""add country to insurance_policies, budgets, goals, recurring_transactions

Revision ID: zz2bb3cc4dd5
Revises: zz1aa2bb3cc4
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa

revision = "zz2bb3cc4dd5"
down_revision = "zz1aa2bb3cc4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("insurance_policies", sa.Column("country", sa.String(2), nullable=False, server_default="US"))
    op.add_column("budgets", sa.Column("country", sa.String(2), nullable=False, server_default="US"))
    op.add_column("goals", sa.Column("country", sa.String(2), nullable=False, server_default="US"))
    op.add_column("recurring_transactions", sa.Column("country", sa.String(2), nullable=False, server_default="US"))


def downgrade():
    op.drop_column("recurring_transactions", "country")
    op.drop_column("goals", "country")
    op.drop_column("budgets", "country")
    op.drop_column("insurance_policies", "country")
