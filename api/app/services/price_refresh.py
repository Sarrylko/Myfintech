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
from app.models.business_entity import BusinessEntity  # noqa: F401 — resolves FK for Account.entity_id
from app.models.investment import Holding
from app.models.snaptrade import SnapTradeConnection  # noqa: F401 — resolves FK for Account.snaptrade_connection_id
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


def _fetch_price(sym: str) -> tuple[Decimal | None, Decimal | None]:
    """Fetch last market price and previous close for a single ticker via Yahoo Finance.

    Returns (current_price, previous_close). Both may be None on failure.
    """
    try:
        r = http_requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=1d",
            headers=_YF_HEADERS,
            timeout=8,
        )
        if r.status_code != 200:
            return None, None
        meta = r.json()["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice") or meta.get("previousClose")
        prev = meta.get("previousClose") or meta.get("chartPreviousClose")
        price_dec = Decimal(str(round(float(price), 4))) if price and price > 0 else None
        prev_dec = Decimal(str(round(float(prev), 4))) if prev and prev > 0 else None
        return price_dec, prev_dec
    except Exception as exc:
        logger.debug("Price fetch failed for %s: %s", sym, exc)
    return None, None

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


_CG_BASE = "https://api.coingecko.com/api/v3"


def _resolve_coingecko_id(ticker: str) -> str | None:
    """Search CoinGecko for a coin by ticker symbol and return its id, or None on failure."""
    try:
        r = http_requests.get(
            f"{_CG_BASE}/search",
            params={"query": ticker},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        coins = r.json().get("coins", [])
        # Prefer exact symbol match (case-insensitive)
        ticker_upper = ticker.upper()
        for coin in coins:
            if coin.get("symbol", "").upper() == ticker_upper:
                return coin["id"]
        return None
    except Exception as exc:
        logger.warning("CoinGecko search failed for %s: %s", ticker, exc)
        return None


def _fetch_crypto_prices(coingecko_ids: list[str]) -> dict[str, tuple[Decimal, Decimal | None]]:
    """Batch-fetch USD prices and 24h previous price for a list of CoinGecko IDs.

    Returns {id: (current_price, previous_close_approx)}.
    previous_close_approx is computed as current / (1 + change_24h/100).
    """
    if not coingecko_ids:
        return {}
    try:
        r = http_requests.get(
            f"{_CG_BASE}/simple/price",
            params={
                "ids": ",".join(coingecko_ids),
                "vs_currencies": "usd",
                "include_24hr_change": "true",
            },
            timeout=8,
        )
        if r.status_code != 200:
            logger.warning("CoinGecko price fetch returned %s", r.status_code)
            return {}
        result: dict[str, tuple[Decimal, Decimal | None]] = {}
        for coin_id, data in r.json().items():
            usd = data.get("usd")
            change_24h = data.get("usd_24h_change")
            if usd and usd > 0:
                price_dec = Decimal(str(round(float(usd), 8)))
                prev_dec: Decimal | None = None
                if change_24h is not None:
                    try:
                        factor = 1 + float(change_24h) / 100
                        if factor > 0:
                            prev_dec = Decimal(str(round(float(usd) / factor, 8)))
                    except (ZeroDivisionError, ValueError):
                        pass
                result[coin_id] = (price_dec, prev_dec)
        return result
    except Exception as exc:
        logger.warning("CoinGecko price fetch failed: %s", exc)
        return {}


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

    # Split into crypto (CoinGecko) vs equity (Yahoo Finance)
    # Auto-resolve coingecko_id for crypto holdings that are missing it
    crypto_holdings: list[Holding] = []
    equity_holdings: list[Holding] = []
    for h in holdings:
        if h.asset_class == "crypto":
            if not h.coingecko_id and h.ticker_symbol:
                resolved = _resolve_coingecko_id(h.ticker_symbol)
                if resolved:
                    h.coingecko_id = resolved
                    logger.info("Auto-resolved coingecko_id=%s for ticker %s", resolved, h.ticker_symbol)
            if h.coingecko_id:
                crypto_holdings.append(h)
            else:
                logger.warning("Skipping crypto holding %s — coingecko_id could not be resolved", h.ticker_symbol)
        else:
            equity_holdings.append(h)

    updated = 0
    now_utc = datetime.now(timezone.utc)
    account_ids: set[uuid.UUID] = set()

    # ── Equity: Yahoo Finance ──────────────────────────────────────────────────
    ticker_to_holdings: dict[str, list[Holding]] = {}
    for h in equity_holdings:
        sym = h.ticker_symbol.upper()
        ticker_to_holdings.setdefault(sym, []).append(h)

    for sym, h_list in ticker_to_holdings.items():
        price_dec, prev_dec = _fetch_price(sym)
        if price_dec is None:
            logger.debug("No price available for %s", sym)
            continue
        for h in h_list:
            h.current_value = price_dec * h.quantity
            h.previous_close = prev_dec
            h.as_of_date = now_utc
            if h.account_id:
                account_ids.add(h.account_id)
            updated += 1

    # ── Crypto: CoinGecko (24/7) ───────────────────────────────────────────────
    id_to_holdings: dict[str, list[Holding]] = {}
    for h in crypto_holdings:
        id_to_holdings.setdefault(h.coingecko_id, []).append(h)

    if id_to_holdings:
        crypto_prices = _fetch_crypto_prices(list(id_to_holdings.keys()))
        for coin_id, (price_dec, prev_dec) in crypto_prices.items():
            for h in id_to_holdings[coin_id]:
                h.current_value = price_dec * h.quantity
                h.previous_close = prev_dec
                h.as_of_date = now_utc
                if h.account_id:
                    account_ids.add(h.account_id)
                updated += 1
        # Log coins with no price returned
        for coin_id in id_to_holdings:
            if coin_id not in crypto_prices:
                logger.debug("No crypto price available for coingecko_id=%s", coin_id)

    # Sync current_balance on each affected account to sum of its holdings
    for account_id in account_ids:
        try:
            account = session.get(Account, account_id)
            if account:
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
    market_open = is_market_open()

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

            # Check if this household has any crypto holdings (runs 24/7)
            has_crypto = session.execute(
                select(Holding.id).where(
                    Holding.household_id == hh.id,
                    Holding.asset_class == "crypto",
                    Holding.coingecko_id.isnot(None),
                ).limit(1)
            ).scalar_one_or_none()

            # If market is closed and no crypto holdings, skip entirely
            if not market_open and not has_crypto:
                logger.debug(
                    "Market closed, no crypto — skipping household %s", hh.id
                )
                continue

            try:
                count = refresh_prices_for_household(hh.id, session)
                logger.info("Household %s: updated %d holdings", hh.id, count)
            except Exception as exc:
                logger.error("Failed to refresh prices for household %s: %s", hh.id, exc)

    engine.dispose()
