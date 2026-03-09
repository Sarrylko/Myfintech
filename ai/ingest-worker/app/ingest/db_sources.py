"""
DB ingest functions — one per table source.
Each function accepts an open SQLAlchemy connection, a points list, and
an optional `since` datetime watermark for incremental fetching.
"""
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text

log = logging.getLogger(__name__)


def _fmt_money(val) -> str:
    if val is None:
        return "unknown"
    return f"${float(val):,.2f}"


def _fmt_date(val) -> str:
    if val is None:
        return "unknown"
    return str(val)[:10]


def _watermark_clause(col: str, since: datetime | None) -> tuple[str, dict]:
    """Return (SQL WHERE snippet, bind params) for watermark filtering."""
    if since is None:
        return "", {}
    return f"AND {col} > :since", {"since": since}


def ingest_transactions(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("t.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            t.id, t.household_id, t.amount, t.date, t.name, t.merchant_name,
            t.plaid_category, t.notes, t.is_ignored,
            a.name AS account_name, a.type AS account_type,
            c.name AS custom_category
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.custom_category_id
        WHERE t.is_ignored = false {clause}
        ORDER BY t.date DESC
        LIMIT 5000
    """), params).fetchall()

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
                "source": "db", "table": "transactions",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "date": _fmt_date(r.date), "amount": float(r.amount), "category": category,
            },
        })
    log.info("Prepared %d transaction chunks (since=%s)", len(rows), since)
    return len(rows)


def ingest_accounts(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("a.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            a.id, a.household_id, a.name, a.official_name,
            a.type, a.subtype, a.current_balance, a.institution_name,
            a.is_manual, a.account_scope,
            u.full_name AS owner_name
        FROM accounts a
        LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.is_hidden = false {clause}
    """), params).fetchall()

    for r in rows:
        label = r.official_name or r.name
        balance = _fmt_money(r.current_balance)
        institution = r.institution_name or ("Manual" if r.is_manual else "Unknown")
        text_chunk = (
            f"Account: '{label}' ({r.type}/{r.subtype or r.type}), "
            f"balance: {balance}, institution: {institution}, scope: {r.account_scope}"
            + (f", owner: {r.owner_name}" if r.owner_name else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"acc:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "accounts",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "balance": float(r.current_balance) if r.current_balance else None,
            },
        })
    log.info("Prepared %d account chunks", len(rows))
    return len(rows)


def ingest_budgets(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("b.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            b.id, b.household_id, b.amount, b.month, b.year,
            b.budget_type, b.start_date, b.end_date, b.alert_threshold,
            c.name AS category_name, c.is_income
        FROM budgets b
        JOIN categories c ON c.id = b.category_id
        WHERE 1=1 {clause}
    """), params).fetchall()

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
                "source": "db", "table": "budgets",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "category": r.category_name, "amount": float(r.amount),
            },
        })
    log.info("Prepared %d budget chunks", len(rows))
    return len(rows)


def ingest_properties(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("p.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            p.id, p.household_id, p.address, p.city, p.state, p.zip_code,
            p.property_type, p.purchase_price, p.purchase_date, p.closing_costs,
            p.current_value, p.management_fee_pct, p.notes
        FROM properties p
        WHERE 1=1 {clause}
    """), params).fetchall()

    for r in rows:
        addr = f"{r.address}, {r.city}, {r.state} {r.zip_code or ''}".strip(", ")
        gain = ""
        if r.current_value and r.purchase_price:
            diff = float(r.current_value) - float(r.purchase_price)
            gain = f", unrealized gain/loss: {_fmt_money(diff)}"
        total_cost = ""
        if r.closing_costs:
            total = float(r.purchase_price or 0) + float(r.closing_costs)
            total_cost = f" + {_fmt_money(r.closing_costs)} closing costs = {_fmt_money(total)} total investment"
        text_chunk = (
            f"Property: {addr} ({r.property_type}), "
            f"purchased {_fmt_date(r.purchase_date)} for {_fmt_money(r.purchase_price)}{total_cost}, "
            f"current value: {_fmt_money(r.current_value)}{gain}"
            + (f", management fee: {r.management_fee_pct}%" if r.management_fee_pct else "")
            + (f", notes: {r.notes}" if r.notes else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"prop:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "properties",
                "record_id": str(r.id), "household_id": str(r.household_id), "address": addr,
            },
        })
    log.info("Prepared %d property chunks", len(rows))
    return len(rows)


