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
from app.models.snaptrade import SnapTradeConnection  # noqa: F401 — ensures Account mapper resolves this relationship
from app.models.user import Household, HouseholdCountryProfile
from app.services.networth_metrics import compute_net_worth
from app.worker import celery_app

logger = logging.getLogger(__name__)

_engine = create_engine(settings.database_url_sync, pool_pre_ping=True)


# ─── Core computation (sync) ────────────────────────────────────────────────────

def _compute_metrics(db: Session, household_id: uuid.UUID) -> dict:
    """Compute the 5 snapshot metrics for one household using a sync session."""
    household = db.execute(
        select(Household).where(Household.id == household_id)
    ).scalar_one_or_none()
    home_currency = household.default_currency if household else "USD"
    home_country = household.country_code if household else "US"

    accounts = db.execute(select(Account).where(Account.household_id == household_id)).scalars().all()
    properties = db.execute(select(Property).where(Property.household_id == household_id)).scalars().all()
    loans = db.execute(
        select(Loan).where(Loan.property_id.in_([p.id for p in properties]))
    ).scalars().all() if properties else []
    return compute_net_worth(list(accounts), list(properties), list(loans), home_country, home_currency)


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
