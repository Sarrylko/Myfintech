"""remove stale pending transactions; map Plaid legacy categories to the app's

Revision ID: am3mn4op5qr6
Revises: al2lm3no4pq5
Create Date: 2026-10-21

1. The Plaid sync never processed removed/modified transactions, so every
   pending charge lingered beside its posted copy. Deletes pending rows older
   than 10 days that carry no user data (splits, receipt, notes, manual
   category). The sync now handles removals itself.
2. Plaid's legacy category names ("Shops > …", "Food and Drink > …", …) split
   spending across duplicate groups. Rewrites them onto the app's taxonomy in
   transactions, splits, categorization rules and report-type overrides.
   Tables are a frozen copy of app/services/category_map.py.

Data-only and not reversible: downgrade is a no-op.
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "am3mn4op5qr6"
down_revision = "al2lm3no4pq5"
branch_labels = None
depends_on = None

_EXACT: dict[tuple[str, str], str] = {
    # Shops
    ("shops", "supermarkets and groceries"): "Food & Dining > Groceries",
    ("shops", "food and beverage store"): "Food & Dining > Groceries",
    ("shops", "clothing and accessories"): "Shopping > Clothing",
    ("shops", "gift and novelty"): "Shopping > Gifts",
    ("shops", "hardware store"): "Shopping > Home Improvement",
    ("shops", "furniture and home decor"): "Housing > Furnishings",
    ("shops", "glasses and optometrist"): "Health & Medical > Vision",
    ("shops", "computers and electronics"): "Shopping > Electronics",
    # Food and Drink
    ("food and drink", "bar"): "Food & Dining > Alcohol & Bars",
    ("food and drink", "coffee shop"): "Food & Dining > Coffee Shops",
    ("food and drink", "fast food"): "Food & Dining > Fast Food",
    # Service
    ("service", "subscription"): "Entertainment > Subscriptions",
    ("service", "utilities"): "Utilities",
    ("service", "personal care"): "Personal Care",
    ("service", "insurance"): "Insurance",
    ("service", "business services"): "Business / Work > Business Expenses",
    ("service", "storage"): "Housing > Storage",
    ("service", "travel agents and tour operators"): "Travel > Tours",
    ("service", "financial"): "Financial > Financial Services",
    ("service", "shipping and freight"): "Miscellaneous > Shipping",
    # Community
    ("community", "education"): "Education > Courses / Training",
    ("community", "government departments and agencies"): "Miscellaneous > Government Fees",
    ("community", "organizations and associations"): "Miscellaneous > Organizations",
    # Recreation
    ("recreation", "gyms and fitness centers"): "Health & Medical > Fitness / Gym",
    # Interest
    ("interest", "interest earned"): "Income > Interest Income",
    ("interest", "interest charged"): "Financial > Interest Paid",
    # Payment (credit card / loan payments become Transfers in plaid_sync)
    ("payment", "rent"): "Housing > Mortgage / Rent",
    # Healthcare
    ("healthcare", "healthcare services"): "Health & Medical > Doctor Visits",
    # Travel — Plaid's subcategories → the app's
    ("travel", "airlines and aviation services"): "Travel > Flights",
    ("travel", "airports"): "Travel > Flights",
    ("travel", "lodging"): "Travel > Hotels",
    ("travel", "car and truck rentals"): "Travel > Car Rental",
    ("travel", "gas stations"): "Transportation > Fuel",
    ("travel", "parking"): "Transportation > Parking",
    ("travel", "tolls and fees"): "Transportation > Tolls",
    ("travel", "taxi"): "Transportation > Rideshare (Uber/Lyft)",
    ("travel", "rail"): "Transportation > Public Transit",
}
_GROUP_DEFAULT: dict[str, tuple[str, str | None]] = {
    "shops": ("Shopping", "General Merchandise"),
    "food and drink": ("Food & Dining", "Restaurants"),
    "service": ("Miscellaneous", None),
    "community": ("Miscellaneous", None),
    "recreation": ("Entertainment", None),
    "interest": ("Financial", None),
    "healthcare": ("Health & Medical", None),
    "bank fees": ("Financial", "Bank Fees"),
}


def _map(category):
    if not category:
        return category
    group, _, sub = category.partition(" > ")
    group_key, sub = group.strip().lower(), sub.strip()
    exact = _EXACT.get((group_key, sub.lower()))
    if exact:
        return exact
    if group_key in _GROUP_DEFAULT:
        app_group, default_sub = _GROUP_DEFAULT[group_key]
        new_sub = default_sub or sub
        return f"{app_group} > {new_sub}" if new_sub else app_group
    return category


_COLUMNS = [
    ("transactions", "plaid_category"),
    ("transaction_splits", "category"),
    ("categorization_rules", "category_string"),
]


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("""
        DELETE FROM transactions t
        WHERE t.pending
          AND t.date < now() - interval '10 days'
          AND NOT t.has_splits
          AND NOT t.is_manual_category
          AND t.notes IS NULL
          AND NOT EXISTS (SELECT 1 FROM transaction_receipts r WHERE r.transaction_id = t.id)
    """))

    for table, col in _COLUMNS:
        olds = conn.execute(sa.text(f"SELECT DISTINCT {col} FROM {table} WHERE {col} IS NOT NULL")).scalars().all()
        for old in olds:
            new = _map(old)
            if new != old:
                conn.execute(
                    sa.text(f"UPDATE {table} SET {col} = :new WHERE {col} = :old"),
                    {"new": new, "old": old},
                )

    rows = conn.execute(sa.text(
        "SELECT id, category_report_types FROM households WHERE category_report_types <> '{}'::jsonb"
    )).all()
    for hid, types in rows:
        renamed = {_map(k): v for k, v in types.items()}
        if renamed != types:
            conn.execute(
                sa.text("UPDATE households SET category_report_types = CAST(:t AS jsonb) WHERE id = :id"),
                {"t": json.dumps(renamed), "id": hid},
            )


def downgrade() -> None:
    pass
