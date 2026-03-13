"""
Financial Picture generation service.
Combines uploaded documents + live DB snapshot into an AI-generated financial report.
Caches results in Redis with a 48-hour TTL.
Regenerated daily via Celery beat task.
"""
import json
import logging
from datetime import datetime, timezone

import httpx
import redis as redis_sync
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.account import Account
from app.models.financial_document import FinancialDocument
from app.models.investment import Holding
from app.models.networth import NetWorthSnapshot
from app.models.property import Property
from app.models.property_details import Loan
from app.models.rental import Lease, Unit
from app.models.snaptrade import SnapTradeConnection  # noqa: F401 — required for SQLAlchemy mapper
from app.models.user import Household
from app.worker import celery_app

log = logging.getLogger(__name__)

_engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
_redis = redis_sync.Redis.from_url(settings.redis_url, decode_responses=True)

CACHE_TTL = 60 * 60 * 48  # 48 hours


def cache_key(household_id, year: int) -> str:
    return f"financial_picture:{household_id}:{year}"


def _build_doc_manifest(db: Session, household_id, year: int | None) -> tuple[str, int]:
    """Returns (manifest_string, doc_count)."""
    q = (
        select(FinancialDocument)
        .where(FinancialDocument.household_id == household_id)
        .order_by(FinancialDocument.document_type, FinancialDocument.reference_year)
    )
    if year:
        q = q.where(FinancialDocument.reference_year == year)
    docs = db.execute(q).scalars().all()

    if not docs:
        yr = f" for {year}" if year else ""
        return f"No financial documents uploaded{yr}.", 0

    lines = [f"Total documents: {len(docs)}\n"]
    by_type: dict[str, list] = {}
    for doc in docs:
        by_type.setdefault(doc.document_type, []).append(doc)
    for dtype, group in sorted(by_type.items()):
        lines.append(f"\n{dtype.upper()} ({len(group)} file{'s' if len(group) != 1 else ''}):")
        for doc in group:
            yr_tag = f" [{doc.reference_year}]" if doc.reference_year else ""
            desc = f" — {doc.description}" if doc.description else ""
            lines.append(f"  • {doc.filename}{yr_tag}{desc}")
    return "\n".join(lines), len(docs)


