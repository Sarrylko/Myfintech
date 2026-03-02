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
from app.retrieval import upsert_points

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


def _compute_irr(cash_flows: list[float], guess: float = 0.10, tol: float = 1e-6, max_iter: int = 1000) -> float | None:
    """
    Bisection-based IRR solver.
    cash_flows[0] is the initial outflow (negative), subsequent entries are inflows.
    Returns the IRR as a decimal (e.g., 0.08 = 8%) or None if not solvable.
    """
    def npv(r):
        return sum(cf / (1 + r) ** t for t, cf in enumerate(cash_flows))

    # Find bracket where NPV changes sign
    lo, hi = -0.999, 10.0
    try:
        npv_lo, npv_hi = npv(lo), npv(hi)
        if npv_lo * npv_hi > 0:
            return None  # no sign change — IRR not in range
        for _ in range(max_iter):
            mid = (lo + hi) / 2
            npv_mid = npv(mid)
            if abs(npv_mid) < tol or (hi - lo) / 2 < tol:
                return mid
            if npv_lo * npv_mid < 0:
                hi = mid
            else:
                lo = mid
                npv_lo = npv_mid
        return (lo + hi) / 2
    except Exception:
        return None


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
            p.property_type, p.purchase_price, p.purchase_date, p.closing_costs,
            p.current_value, p.management_fee_pct, p.notes
        FROM properties p
    """)).fetchall()

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
            l.id, l.lender_name, l.loan_type,
            l.current_balance, l.interest_rate, l.monthly_payment,
            l.origination_date, l.maturity_date,
            p.address AS property_address,
            p.household_id
        FROM loans l
        LEFT JOIN properties p ON p.id = l.property_id
    """)).fetchall()

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
                "source": "db",
                "table": "loans",
                "record_id": str(r.id),
                "household_id": str(r.household_id) if r.household_id else None,
                "balance": float(r.current_balance) if r.current_balance else None,
            },
        })
    log.info("Prepared %d loan chunks", len(rows))


def _ingest_property_costs(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            pc.id, pc.category, pc.label,
            pc.amount, pc.frequency, pc.is_active,
            p.address AS property_address,
            p.household_id
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
                "household_id": str(r.household_id) if r.household_id else None,
                "amount": float(r.amount),
                "frequency": r.frequency,
            },
        })
    log.info("Prepared %d property cost chunks", len(rows))


def _ingest_maintenance(conn, points: list):
    rows = conn.execute(text("""
        SELECT
            m.id, m.expense_date, m.amount,
            m.category, m.description, m.vendor,
            p.address AS property_address,
            p.household_id
        FROM maintenance_expenses m
        LEFT JOIN properties p ON p.id = m.property_id
        ORDER BY m.expense_date DESC
        LIMIT 1000
    """)).fetchall()

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
                "source": "db",
                "table": "maintenance_expenses",
                "record_id": str(r.id),
                "household_id": str(r.household_id) if r.household_id else None,
                "date": _fmt_date(r.expense_date),
                "amount": float(r.amount),
            },
        })
    log.info("Prepared %d maintenance expense chunks", len(rows))


def _ingest_leases(conn, points: list):
    """Ingest individual lease records — tenant, unit, rent amount, dates."""
    rows = conn.execute(text("""
        SELECT
            l.id, l.monthly_rent, l.deposit, l.lease_start, l.lease_end, l.status, l.notes,
            u.unit_label,
            t.name AS tenant_name,
            p.address AS property_address,
            p.household_id
        FROM leases l
        JOIN units u ON u.id = l.unit_id
        LEFT JOIN tenants t ON t.id = l.tenant_id
        JOIN properties p ON p.id = u.property_id
        ORDER BY l.lease_start DESC
        LIMIT 500
    """)).fetchall()

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
                "source": "db",
                "table": "leases",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "monthly_rent": float(r.monthly_rent) if r.monthly_rent else None,
                "status": r.status,
            },
        })
    log.info("Prepared %d lease chunks", len(rows))


