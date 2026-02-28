"""
Ingests key financial tables from Postgres into Qdrant as natural-language chunks.
Each record becomes one vector with its text representation as the payload.
"""
import logging
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy import create_engine, text

from app.config import settings
from app.retrieval import embed_text, upsert_points

log = logging.getLogger(__name__)


def _engine():
    url = settings.database_url.replace("+asyncpg", "")
    return create_engine(url, pool_pre_ping=True)


def _fmt_money(val) -> str:
    if val is None:
        return "unknown"
    return f"${float(val):,.2f}"


def _fmt_date(val) -> str:
    if val is None:
        return "unknown"
    return str(val)[:10]


# ─── Per-table ingest functions ──────────────────────────────────────────────

def _ingest_transactions(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            t.id,
            t.household_id,
            t.amount,
            t.date,
            t.name,
            t.merchant_name,
            t.plaid_category,
            t.notes,
            t.is_ignored,
            a.name  AS account_name,
            a.type  AS account_type,
            c.name  AS custom_category
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.custom_category_id
        WHERE t.is_ignored = false
        ORDER BY t.date DESC
        LIMIT 5000
    """)).fetchall()

    for r in rows:
        category = r.custom_category or r.plaid_category or "Uncategorized"
        merchant = r.merchant_name or r.name
        account = r.account_name or "Unknown Account"
        text_chunk = (
            f"Transaction: {_fmt_money(r.amount)} at '{merchant}' "
            f"on {_fmt_date(r.date)}, category: {category}, "
            f"account: {account} ({r.account_type or 'unknown type'})"
            + (f", notes: {r.notes}" if r.notes else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"txn:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "transactions",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "date": _fmt_date(r.date),
                "amount": float(r.amount),
                "category": category,
            },
        })
    log.info("Prepared %d transaction chunks", len(rows))


def _ingest_accounts(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            a.id, a.household_id, a.name, a.official_name,
            a.type, a.subtype, a.current_balance, a.institution_name,
            a.is_manual, a.account_scope,
            u.full_name AS owner_name
        FROM accounts a
        LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.is_hidden = false
    """)).fetchall()

    for r in rows:
        label = r.official_name or r.name
        balance = _fmt_money(r.current_balance)
        institution = r.institution_name or ("Manual" if r.is_manual else "Unknown")
        text_chunk = (
            f"Account: '{label}' ({r.type}/{r.subtype or r.type}), "
            f"balance: {balance}, institution: {institution}, "
            f"scope: {r.account_scope}"
            + (f", owner: {r.owner_name}" if r.owner_name else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"acc:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "accounts",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "balance": float(r.current_balance) if r.current_balance else None,
            },
        })
    log.info("Prepared %d account chunks", len(rows))


def _ingest_budgets(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            b.id, b.household_id, b.amount, b.month, b.year,
            b.budget_type, b.start_date, b.end_date, b.alert_threshold,
            c.name AS category_name, c.is_income
        FROM budgets b
        JOIN categories c ON c.id = b.category_id
    """)).fetchall()

    for r in rows:
        if r.budget_type == "monthly":
            period = f"{r.year}-{r.month:02d}" if r.month else str(r.year)
        else:
            period = f"{r.start_date} to {r.end_date}"
        income_label = "income" if r.is_income else "expense"
        text_chunk = (
            f"Budget: {r.category_name} ({income_label}) — limit {_fmt_money(r.amount)} "
            f"for {period}, alert at {r.alert_threshold}% spent"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"bud:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "budgets",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "category": r.category_name,
                "amount": float(r.amount),
            },
        })
    log.info("Prepared %d budget chunks", len(rows))


def _ingest_properties(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            p.id, p.household_id, p.address, p.city, p.state, p.zip_code,
            p.property_type, p.purchase_price, p.purchase_date,
            p.current_value, p.notes
        FROM properties p
    """)).fetchall()

    for r in rows:
        addr = f"{r.address}, {r.city}, {r.state} {r.zip_code or ''}".strip(", ")
        gain = ""
        if r.current_value and r.purchase_price:
            diff = float(r.current_value) - float(r.purchase_price)
            gain = f", unrealized gain/loss: {_fmt_money(diff)}"
        text_chunk = (
            f"Property: {addr} ({r.property_type}), "
            f"purchased {_fmt_date(r.purchase_date)} for {_fmt_money(r.purchase_price)}, "
            f"current value: {_fmt_money(r.current_value)}{gain}"
            + (f", notes: {r.notes}" if r.notes else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"prop:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "properties",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "address": addr,
            },
        })
    log.info("Prepared %d property chunks", len(rows))


def _ingest_loans(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            l.id, l.household_id, l.lender, l.loan_type,
            l.balance, l.interest_rate, l.monthly_payment,
            l.origination_date, l.maturity_date,
            p.address AS property_address
        FROM loans l
        LEFT JOIN properties p ON p.id = l.property_id
    """)).fetchall()

    for r in rows:
        prop = f" on {r.property_address}" if r.property_address else ""
        text_chunk = (
            f"Loan: {r.loan_type} from {r.lender}{prop}, "
            f"balance: {_fmt_money(r.balance)}, "
            f"rate: {r.interest_rate}%, "
            f"monthly payment: {_fmt_money(r.monthly_payment)}, "
            f"maturity: {_fmt_date(r.maturity_date)}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"loan:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "loans",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "balance": float(r.balance) if r.balance else None,
            },
        })
    log.info("Prepared %d loan chunks", len(rows))


def _ingest_property_costs(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            pc.id, pc.household_id, pc.category, pc.label,
            pc.amount, pc.frequency, pc.is_active,
            p.address AS property_address
        FROM property_costs pc
        LEFT JOIN properties p ON p.id = pc.property_id
        WHERE pc.is_active = true
    """)).fetchall()

    for r in rows:
        prop = f" for {r.property_address}" if r.property_address else ""
        text_chunk = (
            f"Recurring property cost: {r.label} ({r.category}){prop}, "
            f"{_fmt_money(r.amount)}/{r.frequency}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"pcost:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "property_costs",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "amount": float(r.amount),
                "frequency": r.frequency,
            },
        })
    log.info("Prepared %d property cost chunks", len(rows))