def _build_live_snapshot(db: Session, household_id) -> str:
    """Query live DB for current financial state."""
    lines = []

    # Accounts
    accounts = db.execute(
        select(Account).where(
            Account.household_id == household_id,
            Account.is_hidden == False,  # noqa: E712
        )
    ).scalars().all()
    if accounts:
        cash = sum(float(a.current_balance or 0) for a in accounts if a.type == "depository")
        credit = sum(float(a.current_balance or 0) for a in accounts if a.type == "credit")
        invest = sum(float(a.current_balance or 0) for a in accounts if a.type == "investment")
        loan_bal = sum(float(a.current_balance or 0) for a in accounts if a.type == "loan")
        lines.append(f"\nACCOUNTS (live, {len(accounts)} total):")
        lines.append(f"  Cash/Depository: ${cash:,.2f}")
        lines.append(f"  Investment accounts: ${invest:,.2f}")
        lines.append(f"  Credit card balances: ${credit:,.2f}")
        lines.append(f"  Loan balances (linked accounts): ${loan_bal:,.2f}")
        for a in accounts:
            lines.append(f"  • {a.name} ({a.type}/{a.subtype or '—'}) — ${float(a.current_balance or 0):,.2f}")

    # Net worth snapshots (last 3)
    snapshots = db.execute(
        select(NetWorthSnapshot)
        .where(NetWorthSnapshot.household_id == household_id)
        .order_by(NetWorthSnapshot.snapshot_date.desc())
        .limit(3)
    ).scalars().all()
    if snapshots:
        lines.append(f"\nNET WORTH SNAPSHOTS (latest {len(snapshots)}):")
        for s in snapshots:
            lines.append(
                f"  • {s.snapshot_date.date()}: Net Worth ${float(s.net_worth):,.2f} "
                f"(Cash ${float(s.total_cash):,.2f} | Investments ${float(s.total_investments):,.2f} "
                f"| Real Estate ${float(s.total_real_estate):,.2f} | Debts ${float(s.total_debts):,.2f})"
            )

    # Properties + loans
    properties = db.execute(
        select(Property).where(Property.household_id == household_id)
    ).scalars().all()
    if properties:
        prop_ids = [p.id for p in properties]
        loans = db.execute(select(Loan).where(Loan.property_id.in_(prop_ids))).scalars().all()
        loans_by_prop: dict[str, list] = {}
        for loan in loans:
            loans_by_prop.setdefault(str(loan.property_id), []).append(loan)
        lines.append(f"\nPROPERTIES (live, {len(properties)} total):")
        for p in properties:
            prop_loans = loans_by_prop.get(str(p.id), [])
            total_debt = sum(float(l.current_balance or 0) for l in prop_loans)
            equity = float(p.current_value or 0) - total_debt
            lines.append(
                f"  • {p.address}: Value ${float(p.current_value or 0):,.2f} | "
                f"Mortgage Balance ${total_debt:,.2f} | Equity ${equity:,.2f}"
            )

    # Holdings summary
    h_row = db.execute(
        select(func.sum(Holding.current_value), func.count(Holding.id))
        .where(Holding.household_id == household_id, Holding.quantity > 0)
    ).one()
    if h_row[1] and h_row[1] > 0:
        lines.append(f"\nINVESTMENT HOLDINGS (live): {h_row[1]} positions, total ${float(h_row[0] or 0):,.2f}")

    # Active leases
    units = db.execute(select(Unit).where(Unit.household_id == household_id)).scalars().all()
    if units:
        unit_ids = [u.id for u in units]
        active_leases = db.execute(
            select(Lease).where(Lease.unit_id.in_(unit_ids), Lease.status == "active")
        ).scalars().all()
        if active_leases:
            monthly_rent = sum(float(l.monthly_rent or 0) for l in active_leases)
            lines.append(
                f"\nACTIVE RENTAL LEASES: {len(active_leases)} leases, "
                f"${monthly_rent:,.2f}/month (${monthly_rent * 12:,.2f}/year)"
            )

    return "\n".join(lines) if lines else "No live database records found."


def _build_prompt(manifest: str, live_snapshot: str, doc_count: int, year_context: str) -> str:
    return f"""You are a comprehensive financial analyst and planner. Analyze this household's financial picture {year_context} using TWO data sources:

1. UPLOADED DOCUMENTS — historical records (tax forms, statements, etc.)
2. LIVE DATABASE — current real-time financial state (accounts, holdings, properties)

Synthesize both sources, identify discrepancies, track what has changed, and provide actionable insights.

══════════════════════════════════════════
SECTION A: UPLOADED DOCUMENTS
══════════════════════════════════════════
{manifest}

══════════════════════════════════════════
SECTION B: LIVE DATABASE (current state)
══════════════════════════════════════════
{live_snapshot}

══════════════════════════════════════════

Generate a thorough report using EXACTLY these section headers (## for each):

## Document Overview
Which document types are present, years covered, and notable gaps.

## Income Analysis
From documents: W-2 wages, 1099 income, K-1 distributions, rental income.
From live DB: active lease income, account balances as income indicators.
Note discrepancies between documented and live data.

## Tax Summary
From documents: taxes paid/withheld, refunds, deductions (1098 mortgage interest, etc.).
From live DB: current mortgage balances generating deductible interest.
Estimate effective tax rate if determinable.

## Investment & Portfolio Analysis
From documents: brokerage statements, 1099-DIV, 1099-B, 401k statements.
From live DB: current account balances, holdings count and total value.
Calculate gain/loss since last statement date.

## Real Estate Analysis
From documents: Schedule E, 1098, rental income schedules.
From live DB: current property values, mortgage balances, active leases.
Calculate current equity per property and document vs live value change.

## Net Worth Trend
From live DB snapshots: show net worth trend over recent months.
Cross-reference with document data to explain major changes.

## Document vs Live Data Reconciliation
Identify specific discrepancies:
- Income in documents vs live account balances
- Investment values in statements vs current live portfolio
- Rental income in Schedule E vs active lease rent rolls
- Loan balances in documents vs current live balances
Note what has likely changed since last filing.

## Key Financial KPIs
Use EXACTLY this format (one KPI per line, no deviations):
KPI: Total Household Income (documented) = $X,XXX
KPI: Active Rental Income (live) = $X,XXX/yr
KPI: Current Net Worth (live) = $X,XXX
KPI: Investment Portfolio Value (live) = $X,XXX
KPI: Total Real Estate Equity (live) = $X,XXX
KPI: Total Debt Outstanding (live) = $X,XXX
KPI: Effective Tax Rate (documented) = X.X%
KPI: Documents on File = {doc_count}
Add any other relevant KPIs you can calculate.

## Insights & Recommendations
5 actionable insights from the combined analysis. Focus on:
1. Discrepancies that need investigation
2. Tax optimization opportunities
3. Portfolio/investment observations
4. Debt management observations
5. Document gaps to fill

Be specific with numbers. Use ONLY the data provided above and your RAG context."""


