"""add_valuation_notes

Revision ID: a1b2c3d4e5f6
Revises: 1578db3df019
Create Date: 2026-02-19 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '1578db3df019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('property_valuations', sa.Column('notes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('property_valuations', 'notes')