def _ingest_property_performance(conn, points: list):
    """
    Synthetic per-property performance summary that aggregates rental income,
    operating costs, loan data, and computed metrics (NOI, cash flow, equity).
    This is the key chunk for answering IRR, cap rate, and cash-on-cash questions.
    """
    rows = conn.execute(text("""
        SELECT
            p.id,
            p.household_id,
            p.address || ', ' || p.city || ', ' || p.state AS full_address,
            p.property_type,
            p.purchase_price,
            p.purchase_date,
            p.closing_costs,
            p.current_value,
            p.management_fee_pct,

            -- Primary loan (highest balance)
            (SELECT lender_name  FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS lender,
            (SELECT loan_type    FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_type,
            (SELECT original_amount  FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_original,
            (SELECT current_balance  FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_balance,
            (SELECT monthly_payment  FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_payment,
            (SELECT interest_rate    FROM loans WHERE property_id = p.id ORDER BY current_balance DESC NULLS LAST LIMIT 1) AS loan_rate,

            -- Units & occupancy
            (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS total_units,
            (SELECT COUNT(*) FROM leases le JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id AND le.status = 'active') AS active_leases,
            (SELECT COALESCE(SUM(le.monthly_rent), 0)
             FROM leases le JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id AND le.status = 'active') AS monthly_rent_active,

            -- Rental income: current year
            (SELECT COALESCE(SUM(pay.amount), 0)
             FROM payments pay
             JOIN leases le ON le.id = pay.lease_id
             JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id
               AND EXTRACT(YEAR FROM pay.payment_date) = EXTRACT(YEAR FROM CURRENT_DATE)
            ) AS income_this_year,

            -- Rental income: prior year
            (SELECT COALESCE(SUM(pay.amount), 0)
             FROM payments pay
             JOIN leases le ON le.id = pay.lease_id
             JOIN units u ON u.id = le.unit_id
             WHERE u.property_id = p.id
               AND EXTRACT(YEAR FROM pay.payment_date) = EXTRACT(YEAR FROM CURRENT_DATE) - 1
            ) AS income_last_year,

            -- Annual operating costs (recurring property costs annualised)
            (SELECT COALESCE(SUM(
                CASE pc.frequency
                    WHEN 'monthly'   THEN pc.amount * 12
                    WHEN 'quarterly' THEN pc.amount * 4
                    WHEN 'annual'    THEN pc.amount
                    ELSE pc.amount
                END), 0)
             FROM property_costs pc
             WHERE pc.property_id = p.id AND pc.is_active = true
            ) AS annual_operating_costs,

            -- Maintenance: current and prior year
            (SELECT COALESCE(SUM(m.amount), 0) FROM maintenance_expenses m
             WHERE m.property_id = p.id
               AND EXTRACT(YEAR FROM m.expense_date) = EXTRACT(YEAR FROM CURRENT_DATE)
            ) AS maintenance_this_year,
            (SELECT COALESCE(SUM(m.amount), 0) FROM maintenance_expenses m
             WHERE m.property_id = p.id
               AND EXTRACT(YEAR FROM m.expense_date) = EXTRACT(YEAR FROM CURRENT_DATE) - 1
            ) AS maintenance_last_year

        FROM properties p
        ORDER BY p.address
    """)).fetchall()

    import datetime
    today = datetime.date.today()
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

        # Estimated down payment = purchase price + closing costs - original loan
        down_payment = (purchase + closing - loan_orig) if loan_orig else (purchase + closing)

        # Annual mortgage cost
        annual_mortgage = loan_pmt * 12

        # Management fee (% of gross rent)
        annual_mgmt_fee_ly = (income_ly * mgmt_fee / 100) if mgmt_fee and income_ly else 0

        # Approximate NOI (prior year) = income - operating costs - maintenance - mgmt fee
        noi_ly = income_ly - op_costs - maint_ly - annual_mgmt_fee_ly if income_ly else 0

        # Annual cash flow after mortgage (prior year)
        cash_flow_ly = noi_ly - annual_mortgage if income_ly else 0

        # Equity
        equity = current_val - loan_bal if current_val and loan_bal else current_val

        # Cash-on-cash return (prior year)
        coc = (cash_flow_ly / down_payment * 100) if down_payment > 0 and cash_flow_ly else None

        # Cap rate (prior year NOI / current value)
        cap_rate = (noi_ly / current_val * 100) if current_val > 0 and noi_ly else None

        # IRR calculation using simplified perpetuity model:
        # Year 0:    -initial_outlay  (down payment + closing costs)
        # Year 1..n: annual_cash_flow (prior-year proxy for all held years)
        # Year n:    annual_cash_flow + terminal_equity (current equity as exit value)
        irr_pct = None
        if down_payment > 0 and r.purchase_date:
            purchase_dt = r.purchase_date if hasattr(r.purchase_date, 'year') else r.purchase_date
            purchase_date_norm = purchase_dt.date() if hasattr(purchase_dt, 'date') else purchase_dt
            years_held = max(1, (today - purchase_date_norm).days // 365)
            initial_outlay = -(down_payment)
            annual_cf = cash_flow_ly if cash_flow_ly else 0
            # Build cash flow list: [t0, t1, t2, ..., tn]
            cash_flows = [initial_outlay] + [annual_cf] * (years_held - 1) + [annual_cf + equity]
            irr_val = _compute_irr(cash_flows)
            if irr_val is not None and -1 < irr_val < 10:
                irr_pct = irr_val * 100

        lines = [
            f"Rental property investment performance analysis — IRR (Internal Rate of Return), cash-on-cash return, cap rate, ROI, net operating income, rental yield, investment return for: {addr} ({r.property_type})",
            f"  Purchase: {_fmt_money(purchase)} on {_fmt_date(r.purchase_date)}" +
            (f" + {_fmt_money(closing)} closing costs = {_fmt_money(purchase + closing)} total outlay" if closing else ""),
            f"  Current value: {_fmt_money(current_val)}" +
            (f", unrealized appreciation: {_fmt_money(current_val - purchase)}" if current_val and purchase else ""),
        ]

        if r.lender:
            lines.append(
                f"  Primary loan: {r.loan_type or 'mortgage'} from {r.lender}, "
                f"original {_fmt_money(loan_orig)}, current balance {_fmt_money(loan_bal)}, "
                f"rate {r.loan_rate}%, payment {_fmt_money(loan_pmt)}/month"
            )

        if down_payment > 0:
            lines.append(f"  Estimated equity: {_fmt_money(equity)}, estimated down payment: {_fmt_money(down_payment)}")

        lines.append(
            f"  Units: {r.total_units} total, {r.active_leases} currently leased"
            + (f", active monthly rent: {_fmt_money(monthly_rent)}/month ({_fmt_money(monthly_rent * 12)}/year projected)" if monthly_rent else "")
        )

        if income_ty:
            lines.append(f"  Rental income collected {this_year} (YTD): {_fmt_money(income_ty)}")
        if income_ly:
            lines.append(f"  Rental income collected {last_year}: {_fmt_money(income_ly)}")
        if op_costs:
            lines.append(f"  Annual recurring costs (HOA/tax/insurance etc.): {_fmt_money(op_costs)}/year")
        if maint_ty:
            lines.append(f"  Maintenance expenses {this_year}: {_fmt_money(maint_ty)}")
        if maint_ly:
            lines.append(f"  Maintenance expenses {last_year}: {_fmt_money(maint_ly)}")
        if annual_mortgage:
            lines.append(f"  Annual mortgage cost: {_fmt_money(annual_mortgage)}/year ({_fmt_money(loan_pmt)}/month x 12)")

        if income_ly:
            lines.append(
                f"  {last_year} financials: gross income {_fmt_money(income_ly)}"
                + (f", operating costs {_fmt_money(op_costs)}" if op_costs else "")
                + (f", maintenance {_fmt_money(maint_ly)}" if maint_ly else "")
                + (f", mgmt fees {_fmt_money(annual_mgmt_fee_ly)}" if annual_mgmt_fee_ly else "")
                + f" → NOI {_fmt_money(noi_ly)}"
                + (f" → cash flow after mortgage {_fmt_money(cash_flow_ly)}" if annual_mortgage else "")
            )

        if coc is not None:
            lines.append(f"  Cash-on-cash return ({last_year}): {coc:.1f}% (annual cash flow / down payment)")
        if cap_rate is not None:
            lines.append(f"  Cap rate ({last_year}): {cap_rate:.2f}% (NOI / current value)")
        if irr_pct is not None:
            lines.append(
                f"  IRR (Internal Rate of Return): {irr_pct:.1f}% annualized "
                f"(based on {years_held}-year hold, {_fmt_money(down_payment)} initial investment, "
                f"~{_fmt_money(cash_flow_ly)}/yr cash flow, {_fmt_money(equity)} terminal equity)"
            )
        else:
            lines.append(
                f"  IRR calculation inputs: initial outlay {_fmt_money(purchase + closing)}, "
                f"down payment ~{_fmt_money(down_payment)}, "
                + (f"annual net cash flow ~{_fmt_money(cash_flow_ly)} (from {last_year}), " if cash_flow_ly else "")
                + f"current equity {_fmt_money(equity)}"
            )

        text_chunk = "\n".join(lines)
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"perf:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "property_performance",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "address": addr,
            },
        })
    log.info("Prepared %d property performance summary chunks", len(rows))


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


