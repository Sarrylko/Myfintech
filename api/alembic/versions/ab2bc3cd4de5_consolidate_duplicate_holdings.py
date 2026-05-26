"""consolidate duplicate holdings and add unique constraint

Revision ID: ab2bc3cd4de5
Revises: aa1bb2cc3dd4
Create Date: 2026-05-11
"""
from alembic import op
from sqlalchemy import text

revision = "ab2bc3cd4de5"
down_revision = "aa1bb2cc3dd4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Phase 1a: update the oldest holding row with merged totals
    conn.execute(text("""
        UPDATE holdings AS keeper
        SET
            quantity      = merged.total_qty,
            cost_basis    = merged.total_cost,
            current_value = merged.total_value,
            as_of_date    = now()
        FROM (
            WITH ranked AS (
                SELECT id,
                       account_id,
                       ticker_symbol,
                       ROW_NUMBER() OVER (
                           PARTITION BY account_id, ticker_symbol
                           ORDER BY created_at
                       ) AS rn
                FROM holdings
                WHERE ticker_symbol IS NOT NULL
            ),
            keepers AS (
                SELECT id, account_id, ticker_symbol FROM ranked WHERE rn = 1
            ),
            grp AS (
                SELECT account_id, ticker_symbol,
                       SUM(quantity)      AS total_qty,
                       SUM(cost_basis)    AS total_cost,
                       SUM(current_value) AS total_value
                FROM holdings
                WHERE ticker_symbol IS NOT NULL
                GROUP BY account_id, ticker_symbol
                HAVING COUNT(*) > 1
            )
            SELECT k.id AS keep_id, g.total_qty, g.total_cost, g.total_value
            FROM grp g JOIN keepers k USING (account_id, ticker_symbol)
        ) AS merged
        WHERE keeper.id = merged.keep_id
    """))

    # Phase 1b: delete all extra (non-oldest) duplicate rows
    conn.execute(text("""
        DELETE FROM holdings
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY account_id, ticker_symbol
                           ORDER BY created_at
                       ) AS rn
                FROM holdings
                WHERE ticker_symbol IS NOT NULL
            ) ranked
            WHERE rn > 1
        )
    """))

    # Phase 1c: resync manual account balances
    conn.execute(text("""
        UPDATE accounts a
        SET current_balance = (
            SELECT COALESCE(SUM(h.current_value), 0)
            FROM holdings h WHERE h.account_id = a.id
        )
        WHERE a.is_manual = TRUE
    """))

    # Phase 2: add unique constraint — safe now that duplicates are gone
    op.create_unique_constraint(
        "uq_holdings_account_ticker", "holdings", ["account_id", "ticker_symbol"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_holdings_account_ticker", "holdings", type_="unique")
    # Data merge is irreversible; only the constraint is rolled back.
