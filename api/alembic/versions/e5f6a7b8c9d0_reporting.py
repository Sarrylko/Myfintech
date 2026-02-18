"""reporting: add is_capex to maintenance_expenses, create capital_events

Revision ID: e5f6a7b8c9d0
Revises: c9d0e1f2a3b4
Create Date: 2026-02-18 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'e5f6a7b8c9d0'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add is_capex to maintenance_expenses
    op.add_column(
        'maintenance_expenses',
        sa.Column('is_capex', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )

    # Create capital_events table
    op.create_table(
        'capital_events',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'property_id',
            UUID(as_uuid=True),
            sa.ForeignKey('properties.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column('event_date', sa.Date(), nullable=False),
        sa.Column('event_type', sa.String(50), nullable=False, server_default='other'),
        # acquisition | additional_investment | refi_proceeds | sale | other
        # Sign: negative = cash OUT (investment), positive = cash IN (proceeds)
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('description', sa.String(255), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
    )


def downgrade() -> None:
    op.drop_table('capital_events')
    op.drop_column('maintenance_expenses', 'is_capex')