def _ingest_insurance_policies(conn, points: list):
    """One chunk per active insurance policy, including linked entity display names."""
    rows = conn.execute(text("""
        SELECT
            ip.id, ip.household_id, ip.policy_type, ip.provider,
            ip.policy_number, ip.premium_amount, ip.premium_frequency,
            ip.coverage_amount, ip.deductible,
            ip.start_date, ip.renewal_date, ip.auto_renew, ip.notes,
            p.address   AS property_address,
            v.make || ' ' || v.model || COALESCE(' ' || v.year::text, '') AS vehicle_label,
            v.nickname  AS vehicle_nickname,
            u.full_name AS insured_user_name,
            be.name     AS entity_name
        FROM insurance_policies ip
        LEFT JOIN properties       p  ON p.id  = ip.property_id
        LEFT JOIN vehicles         v  ON v.id  = ip.vehicle_id
        LEFT JOIN users            u  ON u.id  = ip.insured_user_id
        LEFT JOIN business_entities be ON be.id = ip.entity_id
        WHERE ip.is_active = true
        ORDER BY ip.policy_type, ip.provider
    """)).fetchall()

    freq_mult = {"monthly": 12, "quarterly": 4, "semi_annual": 2, "annual": 1, "one_time": 0}

    for r in rows:
        annual = (
            float(r.premium_amount) * freq_mult.get(r.premium_frequency or "monthly", 1)
            if r.premium_amount else None
        )
        vehicle_display = r.vehicle_nickname or (r.vehicle_label.strip() if r.vehicle_label else None)
        covered = (
            r.property_address or vehicle_display or r.insured_user_name or r.entity_name or "household"
        )
        ptype = (r.policy_type or "").replace("_", " ")
        text_chunk = (
            f"Insurance policy: {ptype} from {r.provider}"
            + (f", policy #{r.policy_number}" if r.policy_number else "")
            + f", covering {covered}"
            + (f", premium {_fmt_money(r.premium_amount)}/{r.premium_frequency}" if r.premium_amount else "")
            + (f" (annualized: {_fmt_money(annual)}/year)" if annual else "")
            + (f", coverage/face value {_fmt_money(r.coverage_amount)}" if r.coverage_amount else "")
            + (f", deductible {_fmt_money(r.deductible)}" if r.deductible else "")
            + (f", renews {_fmt_date(r.renewal_date)}" if r.renewal_date else "")
            + (", auto-renews" if r.auto_renew else "")
            + (f". Notes: {r.notes}" if r.notes else "")
        )
        points.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"ins:{r.id}")),
            "text": text_chunk,
            "payload": {
                "source": "db",
                "table": "insurance_policies",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "policy_type": r.policy_type,
                "provider": r.provider,
                "annual_premium": annual,
                "renewal_date": _fmt_date(r.renewal_date),
            },
        })
    log.info("Prepared %d insurance policy chunks", len(rows))


