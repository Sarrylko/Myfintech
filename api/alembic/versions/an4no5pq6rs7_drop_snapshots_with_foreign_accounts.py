"""delete net worth snapshots that counted accounts outside the home country

Revision ID: an4no5pq6rs7
Revises: am3mn4op5qr6
Create Date: 2026-10-21

Until now the daily snapshot counted every account in the home currency, while
the dashboard only counts accounts in the household's home country. A foreign
account recorded in the home currency therefore inflated net worth history
(e.g. an India brokerage account added $4–5M to every snapshot after it was
created). The snapshot formula now matches the dashboard; this deletes the
snapshots taken between such an account's creation and the formula change.

Data-only and not reversible: downgrade is a no-op.
"""
from alembic import op

revision = "an4no5pq6rs7"
down_revision = "am3mn4op5qr6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM net_worth_snapshots s
        USING (
            SELECT a.household_id, MIN(a.created_at) AS first_created
            FROM accounts a
            JOIN households h ON h.id = a.household_id
            WHERE NOT a.is_hidden
              AND a.type IN ('investment', 'brokerage', 'depository', 'credit')
              AND a.country <> h.country_code
              AND a.currency_code = h.default_currency
              AND COALESCE(a.current_balance, 0) <> 0
            GROUP BY a.household_id
        ) f
        WHERE s.household_id = f.household_id
          AND s.snapshot_date >= f.first_created
          AND s.snapshot_date < TIMESTAMPTZ '2026-10-21 00:00:00+00'
        """
    )


def downgrade() -> None:
    pass