def ingest_loans(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("l.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            l.id, l.lender_name, l.loan_type,
            l.current_balance, l.interest_rate, l.monthly_payment,
            l.origination_date, l.maturity_date,
            p.address AS property_address, p.household_id
        FROM loans l
        LEFT JOIN properties p ON p.id = l.property_id
        WHERE 1=1 {clause}
    """), params).fetchall()

    for r in rows:
        prop = f" on {r.property_address}" if r.property_address else ""
        text_chunk = (
            f"Loan: {r.loan_type} from {r.lender_name}{prop}, "
            f"balance: {_fmt_money(r.current_balance)}, "
            f"rate: {r.interest_rate}%, "
            f"monthly payment: {_fmt_money(r.monthly_payment)}, "
            f"maturity: {_fmt_date(r.maturity_date)}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"loan:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "loans",
                "record_id": str(r.id),
                "household_id": str(r.household_id) if r.household_id else None,
                "balance": float(r.current_balance) if r.current_balance else None,
            },
        })
    log.info("Prepared %d loan chunks", len(rows))
    return len(rows)


def ingest_property_costs(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("pc.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            pc.id, pc.category, pc.label, pc.amount, pc.frequency, pc.is_active,
            p.address AS property_address, p.household_id
        FROM property_costs pc
        LEFT JOIN properties p ON p.id = pc.property_id
        WHERE pc.is_active = true {clause}
    """), params).fetchall()

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
                "source": "db", "table": "property_costs",
                "record_id": str(r.id),
                "household_id": str(r.household_id) if r.household_id else None,
                "amount": float(r.amount), "frequency": r.frequency,
            },
        })
    log.info("Prepared %d property cost chunks", len(rows))
    return len(rows)


def ingest_maintenance(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("m.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            m.id, m.expense_date, m.amount, m.category, m.description, m.vendor,
            p.address AS property_address, p.household_id
        FROM maintenance_expenses m
        LEFT JOIN properties p ON p.id = m.property_id
        WHERE 1=1 {clause}
        ORDER BY m.expense_date DESC
        LIMIT 1000
    """), params).fetchall()

    for r in rows:
        prop = f" at {r.property_address}" if r.property_address else ""
        text_chunk = (
            f"Maintenance expense{prop}: {r.category} — {r.description or 'no description'}, "
            f"{_fmt_money(r.amount)} on {_fmt_date(r.expense_date)}"
            + (f", vendor: {r.vendor}" if r.vendor else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"maint:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "maintenance_expenses",
                "record_id": str(r.id),
                "household_id": str(r.household_id) if r.household_id else None,
                "date": _fmt_date(r.expense_date), "amount": float(r.amount),
            },
        })
    log.info("Prepared %d maintenance expense chunks", len(rows))
    return len(rows)


def ingest_leases(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("l.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            l.id, l.monthly_rent, l.deposit, l.lease_start, l.lease_end, l.status, l.notes,
            u.unit_label, t.name AS tenant_name,
            p.address AS property_address, p.household_id
        FROM leases l
        JOIN units u ON u.id = l.unit_id
        LEFT JOIN tenants t ON t.id = l.tenant_id
        JOIN properties p ON p.id = u.property_id
        WHERE 1=1 {clause}
        ORDER BY l.lease_start DESC
        LIMIT 500
    """), params).fetchall()

    for r in rows:
        unit = f"Unit {r.unit_label}" if r.unit_label else "unit"
        text_chunk = (
            f"Rental lease: {unit} at {r.property_address} — "
            f"{_fmt_money(r.monthly_rent)}/month, "
            f"lease {_fmt_date(r.lease_start)} to {_fmt_date(r.lease_end)}, "
            f"status: {r.status}"
            + (f", tenant: {r.tenant_name}" if r.tenant_name else "")
            + (f", security deposit: {_fmt_money(r.deposit)}" if r.deposit else "")
            + (f", notes: {r.notes}" if r.notes else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"lease:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "leases",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "monthly_rent": float(r.monthly_rent) if r.monthly_rent else None,
                "status": r.status,
            },
        })
    log.info("Prepared %d lease chunks", len(rows))
    return len(rows)