def _ingest_maintenance(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            m.id, m.household_id, m.date, m.amount,
            m.category, m.description, m.vendor,
            p.address AS property_address
        FROM maintenance_expenses m
        LEFT JOIN properties p ON p.id = m.property_id
        ORDER BY m.date DESC
        LIMIT 1000
    """)).fetchall()

    for r in rows:
        prop = f" at {r.property_address}" if r.property_address else ""
        text_chunk = (
            f"Maintenance expense{prop}: {r.category} — {r.description or 'no description'}, "
            f"{_fmt_money(r.amount)} on {_fmt_date(r.date)}"
            + (f", vendor: {r.vendor}" if r.vendor else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"maint:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "maintenance_expenses",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "date": _fmt_date(r.date),
                "amount": float(r.amount),
            },
        })
    log.info("Prepared %d maintenance expense chunks", len(rows))


def _ingest_business_entities(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            e.id, e.household_id, e.name, e.entity_type,
            e.state_of_formation, e.ein, e.description, e.is_active
        FROM business_entities e
        WHERE e.is_active = true
    """)).fetchall()

    for r in rows:
        text_chunk = (
            f"Business entity: {r.name} ({r.entity_type}), "
            f"formed in {r.state_of_formation or 'unknown state'}"
            + (f", EIN: {r.ein}" if r.ein else "")
            + (f" — {r.description}" if r.description else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"biz:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "business_entities",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "entity_type": r.entity_type,
            },
        })
    log.info("Prepared %d business entity chunks", len(rows))


def _ingest_net_worth(conn, points: list):
    rows = conn.execute(text("""
        SELECT id, household_id, snapshot_date, total_assets,
               total_liabilities, net_worth
        FROM net_worth_snapshots
        ORDER BY snapshot_date DESC
        LIMIT 24
    """)).fetchall()

    for r in rows:
        text_chunk = (
            f"Net worth snapshot on {_fmt_date(r.snapshot_date)}: "
            f"assets {_fmt_money(r.total_assets)}, "
            f"liabilities {_fmt_money(r.total_liabilities)}, "
            f"net worth {_fmt_money(r.net_worth)}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"nw:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "net_worth_snapshots",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "date": _fmt_date(r.snapshot_date),
                "net_worth": float(r.net_worth) if r.net_worth else None,
            },
        })
    log.info("Prepared %d net worth snapshot chunks", len(rows))


def _ingest_holdings(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            h.id, h.household_id, h.ticker_symbol, h.security_name,
            h.quantity, h.cost_basis, h.current_price, h.current_value,
            a.name AS account_name
        FROM holdings h
        LEFT JOIN accounts a ON a.id = h.account_id
        WHERE h.quantity > 0
    """)).fetchall()

    for r in rows:
        gain = ""
        if r.current_value and r.cost_basis:
            diff = float(r.current_value) - float(r.cost_basis)
            pct = (diff / float(r.cost_basis) * 100) if r.cost_basis else 0
            gain = f", unrealized P&L: {_fmt_money(diff)} ({pct:.1f}%)"
        text_chunk = (
            f"Investment holding: {r.security_name or r.ticker_symbol or 'Unknown'} "
            f"({'ticker: ' + r.ticker_symbol if r.ticker_symbol else 'no ticker'}), "
            f"qty: {r.quantity}, current value: {_fmt_money(r.current_value)}, "
            f"account: {r.account_name or 'Unknown'}{gain}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"hold:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "holdings",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "ticker": r.ticker_symbol,
                "current_value": float(r.current_value) if r.current_value else None,
            },
        })
    log.info("Prepared %d holding chunks", len(rows))


# ─── Main entry point ────────────────────────────────────────────────────────

async def run_db_ingest():
    """Full ingest of all key financial tables into Qdrant."""
    log.info("Starting DB ingest...")
    engine = _engine()
    all_points: list[dict[str, Any]] = []

    ingest_fns = [
        _ingest_transactions,
        _ingest_accounts,
        _ingest_budgets,
        _ingest_properties,
        _ingest_loans,
        _ingest_property_costs,
        _ingest_maintenance,
        _ingest_business_entities,
        _ingest_net_worth,
        _ingest_holdings,
    ]

    with engine.connect() as conn:
        for fn in ingest_fns:
            try:
                fn(conn, all_points)
            except Exception as e:
                log.warning("Ingest function %s failed: %s", fn.__name__, e)

    engine.dispose()

    if not all_points:
        log.warning("No DB points to upsert.")
        return 0

    log.info("Embedding and upserting %d DB chunks...", len(all_points))
    await upsert_points(all_points)
    log.info("DB ingest complete — %d points upserted.", len(all_points))
    return len(all_points)
