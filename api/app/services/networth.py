"""Net worth snapshot service.

Implements the daily Celery beat task that takes a financial snapshot for every
household and stores it in `net_worth_snapshots`.  The five metrics match exactly
what the dashboard displays:

    total_cash          – depository account balances
    total_investments   – investment / brokerage account balances
    total_real_estate   – sum of property.current_value
    total_debts         – credit-card accounts + property loan balances
    net_worth           – assets − total_debts
"""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.account import Account
from app.models.networth import NetWorthSnapshot
from app.models.property import Property
from app.models.property_details import Loan
from app.models.user import Household
from app.worker import celery_app

logger = logging.getLogger(__name__)

_engine = create_engine(settings.database_url_sync, pool_pre_ping=True)


# ─── Core computation (sync) ────────────────────────────────────────────────────

def _compute_metrics(db: Session, household_id: uuid.UUID) -> dict:
    """Compute the 5 snapshot metrics for one household using a sync session."""
    # Accounts
    accounts = db.execute(
        select(Account).where(
            Account.household_id == household_id,
            Account.is_hidden == False,  # noqa: E712
        )
    ).scalars().all()

    total_cash = Decimal(0)
    total_investments = Decimal(0)
    credit_debt = Decimal(0)

    for acc in accounts:
        bal = acc.current_balance or Decimal(0)
        if acc.type == "depository":
            total_cash += bal
        elif acc.type in ("investment", "brokerage"):
            total_investments += bal
        elif acc.type == "credit":
            credit_debt += bal

    # Properties — real-estate value
    properties = db.execute(
        select(Property).where(Property.household_id == household_id)
    ).scalars().all()

    total_real_estate = sum((p.current_value or Decimal(0)) for p in properties)

    # Property loans (mortgages etc.)
    total_mortgage = Decimal(0)
    if properties:
        prop_ids = [p.id for p in properties]
        loans = db.execute(
            select(Loan).where(Loan.property_id.in_(prop_ids))
        ).scalars().all()
        total_mortgage = sum((l.current_balance or Decimal(0)) for l in loans)

    total_debts = credit_debt + total_mortgage
    net_worth = total_cash + total_investments + Decimal(str(total_real_estate)) - total_debts

    return {
        "total_cash": total_cash,
        "total_investments": total_investments,
        "total_real_estate": Decimal(str(total_real_estate)),
        "total_debts": total_debts,
        "net_worth": net_worth,
    }


def _upsert_snapshot(db: Session, household_id: uuid.UUID, *, update_existing: bool = False) -> bool:
    """Create (or optionally update) today's snapshot. Returns True if a row was written."""
    today = datetime.now(timezone.utc).date()

    existing = db.execute(
        select(NetWorthSnapshot).where(
            NetWorthSnapshot.household_id == household_id,
            func.date(NetWorthSnapshot.snapshot_date) == today,
        )
    ).scalar_one_or_none()

    if existing and not update_existing:
        logger.debug("Snapshot already exists for household %s on %s — skipping", household_id, today)
        return False

    metrics = _compute_metrics(db, household_id)

    if existing:
        # Refresh today's numbers in place
        existing.snapshot_date = datetime.now(timezone.utc)
        existing.total_cash = metrics["total_cash"]
        existing.total_investments = metrics["total_investments"]
        existing.total_real_estate = metrics["total_real_estate"]
        existing.total_debts = metrics["total_debts"]
        existing.net_worth = metrics["net_worth"]
    else:
        db.add(NetWorthSnapshot(
            household_id=household_id,
            snapshot_date=datetime.now(timezone.utc),
            **metrics,
        ))

    db.commit()
    return True


# ─── Celery task ────────────────────────────────────────────────────────────────

@celery_app.task(name="app.services.networth.take_snapshot_all")
def take_snapshot_all():
    """Take a daily net worth snapshot for every household (runs at 07:00 UTC)."""
    logger.info("Taking net worth snapshots for all households")

    with Session(_engine) as db:
        household_ids = db.execute(select(Household.id)).scalars().all()
        saved = skipped = 0
        for hid in household_ids:
            if _upsert_snapshot(db, hid, update_existing=False):
                saved += 1
            else:
                skipped += 1

    logger.info("Net worth snapshots done: %d saved, %d already existed", saved, skipped)