def _ingest_vehicles(conn, points: list):
    """One chunk per active vehicle, cross-referencing linked insurance policy count."""
    rows = conn.execute(text("""
        SELECT
            v.id, v.household_id, v.make, v.model, v.year,
            v.vin, v.nickname, v.color,
            COUNT(ip.id) AS policy_count
        FROM vehicles v
        LEFT JOIN insurance_policies ip
            ON ip.vehicle_id = v.id AND ip.is_active = true
        WHERE v.is_active = true
        GROUP BY v.id, v.household_id, v.make, v.model, v.year,
                 v.vin, v.nickname, v.color
        ORDER BY v.make, v.model
    """)).fetchall()

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
                "source": "db",
                "table": "vehicles",
                "record_id": str(r.id),
                "household_id": str(r.household_id),
                "label": label,
            },
        })
    log.info("Prepared %d vehicle chunks", len(rows))


def _ingest_net_worth(conn, points: list):
    rows = conn.execute(text("""
        SELECT id, household_id, snapshot_date,
               total_cash, total_investments, total_real_estate, total_debts, net_worth
        FROM net_worth_snapshots
        ORDER BY snapshot_date DESC
        LIMIT 24
    """)).fetchall()

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
            h.id, h.household_id, h.ticker_symbol, h.name,
            h.quantity, h.cost_basis, h.current_value,
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
            f"Investment holding: {r.name or r.ticker_symbol or 'Unknown'} "
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