def ingest_insurance_policies(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("ip.created_at", since)
    freq_mult = {"monthly": 12, "quarterly": 4, "semi_annual": 2, "annual": 1, "one_time": 0}
    rows = conn.execute(text(f"""
        SELECT
            ip.id, ip.household_id, ip.policy_type, ip.provider,
            ip.policy_number, ip.premium_amount, ip.premium_frequency,
            ip.coverage_amount, ip.deductible, ip.start_date, ip.renewal_date,
            ip.auto_renew, ip.notes,
            p.address AS property_address,
            v.make || ' ' || v.model || COALESCE(' ' || v.year::text, '') AS vehicle_label,
            v.nickname AS vehicle_nickname,
            u.full_name AS insured_user_name,
            be.name AS entity_name
        FROM insurance_policies ip
        LEFT JOIN properties p ON p.id = ip.property_id
        LEFT JOIN vehicles v ON v.id = ip.vehicle_id
        LEFT JOIN users u ON u.id = ip.insured_user_id
        LEFT JOIN business_entities be ON be.id = ip.entity_id
        WHERE ip.is_active = true {clause}
        ORDER BY ip.policy_type, ip.provider
    """), params).fetchall()

    for r in rows:
        annual = (
            float(r.premium_amount) * freq_mult.get(r.premium_frequency or "monthly", 1)
            if r.premium_amount else None
        )
        vehicle_display = r.vehicle_nickname or (r.vehicle_label.strip() if r.vehicle_label else None)
        covered = r.property_address or vehicle_display or r.insured_user_name or r.entity_name or "household"
        ptype = (r.policy_type or "").replace("_", " ")
        text_chunk = (
            f"Insurance policy: {ptype} from {r.provider}"
            + (f", policy #{r.policy_number}" if r.policy_number else "")
            + f", covering {covered}"
            + (f", premium {_fmt_money(r.premium_amount)}/{r.premium_frequency}" if r.premium_amount else "")
            + (f" (annualized: {_fmt_money(annual)}/year)" if annual else "")
            + (f", coverage {_fmt_money(r.coverage_amount)}" if r.coverage_amount else "")
            + (f", deductible {_fmt_money(r.deductible)}" if r.deductible else "")
            + (f", renews {_fmt_date(r.renewal_date)}" if r.renewal_date else "")
            + (", auto-renews" if r.auto_renew else "")
            + (f". Notes: {r.notes}" if r.notes else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"ins:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "insurance_policies",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "policy_type": r.policy_type, "provider": r.provider,
                "annual_premium": annual, "renewal_date": _fmt_date(r.renewal_date),
            },
        })
    log.info("Prepared %d insurance policy chunks", len(rows))
    return len(rows)