def generate_picture_for_household(household_id_str: str, year: int) -> str | None:
    """
    Synchronously generate a financial picture report for one household.
    Calls RAG API non-streaming, stores result in Redis.
    Returns the report text, or None on failure.
    """
    if not settings.rag_api_url:
        log.warning("RAG API not configured — skipping financial picture generation")
        return None

    try:
        with Session(_engine) as db:
            manifest, doc_count = _build_doc_manifest(db, household_id_str, year)
            live_snapshot = _build_live_snapshot(db, household_id_str)
    except Exception as e:
        log.error("DB query failed for household %s: %s", household_id_str, e)
        return None

    year_context = f"for tax year {year}"
    prompt = _build_prompt(manifest, live_snapshot, doc_count, year_context)

    rag_headers: dict[str, str] = {}
    if settings.rag_api_key:
        rag_headers["X-RAG-Api-Key"] = settings.rag_api_key

    try:
        resp = httpx.post(
            f"{settings.rag_api_url}/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": prompt}],
                "household_id": household_id_str,
                "stream": False,
            },
            headers=rag_headers,
            timeout=180,
        )
        resp.raise_for_status()
        report_text = resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        log.error("RAG API call failed for household %s: %s", household_id_str, e)
        return None

    # Cache in Redis
    try:
        _redis.set(
            cache_key(household_id_str, year),
            json.dumps({
                "report_text": report_text,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "year": year,
            }),
            ex=CACHE_TTL,
        )
        log.info("Cached financial picture for household %s year %d", household_id_str, year)
    except Exception as e:
        log.warning("Redis cache write failed for household %s: %s", household_id_str, e)

    return report_text


@celery_app.task(name="app.services.financial_picture.generate_all_financial_pictures")
def generate_all_financial_pictures():
    """
    Daily Celery beat task: regenerate Financial Picture for all households.
    Uses the prior tax year by default.
    """
    prior_year = datetime.now(timezone.utc).year - 1
    log.info("Starting daily financial picture generation for year %d...", prior_year)

    try:
        with Session(_engine) as db:
            household_ids = db.execute(select(Household.id)).scalars().all()
    except Exception as e:
        log.error("Failed to fetch households: %s", e)
        return

    success = 0
    for hid in household_ids:
        result = generate_picture_for_household(str(hid), prior_year)
        if result:
            success += 1

    log.info("Financial picture generation complete: %d/%d households succeeded", success, len(household_ids))
