"""Dividend income: what the portfolio has paid and what it should pay.

Received income comes from investment_transactions of type "dividend" (Plaid
maps interest there too). Forward income is current shares times each
security's trailing-12-month dividend per share from Yahoo's chart API,
cached in Redis for a day. Holdings Yahoo knows nothing about fall back to
what they actually paid over the last year. The upcoming calendar repeats
last year's ex-dividend dates a year on, so it's an estimate.
"""

import asyncio
import json
import logging
import re
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import requests
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.models.account import Account
from app.models.investment import Holding, InvestmentTransaction

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
_CACHE_PREFIX = "divhist:v1:"
_CACHE_TTL = 24 * 3600
_CACHE_TTL_EMPTY = 6 * 3600
_MAX_LOOKUPS = 150
_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
_MUTUAL_FUND_RE = re.compile(r"^[A-Z]{4}X$")
_TICKER_IN_NAME_RE = re.compile(r"\(([A-Z]{2,6})\)")
# A payer that isn't a holding (cash sweeps, mostly) counts as still paying
# if it paid this recently
_STILL_PAYING_DAYS = 45
_CALENDAR_DAYS = 90
_MONTHS = 24

_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="divhist")


def _fetch_dividend_history(sym: str) -> list[tuple[str, float]] | None:
    """Two years of (ex-date ISO, amount per share) from Yahoo. None on failure,
    [] when the security has paid nothing."""
    try:
        r = requests.get(
            # Yahoo spells share classes with a dash (BF.B → BF-B)
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym.replace('.', '-')}",
            params={"range": "2y", "interval": "1mo", "events": "div"},
            headers=_YF_HEADERS,
            timeout=8,
        )
        if r.status_code == 404:
            return []
        if r.status_code != 200:
            return None
        result = (r.json().get("chart") or {}).get("result") or []
        if not result:
            return []
        divs = (result[0].get("events") or {}).get("dividends") or {}
        out = []
        for ev in divs.values():
            amt = ev.get("amount")
            ts = ev.get("date")
            if amt and ts and amt > 0:
                out.append((datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat(), float(amt)))
        out.sort()
        return out
    except Exception:
        logger.debug("dividend lookup failed for %s", sym, exc_info=True)
        return None


async def _dividend_histories(symbols: list[str]) -> dict[str, list[tuple[date, Decimal]]]:
    redis = get_redis()
    found: dict[str, list] = {}
    missing: list[str] = []
    for sym in symbols:
        try:
            cached = await redis.get(_CACHE_PREFIX + sym)
        except Exception:
            cached = None
        if cached is not None:
            found[sym] = json.loads(cached)
        else:
            missing.append(sym)

    if missing:
        loop = asyncio.get_running_loop()
        fetched = await asyncio.gather(
            *(loop.run_in_executor(_pool, _fetch_dividend_history, s) for s in missing)
        )
        for sym, events in zip(missing, fetched):
            if events is None:
                continue  # transient failure: don't cache, don't guess
            found[sym] = events
            try:
                await redis.setex(
                    _CACHE_PREFIX + sym,
                    _CACHE_TTL if events else _CACHE_TTL_EMPTY,
                    json.dumps(events),
                )
            except Exception:
                pass

    return {
        sym: [(date.fromisoformat(d), Decimal(str(a))) for d, a in events]
        for sym, events in found.items()
    }


def _income(txn: InvestmentTransaction) -> Decimal:
    """Cash received. Plaid signs credits negative; manual and CSV entries are positive."""
    amt = txn.amount or Decimal(0)
    return -amt if txn.plaid_investment_transaction_id else amt


def _key(ticker: str | None, name: str | None) -> str:
    t = (ticker or "").upper().strip()
    if not t:
        # Plaid often leaves the ticker off cash sweeps: "...MONEY MARKET (SPAXX) (Cash)"
        m = _TICKER_IN_NAME_RE.search(name or "")
        t = m.group(1) if m else ""
    return t or (name or "Unknown").strip()


