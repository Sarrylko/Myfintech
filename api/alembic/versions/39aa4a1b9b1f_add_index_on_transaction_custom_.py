"""add index on transaction custom_category_id

Revision ID: 39aa4a1b9b1f
Revises: ai9ij0kl1mn2
Create Date: 2026-08-17 13:21:06.990399
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '39aa4a1b9b1f'
down_revision: Union[str, None] = 'ai9ij0kl1mn2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(op.f('ix_transactions_custom_category_id'), 'transactions', ['custom_category_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_transactions_custom_category_id'), table_name='transactions')