# ─── Summary chunks ──────────────────────────────────────────────────────────

def _generate_summary_chunks(all_points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Build one synthetic 'master list' chunk per entity table.
    These embed well for 'how many / list / count' queries because they contain
    ALL item names and the total count in a single vector.
    """
    from collections import defaultdict
    by_table: dict[str, list[dict]] = defaultdict(list)
    for p in all_points:
        tbl = p["payload"].get("table", "")
        if tbl:
            by_table[tbl].append(p)

    summaries = []

    # Properties
    props = by_table.get("properties", [])
    if props:
        lines = []
        for i, p in enumerate(props, 1):
            addr = p["payload"].get("address", "Unknown address")
            val = p["payload"].get("current_value")
            val_str = f" — current value {_fmt_money(val)}" if val else ""
            lines.append(f"  {i}. {addr}{val_str}")
        text = f"Household property inventory — {len(props)} properties total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:properties")),
            "text": text,
            "payload": {"source": "db", "table": "property_summary", "record_id": "summary"},
        })
        log.info("Generated properties summary chunk (%d properties)", len(props))

    # Accounts
    accounts = by_table.get("accounts", [])
    if accounts:
        lines = []
        for i, p in enumerate(accounts, 1):
            bal = p["payload"].get("balance")
            bal_str = f" — balance {_fmt_money(bal)}" if bal is not None else ""
            # Pull label from chunk text
            chunk_text = p["payload"].get("text", "")
            label = chunk_text.split(",")[0].replace("Account: ", "").strip("'") if chunk_text else "Account"
            lines.append(f"  {i}. {label}{bal_str}")
        text = f"Household accounts — {len(accounts)} accounts total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:accounts")),
            "text": text,
            "payload": {"source": "db", "table": "account_summary", "record_id": "summary"},
        })
        log.info("Generated accounts summary chunk (%d accounts)", len(accounts))

    # Loans
    loans = by_table.get("loans", [])
    if loans:
        lines = []
        for i, p in enumerate(loans, 1):
            bal = p["payload"].get("balance")
            bal_str = f" — balance {_fmt_money(bal)}" if bal is not None else ""
            chunk_text = p["payload"].get("text", "")
            label = chunk_text.split(",")[0].replace("Loan: ", "").strip() if chunk_text else "Loan"
            lines.append(f"  {i}. {label}{bal_str}")
        text = f"Household loans — {len(loans)} loans total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:loans")),
            "text": text,
            "payload": {"source": "db", "table": "loan_summary", "record_id": "summary"},
        })
        log.info("Generated loans summary chunk (%d loans)", len(loans))

    # Holdings
    holdings = by_table.get("holdings", [])
    if holdings:
        lines = []
        for i, p in enumerate(holdings, 1):
            ticker = p["payload"].get("ticker") or ""
            val = p["payload"].get("current_value")
            val_str = f" — {_fmt_money(val)}" if val is not None else ""
            ticker_str = f" ({ticker})" if ticker else ""
            chunk_text = p["payload"].get("text", "")
            label = chunk_text.split("(")[0].replace("Investment holding: ", "").strip() if chunk_text else "Holding"
            lines.append(f"  {i}. {label}{ticker_str}{val_str}")
        text = f"Investment portfolio — {len(holdings)} holdings total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:holdings")),
            "text": text,
            "payload": {"source": "db", "table": "holding_summary", "record_id": "summary"},
        })
        log.info("Generated holdings summary chunk (%d holdings)", len(holdings))

    # Business entities
    biz = by_table.get("business_entities", [])
    if biz:
        lines = []
        for i, p in enumerate(biz, 1):
            etype = p["payload"].get("entity_type", "entity")
            chunk_text = p["payload"].get("text", "")
            label = chunk_text.split("(")[0].replace("Business entity: ", "").strip() if chunk_text else "Entity"
            lines.append(f"  {i}. {label} ({etype})")
        text = f"Business entities — {len(biz)} entities total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:business_entities")),
            "text": text,
            "payload": {"source": "db", "table": "entity_summary", "record_id": "summary"},
        })
        log.info("Generated business entities summary chunk (%d entities)", len(biz))

    # Insurance policies
    ins_pts = by_table.get("insurance_policies", [])
    if ins_pts:
        lines = []
        total_annual = 0.0
        for i, p in enumerate(ins_pts, 1):
            ptype = (p["payload"].get("policy_type") or "policy").replace("_", " ").title()
            provider = p["payload"].get("provider", "Unknown")
            annual = p["payload"].get("annual_premium")
            annual_str = f" — {_fmt_money(annual)}/year" if annual else ""
            total_annual += annual or 0.0
            lines.append(f"  {i}. {ptype} — {provider}{annual_str}")
        total_str = f", total annual premium: {_fmt_money(total_annual)}" if total_annual else ""
        text = (
            f"Household insurance portfolio — {len(ins_pts)} active polic{'y' if len(ins_pts) == 1 else 'ies'}{total_str}:\n"
            + "\n".join(lines)
        )
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:insurance")),
            "text": text,
            "payload": {"source": "db", "table": "insurance_summary", "record_id": "summary"},
        })
        log.info("Generated insurance summary chunk (%d policies)", len(ins_pts))

    return summaries


# ─── Main entry point ────────────────────────────────────────────────────────

async def run_db_ingest():
    """Full ingest of all key financial tables into Qdrant DB collection."""
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
        _ingest_leases,
        _ingest_property_performance,
        _ingest_business_entities,
        _ingest_insurance_policies,
        _ingest_vehicles,
        _ingest_net_worth,
        _ingest_holdings,
    ]

    # Open a fresh connection per table so one bad query doesn't abort the rest
    for fn in ingest_fns:
        try:
            with engine.connect() as conn:
                fn(conn, all_points)
        except Exception as e:
            log.warning("Ingest function %s failed: %s", fn.__name__, e)

    engine.dispose()

    # Append synthetic summary chunks for entity tables
    summaries = _generate_summary_chunks(all_points)
    all_points.extend(summaries)

    if not all_points:
        log.warning("No DB points to upsert.")
        return 0

    log.info("Embedding and upserting %d DB chunks (incl. %d summaries)...", len(all_points), len(summaries))
    await upsert_points(all_points, collection=settings.qdrant_collection_db)
    log.info("DB ingest complete — %d points upserted to '%s'.", len(all_points), settings.qdrant_collection_db)
    return len(all_points)
