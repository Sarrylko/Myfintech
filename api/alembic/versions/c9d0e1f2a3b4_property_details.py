"""property_details: loans, property_costs, maintenance_expenses; drop mortgage_balance

Revision ID: c9d0e1f2a3b4
Revises: b3c4d5e6f7a8
Create Date: 2026-02-18 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'c9d0e1f2a3b4'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── loans ──────────────────────────────────────────────────────────────────
    op.create_table(
        'loans',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('property_id', UUID(as_uuid=True), sa.ForeignKey('properties.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('lender_name', sa.String(255), nullable=True),
        sa.Column('loan_type', sa.String(50), nullable=False, server_default='mortgage'),
        sa.Column('original_amount', sa.Numeric(14, 2), nullable=True),
        sa.Column('current_balance', sa.Numeric(14, 2), nullable=True),
        sa.Column('interest_rate', sa.Numeric(6, 4), nullable=True),
        sa.Column('monthly_payment', sa.Numeric(14, 2), nullable=True),
        sa.Column('payment_due_day', sa.Integer(), nullable=True),
        sa.Column('escrow_included', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('escrow_amount', sa.Numeric(14, 2), nullable=True),
        sa.Column('origination_date', sa.Date(), nullable=True),
        sa.Column('maturity_date', sa.Date(), nullable=True),
        sa.Column('term_months', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )

    # ── property_costs ─────────────────────────────────────────────────────────
    op.create_table(
        'property_costs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('property_id', UUID(as_uuid=True), sa.ForeignKey('properties.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('category', sa.String(50), nullable=False, server_default='other'),
        sa.Column('label', sa.String(255), nullable=True),
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('frequency', sa.String(20), nullable=False, server_default='monthly'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )

    # ── maintenance_expenses ───────────────────────────────────────────────────
    op.create_table(
        'maintenance_expenses',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('property_id', UUID(as_uuid=True), sa.ForeignKey('properties.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('expense_date', sa.Date(), nullable=False),
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('category', sa.String(50), nullable=False, server_default='other'),
        sa.Column('description', sa.String(500), nullable=False),
        sa.Column('vendor', sa.String(255), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )

    # ── drop mortgage_balance from properties ──────────────────────────────────
    op.drop_column('properties', 'mortgage_balance')


def downgrade() -> None:
    op.add_column(
        'properties',
        sa.Column('mortgage_balance', sa.Numeric(precision=14, scale=2), nullable=True),
    )
    op.drop_table('maintenance_expenses')
    op.drop_table('property_costs')
    op.drop_table('loans')