def ingest_vehicles(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("v.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            v.id, v.household_id, v.make, v.model, v.year,
            v.vin, v.nickname, v.color,
            COUNT(ip.id) AS policy_count
        FROM vehicles v
        LEFT JOIN insurance_policies ip ON ip.vehicle_id = v.id AND ip.is_active = true
        WHERE v.is_active = true {clause}
        GROUP BY v.id, v.household_id, v.make, v.model, v.year, v.vin, v.nickname, v.color
        ORDER BY v.make, v.model
    """), params).fetchall()

    for r in rows:
        label = r.nickname or " ".join(filter(None, [str(r.year) if r.year else None, r.make, r.model]))
        pol_count = int(r.policy_count)
        text_chunk = (
            f"Vehicle: {label}"
            + (f" ({r.make} {r.model}, {r.year})" if r.nickname and r.year else "")
            + (f", VIN: {r.vin}" if r.vin else "")
            + (f", color: {r.color}" if r.color else "")
            + f", {pol_count} active insurance polic{'y' if pol_count == 1 else 'ies'}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"veh:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "vehicles",
                "record_id": str(r.id), "household_id": str(r.household_id), "label": label,
            },
        })
    log.info("Prepared %d vehicle chunks", len(rows))
    return len(rows)


def ingest_net_worth(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("created_at", since)
    rows = conn.execute(text(f"""
        SELECT id, household_id, snapshot_date,
               total_cash, total_investments, total_real_estate, total_debts, net_worth
        FROM net_worth_snapshots
        WHERE 1=1 {clause}
        ORDER BY snapshot_date DESC
        LIMIT 24
    """), params).fetchall()

    for r in rows:
        total_assets = (
            (float(r.total_cash) if r.total_cash else 0)
            + (float(r.total_investments) if r.total_investments else 0)
            + (float(r.total_real_estate) if r.total_real_estate else 0)
        )
        text_chunk = (
            f"Net worth snapshot on {_fmt_date(r.snapshot_date)}: "
            f"cash {_fmt_money(r.total_cash)}, "
            f"investments {_fmt_money(r.total_investments)}, "
            f"real estate {_fmt_money(r.total_real_estate)}, "
            f"total assets {_fmt_money(total_assets)}, "
            f"debts {_fmt_money(r.total_debts)}, "
            f"net worth {_fmt_money(r.net_worth)}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"nw:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "net_worth_snapshots",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "date": _fmt_date(r.snapshot_date),
                "net_worth": float(r.net_worth) if r.net_worth else None,
            },
        })
    log.info("Prepared %d net worth chunks", len(rows))
    return len(rows)


def ingest_holdings(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("h.created_at", since)
    rows = conn.execute(text(f"""
        SELECT
            h.id, h.household_id, h.ticker_symbol, h.name,
            h.quantity, h.cost_basis, h.current_value,
            a.name AS account_name
        FROM holdings h
        LEFT JOIN accounts a ON a.id = h.account_id
        WHERE h.quantity > 0 {clause}
    """), params).fetchall()

    for r in rows:
        gain = ""
        if r.current_value and r.cost_basis:
            diff = float(r.current_value) - float(r.cost_basis)
            pct = (diff / float(r.cost_basis) * 100) if r.cost_basis else 0
            gain = f", unrealized P&L: {_fmt_money(diff)} ({pct:.1f}%)"
        text_chunk = (
            f"Investment holding: {r.name or r.ticker_symbol or 'Unknown'} "
            f"({'ticker: ' + r.ticker_symbol if r.ticker_symbol else 'no ticker'}), "
            f"qty: {r.quantity}, current value: {_fmt_money(r.current_value)}, "
            f"account: {r.account_name or 'Unknown'}{gain}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"hold:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "holdings",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "ticker": r.ticker_symbol,
                "current_value": float(r.current_value) if r.current_value else None,
            },
        })
    log.info("Prepared %d holding chunks", len(rows))
    return len(rows)


def ingest_business_entities(conn, points: list, since: datetime | None = None) -> int:
    clause, params = _watermark_clause("e.created_at", since)
    rows = conn.execute(text(f"""
        SELECT e.id, e.household_id, e.name, e.entity_type,
               e.state_of_formation, e.ein, e.description, e.is_active
        FROM business_entities e
        WHERE e.is_active = true {clause}
    """), params).fetchall()

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
                "source": "db", "table": "business_entities",
                "record_id": str(r.id), "household_id": str(r.household_id),
                "entity_type": r.entity_type,
            },
        })
    log.info("Prepared %d business entity chunks", len(rows))
    return len(rows)


def ingest_retirement_profiles(conn, points: list, since: datetime | None = None) -> int:
    # retirement_profiles has updated_at — watermark on updated_at
    clause, params = _watermark_clause("rp.updated_at", since)
    rows = conn.execute(text(f"""
        SELECT
            rp.id, rp.household_id,
            rp.birth_year, rp.retirement_age, rp.life_expectancy_age,
            rp.desired_annual_income, rp.social_security_estimate,
            rp.expected_return_rate, rp.inflation_rate, rp.annual_contribution
        FROM retirement_profiles rp
        WHERE 1=1 {clause}
    """), params).fetchall()

    for r in rows:
        text_chunk = (
            f"Retirement profile: born {r.birth_year}, "
            f"planning to retire at {r.retirement_age}, life expectancy {r.life_expectancy_age}, "
            f"desired annual income {_fmt_money(r.desired_annual_income)}, "
            f"SS estimate {_fmt_money(r.social_security_estimate)}, "
            f"expected return {r.expected_return_rate}%, inflation {r.inflation_rate}%, "
            f"annual contribution {_fmt_money(r.annual_contribution)}"
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"ret:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "retirement_profiles",
                "record_id": str(r.id), "household_id": str(r.household_id),
            },
        })
    log.info("Prepared %d retirement profile chunks", len(rows))
    return len(rows)


def ingest_property_performance(conn, points: list, since: datetime | None = None) -> int:
    """Always full re-compute (aggregate query — watermark not applicable)."""
    import datetime as dt

    rows = conn.execute(text("""
        SELECT
            p.id, p.household_id,
            p.address || ', ' || p.city || ', ' || p.state AS full_address,
            p.property_type, p.purchase_price, p.purchase_date, p.closing_costs,
            p.current_value, p.management_fee_pct,
            (SELECT lender_name  FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS lender,
            (SELECT loan_type    FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_type,
            (SELECT original_amount FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_original,
            (SELECT current_balance FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_balance,
            (SELECT monthly_payment FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_payment,
            (SELECT interest_rate   FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_rate,
            (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS total_units,
            (SELECT COUNT(*) FROM leases le JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id AND le.status = 'active') AS active_leases,
            (SELECT COALESCE(SUM(le.monthly_rent), 0) FROM leases le JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id AND le.status = 'active') AS monthly_rent_active,
            (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay
             JOIN leases le ON le.id = pay.lease_id JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id AND EXTRACT(YEAR FROM pay.payment_date) = EXTRACT(YEAR FROM CURRENT_DATE)
            ) AS income_this_year,
            (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay
             JOIN leases le ON le.id = pay.lease_id JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id AND EXTRACT(YEAR FROM pay.payment_date) = EXTRACT(YEAR FROM CURRENT_DATE) - 1
            ) AS income_last_year,
            (SELECT COALESCE(SUM(
                CASE pc.frequency WHEN 'monthly' THEN pc.amount*12
                WHEN 'quarterly' THEN pc.amount*4 WHEN 'annual' THEN pc.amount ELSE pc.amount END), 0)
             FROM property_costs pc WHERE pc.property_id = p.id AND pc.is_active = true
            ) AS annual_operating_costs,
            (SELECT COALESCE(SUM(m.amount), 0) FROM maintenance_expenses m WHERE m.property_id = p.id
             AND EXTRACT(YEAR FROM m.expense_date) = EXTRACT(YEAR FROM CURRENT_DATE)) AS maintenance_this_year,
            (SELECT COALESCE(SUM(m.amount), 0) FROM maintenance_expenses m WHERE m.property_id = p.id
             AND EXTRACT(YEAR FROM m.expense_date) = EXTRACT(YEAR FROM CURRENT_DATE) - 1) AS maintenance_last_year
        FROM properties p ORDER BY p.address
    """)).fetchall()

    today = dt.date.today()
    this_year = today.year
    last_year = this_year - 1

    for r in rows:
        addr = r.full_address
        purchase = float(r.purchase_price or 0)
        closing = float(r.closing_costs or 0)
        current_val = float(r.current_value or 0)
        loan_orig = float(r.loan_original or 0)
        loan_bal = float(r.loan_balance or 0)
        loan_pmt = float(r.loan_payment or 0)
        mgmt_fee = float(r.management_fee_pct or 0)
        income_ty = float(r.income_this_year or 0)
        income_ly = float(r.income_last_year or 0)
        op_costs = float(r.annual_operating_costs or 0)
        maint_ty = float(r.maintenance_this_year or 0)
        maint_ly = float(r.maintenance_last_year or 0)
        monthly_rent = float(r.monthly_rent_active or 0)
        down_payment = (purchase + closing - loan_orig) if loan_orig else (purchase + closing)
        annual_mortgage = loan_pmt * 12
        annual_mgmt_fee_ly = (income_ly * mgmt_fee / 100) if mgmt_fee and income_ly else 0
        noi_ly = income_ly - op_costs - maint_ly - annual_mgmt_fee_ly if income_ly else 0
        cash_flow_ly = noi_ly - annual_mortgage if income_ly else 0
        equity = current_val - loan_bal if current_val and loan_bal else current_val
        coc = (cash_flow_ly / down_payment * 100) if down_payment > 0 and cash_flow_ly else None
        cap_rate = (noi_ly / current_val * 100) if current_val > 0 and noi_ly else None

        lines = [
            f"Rental property investment performance — IRR, cap rate, cash-on-cash for: {addr} ({r.property_type})",
            f"  Purchase: {_fmt_money(purchase)} on {_fmt_date(r.purchase_date)}"
            + (f" + {_fmt_money(closing)} closing = {_fmt_money(purchase + closing)} total" if closing else ""),
            f"  Current value: {_fmt_money(current_val)}"
            + (f", appreciation: {_fmt_money(current_val - purchase)}" if current_val and purchase else ""),
        ]
        if r.lender:
            lines.append(
                f"  Loan: {r.loan_type} from {r.lender}, "
                f"original {_fmt_money(loan_orig)}, balance {_fmt_money(loan_bal)}, "
                f"rate {r.loan_rate}%, payment {_fmt_money(loan_pmt)}/month"
            )
        lines.append(
            f"  Units: {r.total_units} total, {r.active_leases} leased"
            + (f", active rent: {_fmt_money(monthly_rent)}/month" if monthly_rent else "")
        )
        if income_ly:
            lines.append(
                f"  {last_year}: income {_fmt_money(income_ly)}, "
                f"op costs {_fmt_money(op_costs)}, maint {_fmt_money(maint_ly)}, "
                f"NOI {_fmt_money(noi_ly)}, cash flow {_fmt_money(cash_flow_ly)}"
            )
        if coc is not None:
            lines.append(f"  Cash-on-cash ({last_year}): {coc:.1f}%")
        if cap_rate is not None:
            lines.append(f"  Cap rate ({last_year}): {cap_rate:.2f}%")
        if equity:
            lines.append(f"  Equity: {_fmt_money(equity)}, down payment: {_fmt_money(down_payment)}")

        text_chunk = "\n".join(lines)
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"perf:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db", "table": "property_performance",
                "record_id": str(r.id), "household_id": str(r.household_id), "address": addr,
            },
        })
    log.info("Prepared %d property performance chunks", len(rows))
    return len(rows)


# Registry: source_key → ingest function + watermark column
TABLE_SOURCES: dict[str, dict] = {
    "transactions":         {"fn": ingest_transactions,         "watermark_col": "created_at"},
    "accounts":             {"fn": ingest_accounts,             "watermark_col": "created_at"},
    "budgets":              {"fn": ingest_budgets,              "watermark_col": "created_at"},
    "properties":           {"fn": ingest_properties,           "watermark_col": "created_at"},
    "loans":                {"fn": ingest_loans,                "watermark_col": "created_at"},
    "property_costs":       {"fn": ingest_property_costs,       "watermark_col": "created_at"},
    "maintenance_expenses": {"fn": ingest_maintenance,          "watermark_col": "created_at"},
    "leases":               {"fn": ingest_leases,               "watermark_col": "created_at"},
    "insurance_policies":   {"fn": ingest_insurance_policies,   "watermark_col": "created_at"},
    "vehicles":             {"fn": ingest_vehicles,             "watermark_col": "created_at"},
    "holdings":             {"fn": ingest_holdings,             "watermark_col": "created_at"},
    "net_worth_snapshots":  {"fn": ingest_net_worth,            "watermark_col": "created_at"},
    "business_entities":    {"fn": ingest_business_entities,    "watermark_col": "created_at"},
    "retirement_profiles":  {"fn": ingest_retirement_profiles,  "watermark_col": "updated_at"},
    "property_performance": {"fn": ingest_property_performance, "watermark_col": None},  # always full
}
