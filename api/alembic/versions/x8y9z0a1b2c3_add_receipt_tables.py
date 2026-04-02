"""add receipt tables

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-04-01

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'x8y9z0a1b2c3'
down_revision = 'w7x8y9z0a1b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'transaction_receipts',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('transaction_id', UUID(as_uuid=True),
                  sa.ForeignKey('transactions.id', ondelete='CASCADE'),
                  unique=True, nullable=False),
        sa.Column('household_id', UUID(as_uuid=True), nullable=False),
        sa.Column('filename', sa.String(500), nullable=False),
        sa.Column('stored_filename', sa.String(500), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('content_type', sa.String(100), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('parse_error', sa.Text(), nullable=True),
        sa.Column('extracted_text', sa.Text(), nullable=True),
        sa.Column('parsed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_transaction_receipts_transaction_id', 'transaction_receipts', ['transaction_id'])
    op.create_index('ix_transaction_receipts_household_id', 'transaction_receipts', ['household_id'])

    op.create_table(
        'receipt_line_items',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('receipt_id', UUID(as_uuid=True),
                  sa.ForeignKey('transaction_receipts.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('transaction_id', UUID(as_uuid=True),
                  sa.ForeignKey('transactions.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('household_id', UUID(as_uuid=True), nullable=False),
        sa.Column('description', sa.String(500), nullable=False),
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('ai_category', sa.String(255), nullable=True),
        sa.Column('category_id', UUID(as_uuid=True),
                  sa.ForeignKey('categories.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('is_confirmed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_receipt_line_items_receipt_id', 'receipt_line_items', ['receipt_id'])
    op.create_index('ix_receipt_line_items_transaction_id', 'receipt_line_items', ['transaction_id'])
    op.create_index('ix_receipt_line_items_household_id', 'receipt_line_items', ['household_id'])


def downgrade() -> None:
    op.drop_table('receipt_line_items')
    op.drop_table('transaction_receipts')