def _is_mutual_fund(p: dict) -> bool:
    """Yahoo folds mutual funds' capital-gain distributions into their dividend
    history with no way to separate them, which reads as 7-13% yields on growth
    funds. Their forward income comes from what they actually paid instead."""
    return p["asset_class"] == "mutual_fund" or bool(_MUTUAL_FUND_RE.match(p["ticker"] or ""))


def _add_year(d: date) -> date:
    try:
        return d.replace(year=d.year + 1)
    except ValueError:  # Feb 29
        return d.replace(year=d.year + 1, day=28)


def _money(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.01")))


def _ratio(num: Decimal, den: Decimal) -> float | None:
    return float(num / den) if den > 0 else None


async def build_dividend_summary(
    db: AsyncSession, household_id: uuid.UUID, account_ids: list[uuid.UUID] | None,
) -> dict:
    today = datetime.now(timezone.utc).date()
    ttm_start = today - timedelta(days=365)
    prior_start = today - timedelta(days=730)

    acct_q = select(Account.id).where(
        Account.household_id == household_id, Account.type == "investment",
    )
    if account_ids:
        acct_q = acct_q.where(Account.id.in_(account_ids))
    ids = list((await db.execute(acct_q)).scalars().all())

    txns = []
    holdings = []
    if ids:
        txns = (await db.execute(
            select(InvestmentTransaction).where(
                InvestmentTransaction.account_id.in_(ids),
                InvestmentTransaction.type == "dividend",
                InvestmentTransaction.date >= datetime.combine(prior_start, datetime.min.time(), tzinfo=timezone.utc),
            )
        )).scalars().all()
        holdings = (await db.execute(
            select(Holding).where(Holding.account_id.in_(ids))
        )).scalars().all()

    # ── Received ────────────────────────────────────────────────────────────
    month_keys = []
    y, m = today.year, today.month
    for _ in range(_MONTHS):
        month_keys.append(f"{y:04d}-{m:02d}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    month_keys.reverse()
    monthly: dict[str, Decimal] = {k: Decimal(0) for k in month_keys}

    ttm = Decimal(0)
    prior = Decimal(0)
    received_by_key: dict[str, Decimal] = defaultdict(Decimal)
    names: dict[str, str] = {}
    payments_by_key: dict[str, int] = defaultdict(int)
    last_paid: dict[str, date] = {}
    earliest: date | None = None

    for t in txns:
        d = t.date.date() if isinstance(t.date, datetime) else t.date
        inc = _income(t)
        earliest = d if earliest is None or d < earliest else earliest
        mk = f"{d.year:04d}-{d.month:02d}"
        if mk in monthly:
            monthly[mk] += inc
        if d > ttm_start:
            ttm += inc
            k = _key(t.ticker_symbol, t.name)
            received_by_key[k] += inc
            payments_by_key[k] += 1
            last_paid[k] = max(d, last_paid.get(k, d))
            names.setdefault(k, t.name or k)
        elif d > prior_start:
            prior += inc

    # ── Holdings, combined by ticker ────────────────────────────────────────
    pos: dict[str, dict] = {}
    total_value = Decimal(0)
    for h in holdings:
        qty = h.quantity or Decimal(0)
        value = h.current_value or Decimal(0)
        if qty <= 0:
            continue
        total_value += value
        if (h.asset_class or "").lower() == "crypto" or h.coingecko_id:
            continue
        k = _key(h.ticker_symbol, h.name)
        p = pos.setdefault(k, {
            "ticker": (h.ticker_symbol or "").upper().strip() or None,
            "name": h.name or k, "qty": Decimal(0), "value": Decimal(0),
            "cost": Decimal(0), "cost_value": Decimal(0),
            "asset_class": (h.asset_class or "").lower(),
        })
        p["qty"] += qty
        p["value"] += value
        if h.cost_basis is not None and h.cost_basis > 0:
            p["cost"] += h.cost_basis
            p["cost_value"] += value
        names[k] = p["name"]  # holding names are cleaner than transaction memos

    symbols = sorted(
        (p["ticker"] for p in pos.values()
         if p["ticker"] and _SYMBOL_RE.match(p["ticker"]) and not p["ticker"].startswith("CUR")
         and not _is_mutual_fund(p)),
        key=lambda s: -pos[s]["value"],
    )[:_MAX_LOOKUPS]
    histories = await _dividend_histories(symbols) if symbols else {}

    # ── Forward income + calendar ───────────────────────────────────────────
    forward_total = Decimal(0)
    fwd_on_cost = Decimal(0)
    forward_by_key: dict[str, dict] = {}
    upcoming = []
    horizon = today + timedelta(days=_CALENDAR_DAYS)

    for k, p in pos.items():
        events = [] if _is_mutual_fund(p) else histories.get(p["ticker"] or "", [])
        trailing = [(d, a) for d, a in events if d > ttm_start]
        if trailing:
            dps = sum((a for _, a in trailing), Decimal(0))
            fwd = p["qty"] * dps
            source = "market"
            # Each past ex-date maps to one projected date a year later
            for d, a in trailing:
                nd = _add_year(d)
                if today <= nd <= horizon:
                    upcoming.append({
                        "date": nd.isoformat(), "ticker": p["ticker"], "name": p["name"],
                        "per_share": str(a), "amount": _money(p["qty"] * a),
                    })
        elif received_by_key.get(k, Decimal(0)) > 0:
            fwd = received_by_key[k]
            source = "history"
        else:
            continue
        forward_total += fwd
        if p["cost"] > 0:
            # Only the lots with a cost basis count against it
            share = p["cost_value"] / p["value"] if p["value"] > 0 else Decimal(1)
            fwd_on_cost += fwd * share
        forward_by_key[k] = {
            "forward": fwd, "source": source,
            "yield": _ratio(fwd, p["value"]),
            "yield_on_cost": _ratio(fwd, p["cost"]) if p["cost"] > 0 else None,
            "value": p["value"],
        }

    still_paying = today - timedelta(days=_STILL_PAYING_DAYS)
    for k, received in received_by_key.items():
        if k not in pos and received > 0 and last_paid[k] >= still_paying:
            forward_total += received
            forward_by_key[k] = {
                "forward": received, "source": "history",
                "yield": None, "yield_on_cost": None, "value": None,
            }

    # Cost denominator covers every holding with cost basis, payers or not
    cost_total = sum((p["cost"] for p in pos.values()), Decimal(0))

    upcoming.sort(key=lambda u: (u["date"], u["ticker"] or ""))

    # ── Top payers ──────────────────────────────────────────────────────────
    keys = set(received_by_key) | set(forward_by_key)
    payers = []
    for k in keys:
        f = forward_by_key.get(k, {})
        payers.append({
            "key": k,
            "ticker": pos[k]["ticker"] if k in pos else (k if _SYMBOL_RE.match(k) else None),
            "name": names.get(k, k),
            "received_ttm": _money(received_by_key.get(k, Decimal(0))),
            "payments_ttm": payments_by_key.get(k, 0),
            "forward_annual": _money(f["forward"]) if f else None,
            "forward_source": f.get("source"),
            "value": _money(f["value"]) if f and f["value"] is not None else (_money(pos[k]["value"]) if k in pos else None),
            "yield": f.get("yield"),
            "yield_on_cost": f.get("yield_on_cost"),
            "held": k in pos,
        })
    payers.sort(key=lambda p: (-Decimal(p["received_ttm"]), -Decimal(p["forward_annual"] or 0)))

    return {
        "as_of": today.isoformat(),
        "monthly": [{"month": k, "amount": _money(v)} for k, v in monthly.items()],
        "ttm_received": _money(ttm),
        "prior_ttm_received": _money(prior),
        "yoy_growth": float(ttm / prior - 1) if prior > 0 else None,
        "history_start": earliest.isoformat() if earliest else None,
        "forward_annual": _money(forward_total),
        "portfolio_value": _money(total_value),
        "yield_on_value": _ratio(forward_total, total_value),
        "yield_on_cost": _ratio(fwd_on_cost, cost_total),
        "symbols_looked_up": len(symbols),
        "symbols_with_market_data": sum(1 for s in symbols if s in histories),
        "mutual_funds_held": sum(1 for p in pos.values() if _is_mutual_fund(p)),
        "top_payers": payers,
        "upcoming": upcoming,
    }
