"""Map Plaid's legacy category names onto the app's own taxonomy.

Plaid's legacy taxonomy ("Shops > …", "Food and Drink > …", "Service > …")
overlaps the app's ("Shopping > …", "Food & Dining > …"), which split the same
spending across two groups. New Plaid transactions go through
map_legacy_category() at sync time; migration am3mn4op5qr6 rewrote stored data
with a frozen copy of these tables.

Keep in sync with TAXONOMY in frontend/src/app/(app)/transactions/page.tsx.
"""

# (legacy group, legacy subcategory) → app category; both keys lowercase,
# "" for a bare group
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

# Legacy group → (app group, subcategory to use, or None to keep Plaid's)
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


def map_legacy_category(category: str | None) -> str | None:
    """'Shops > Supermarkets and Groceries' → 'Food & Dining > Groceries'.

    Categories already in the app's taxonomy (or unknown) are returned as-is.
    """
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
