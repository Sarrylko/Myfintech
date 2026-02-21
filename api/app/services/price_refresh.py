"""Live investment price refresh via yfinance.

Runs as a Celery beat task every 5 minutes. For each household that has
price refresh enabled, checks if the configured interval has elapsed and
if the NYSE market is currently open before fetching prices.
"""

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytz
import requests as http_requests
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.account import Account
from app.models.investment import Holding
from app.models.user import Household
from app.worker import celery_app

logger = logging.getLogger(__name__)

_YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://finance.yahoo.com/",
}


def _fetch_price(sym: str) -> Decimal | None:
    """Fetch last market price for a single ticker via Yahoo Finance chart API."""
    try:
        r = http_requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=1d",
            headers=_YF_HEADERS,
            timeout=8,
        )
        if r.status_code != 200:
            return None
        meta = r.json()["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice") or meta.get("previousClose")
        if price and price > 0:
            return Decimal(str(round(float(price), 4)))
    except Exception as exc:
        logger.debug("Price fetch failed for %s: %s", sym, exc)
    return None

# ─── NYSE market holidays 2025-2027 ───────────────────────────────────────────
# Source: NYSE holiday schedule (observed dates)
_NYSE_HOLIDAYS: set[date] = {
    # 2025
    date(2025, 1, 1),   # New Year's Day
    date(2025, 1, 20),  # Martin Luther King Jr. Day
    date(2025, 2, 17),  # Presidents' Day
    date(2025, 4, 18),  # Good Friday
    date(2025, 5, 26),  # Memorial Day
    date(2025, 6, 19),  # Juneteenth
    date(2025, 7, 4),   # Independence Day
    date(2025, 9, 1),   # Labor Day
    date(2025, 11, 27), # Thanksgiving Day
    date(2025, 12, 25), # Christmas Day
    # 2026
    date(2026, 1, 1),   # New Year's Day
    date(2026, 1, 19),  # Martin Luther King Jr. Day
    date(2026, 2, 16),  # Presidents' Day
    date(2026, 4, 3),   # Good Friday
    date(2026, 5, 25),  # Memorial Day
    date(2026, 6, 19),  # Juneteenth
    date(2026, 7, 3),   # Independence Day (observed)
    date(2026, 9, 7),   # Labor Day
    date(2026, 11, 26), # Thanksgiving Day
    date(2026, 12, 25), # Christmas Day
    # 2027
    date(2027, 1, 1),   # New Year's Day
    date(2027, 1, 18),  # Martin Luther King Jr. Day
    date(2027, 2, 15),  # Presidents' Day
    date(2027, 3, 26),  # Good Friday
    date(2027, 5, 31),  # Memorial Day
    date(2027, 6, 18),  # Juneteenth (observed)
    date(2027, 7, 5),   # Independence Day (observed)
    date(2027, 9, 6),   # Labor Day
    date(2027, 11, 25), # Thanksgiving Day
    date(2027, 12, 24), # Christmas (observed)
}

_ET = pytz.timezone("America/New_York")


def is_market_open() -> bool:
    """Return True if NYSE is currently open for regular trading."""
    now_et = datetime.now(_ET)

    # Weekend
    if now_et.weekday() >= 5:
        return False

    # NYSE holiday
    if now_et.date() in _NYSE_HOLIDAYS:
        return False

    # Outside 9:30 AM – 4:00 PM ET
    market_open = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
    market_close = now_et.replace(hour=16, minute=0, second=0, microsecond=0)
    if not (market_open <= now_et <= market_close):
        return False

    return True


def next_market_open() -> datetime | None:
    """Return the next NYSE open time as a UTC datetime, or None if within today's session."""
    now_et = datetime.now(_ET)
    candidate = now_et

    for _ in range(10):  # look ahead up to 10 days
        candidate = candidate.replace(hour=9, minute=30, second=0, microsecond=0)
        # If today after close or weekend/holiday, advance to next day
        if candidate <= now_et or candidate.weekday() >= 5 or candidate.date() in _NYSE_HOLIDAYS:
            candidate = candidate + timedelta(days=1)
            continue
        return candidate.astimezone(pytz.utc)

    return None


def refresh_prices_for_household(household_id: uuid.UUID, session: Session) -> int:
    """Fetch live prices for all holdings in a household. Returns count updated."""
    result = session.execute(
        select(Holding).where(
            Holding.household_id == household_id,
            Holding.ticker_symbol.isnot(None),
        )
    )
    holdings = result.scalars().all()

    if not holdings:
        return 0

    # Group holdings by ticker
    ticker_to_holdings: dict[str, list[Holding]] = {}
    for h in holdings:
        sym = h.ticker_symbol.upper()
        ticker_to_holdings.setdefault(sym, []).append(h)

    updated = 0
    now_utc = datetime.now(timezone.utc)
    account_ids: set[uuid.UUID] = set()

    for sym, h_list in ticker_to_holdings.items():
        price_dec = _fetch_price(sym)
        if price_dec is None:
            logger.debug("No price available for %s", sym)
            continue
        for h in h_list:
            h.current_value = price_dec * h.quantity
            h.as_of_date = now_utc
            if h.account_id:
                account_ids.add(h.account_id)
            updated += 1

    # Sync current_balance on each affected account to sum of its holdings
    for account_id in account_ids:
        try:
            account = session.get(Account, account_id)
            if account and account.is_manual:
                all_holdings = session.execute(
                    select(Holding).where(Holding.account_id == account_id)
                ).scalars().all()
                total = sum(h.current_value or Decimal(0) for h in all_holdings)
                account.current_balance = total
        except Exception as exc:
            logger.warning("Failed to sync balance for account %s: %s", account_id, exc)

    # Update household refresh timestamp
    household = session.get(Household, household_id)
    if household:
        household.last_price_refresh_at = now_utc

    session.commit()
    logger.info("Refreshed %d holdings for household %s", updated, household_id)
    return updated


@celery_app.task(name="app.services.price_refresh.refresh_investment_prices")
def refresh_investment_prices() -> None:
    """Celery task: refresh investment prices for all households where due."""
    if not is_market_open():
        logger.debug("Market is closed — skipping price refresh")
        return

    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    now_utc = datetime.now(timezone.utc)

    with Session(engine) as session:
        result = session.execute(
            select(Household).where(Household.price_refresh_enabled.is_(True))
        )
        households = result.scalars().all()

        for hh in households:
            # Check if interval has elapsed since last refresh
            if hh.last_price_refresh_at is not None:
                elapsed = now_utc - hh.last_price_refresh_at
                if elapsed < timedelta(minutes=hh.price_refresh_interval_minutes):
                    continue

            try:
                count = refresh_prices_for_household(hh.id, session)
                logger.info("Household %s: updated %d holdings", hh.id, count)
            except Exception as exc:
                logger.error("Failed to refresh prices for household %s: %s", hh.id, exc)

    engine.dispose()
