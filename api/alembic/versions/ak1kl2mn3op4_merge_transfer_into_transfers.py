"""merge Plaid "Transfer > …" categories into the app's "Transfers > …"

Revision ID: ak1kl2mn3op4
Revises: aj0jk1lm2no3
Create Date: 2026-10-21

Plaid's legacy taxonomy ("Transfer > Debit", "Transfer > Wire", …) and the
app's own taxonomy ("Transfers > Account Transfer", …) produced two transfer
groups in the UI. Rewrites stored category strings onto "Transfers > …".
Mapping mirrors normalize_plaid_category() in app/services/plaid_sync.py.

"Transfer > Payroll" is salary (Costco deposits Plaid mislabels) and becomes
"Income > Salary", except on loan accounts where it is the loan payment.

Data-only and not reversible: downgrade is a no-op.
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "ak1kl2mn3op4"
down_revision = "aj0jk1lm2no3"
branch_labels = None
depends_on = None

_SUBCATEGORIES = {
    "Credit Card Payment": "Credit Card Payment",
    "Internal Account Transfer": "Internal Transfer",
    "Wire": "Wire Transfer",
    "Loan Payment": "Loan Payment",
    "Debit": "Account Transfer",
    "Credit": "Account Transfer",
    "Deposit": "Account Transfer",
    "Withdrawal": "Account Transfer",
    "Third Party": "Account Transfer",
}

# (table, column) pairs that store "Group > Sub" category strings
_COLUMNS = [
    ("transactions", "plaid_category"),
    ("transaction_splits", "category"),
    ("categorization_rules", "category_string"),
]


def _rename(old: str) -> str:
    if old == "Transfer":
        return "Transfers"
    sub = old[len("Transfer > "):]
    return f"Transfers > {_SUBCATEGORIES.get(sub, sub)}"


def upgrade() -> None:
    conn = op.get_bind()

    # Payroll first: loan accounts → loan payment, everything else → salary
    conn.execute(sa.text("""
        UPDATE transactions t SET plaid_category = 'Transfers > Loan Payment'
        FROM accounts a
        WHERE a.id = t.account_id AND a.type = 'loan'
          AND t.plaid_category = 'Transfer > Payroll'
    """))
    for table, col in _COLUMNS:
        conn.execute(sa.text(
            f"UPDATE {table} SET {col} = 'Income > Salary' WHERE {col} = 'Transfer > Payroll'"
        ))

    for table, col in _COLUMNS:
        olds = conn.execute(sa.text(
            f"SELECT DISTINCT {col} FROM {table} "
            f"WHERE {col} = 'Transfer' OR {col} LIKE 'Transfer > %'"
        )).scalars().all()
        for old in olds:
            conn.execute(
                sa.text(f"UPDATE {table} SET {col} = :new WHERE {col} = :old"),
                {"new": _rename(old), "old": old},
            )

    # Report-type overrides are keyed by category string too
    rows = conn.execute(sa.text(
        "SELECT id, category_report_types FROM households WHERE category_report_types <> '{}'::jsonb"
    )).all()
    for hid, types in rows:
        renamed = {
            (_rename(k) if k == "Transfer" or k.startswith("Transfer > ") else k): v
            for k, v in types.items()
        }
        if renamed != types:
            conn.execute(
                sa.text("UPDATE households SET category_report_types = CAST(:t AS jsonb) WHERE id = :id"),
                {"t": json.dumps(renamed), "id": hid},
            )


def downgrade() -> None:
    pass
