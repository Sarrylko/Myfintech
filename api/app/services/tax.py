"""Tax drag: account tax treatment, realized gains, harvestable losses and fees.

Each investment account gets a treatment from its Plaid subtype and name
(a "ROTH IRA" often arrives as subtype "ira"). Realized gains come from
rebuilding FIFO lots out of investment_transactions, per account and ticker,
following share transfers between the household's own accounts. Plaid only
returns about two years of history, so a sale of shares bought before that
falls back to the holding's average cost (term unknown) or, when the position
is gone, is reported as having no basis. Tax-loss harvesting candidates are
taxable positions below cost; a buy of the same ticker in any household
account in the last 30 days is flagged, since selling would be a wash sale.
"""

import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.investment import Holding, InvestmentTransaction

_TAX_FREE_SUBTYPES = {"roth", "roth 401k", "roth ira", "hsa", "529", "529 plan", "tfsa"}
_TAX_DEFERRED_SUBTYPES = {
    "401k", "401a", "403b", "457b", "457plan", "ira", "sep ira", "simple ira",
    "pension", "keogh", "profit sharing plan", "retirement", "non-taxable brokerage account",
    "rrsp", "rrif", "rdsp", "sarsep", "lira", "lif", "thrift savings plan", "tsp",
}
_ROTH_RE = re.compile(r"\broth\b", re.I)
_HSA_RE = re.compile(r"\b(hsa|health savings)\b", re.I)
_MONEY_MARKET_RE = re.compile(r"^[A-Z]{3,4}XX$")
_CASH_NAME_RE = re.compile(r"money market|\(cash\)|cash reserves|core position", re.I)
_WASH_DAYS = 30
_ZERO = Decimal(0)
_EPS = Decimal("0.000001")


def tax_treatment(acc: Account) -> str:
    """taxable | tax_deferred | tax_free | crypto"""
    sub = (acc.subtype or "").lower().strip()
    name = f"{acc.name or ''} {acc.official_name or ''}"
    if sub == "crypto exchange":
        return "crypto"
    if sub in _TAX_FREE_SUBTYPES or _HSA_RE.search(name):
        return "tax_free"
    if sub in _TAX_DEFERRED_SUBTYPES:
        return "tax_free" if _ROTH_RE.search(name) else "tax_deferred"
    return "taxable"


def _money(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.01")))


def _qty(v: Decimal) -> str:
    return format(v.normalize(), "f")


def _day(d: datetime | date) -> date:
    return d.date() if isinstance(d, datetime) else d


def _ticker(t: str | None) -> str:
    return (t or "").upper().strip()


def _add_year(d: date) -> date:
    try:
        return d.replace(year=d.year + 1)
    except ValueError:  # Feb 29
        return d.replace(year=d.year + 1, day=28)


def _is_long_term(acquired: date, sold: date) -> bool:
    # Long-term means held more than one year
    return sold > _add_year(acquired)


class _Lot:
    __slots__ = ("qty", "cost", "acquired")

    def __init__(self, qty: Decimal, cost: Decimal | None, acquired: date | None):
        self.qty = qty
        self.cost = cost            # None: basis unknown (shares transferred in)
        self.acquired = acquired    # None: acquisition date unknown

    def take(self, qty: Decimal) -> "_Lot":
        """Split off qty shares (qty <= self.qty) as a new lot."""
        cost = None if self.cost is None else (self.cost * qty / self.qty if self.qty > 0 else _ZERO)
        part = _Lot(qty, cost, self.acquired)
        self.qty -= qty
        if self.cost is not None:
            self.cost -= cost
        return part


def _pop_fifo(lots: list[_Lot], qty: Decimal) -> tuple[list[_Lot], Decimal]:
    """Remove qty shares oldest-first. Returns the removed lots and the
    quantity no lot covered."""
    taken: list[_Lot] = []
    while qty > _EPS and lots:
        lot = lots[0]
        if lot.qty <= qty + _EPS:
            taken.append(lots.pop(0))
            qty -= lot.qty
        else:
            taken.append(lot.take(qty))
            qty = _ZERO
    return taken, max(qty, _ZERO)


def _is_cash_sweep(ticker: str, name: str | None) -> bool:
    """Money market sweeps trade at $1 all day; their "sales" aren't taxable events."""
    return bool(_MONEY_MARKET_RE.match(ticker)) or bool(_CASH_NAME_RE.search(name or ""))


def _is_cash_row(t: InvestmentTransaction) -> bool:
    """Plaid tags cash deposits with a sweep ticker sometimes: qty == amount at $1."""
    notes = (t.notes or "").lower()
    if not _ticker(t.ticker_symbol):
        return True
    return "cash/" in notes and (t.price or _ZERO) == 1 and abs(t.quantity or _ZERO) == abs(t.amount or _ZERO)


def _kind(t: InvestmentTransaction) -> str | None:
    """What a row does to lots: buy, sell, in, out, split, or None."""
    qty = t.quantity or _ZERO
    if t.type == "buy":
        return "buy" if _ticker(t.ticker_symbol) else None
    if t.type == "sell":
        return "sell" if _ticker(t.ticker_symbol) else None
    if t.type == "split":
        return "split"
    if t.type in ("transfer_in", "transfer_out", "other") and qty != 0 and not _is_cash_row(t):
        return "in" if qty > 0 else "out"
    return None


# Same-day order: shares leave before they arrive (so a transfer between two
# household accounts can carry its lots across), splits apply to the day's
# position, and buys land before sells so day trades match.
_ORDER = {"out": 0, "in": 1, "buy": 2, "split": 3, "sell": 4}


async def build_tax_summary(
    db: AsyncSession, household_id: uuid.UUID, account_ids: list[uuid.UUID] | None, year: int | None,
) -> dict:
    today = datetime.now(timezone.utc).date()
    year = year or today.year
    year_start, year_end = date(year, 1, 1), date(year, 12, 31)

    all_accounts = (await db.execute(
        select(Account).where(Account.household_id == household_id, Account.type == "investment")
    )).scalars().all()
    treatment = {a.id: tax_treatment(a) for a in all_accounts}
    acct_name = {a.id: a.name for a in all_accounts}
    shown = {a.id for a in all_accounts if not account_ids or a.id in set(account_ids)}

    # Every account's history is needed: transfers carry lots between
    # accounts, and a spouse's buy can still trigger a wash sale.
    txns = (await db.execute(
        select(InvestmentTransaction).where(InvestmentTransaction.household_id == household_id)
    )).scalars().all() if all_accounts else []
    holdings = (await db.execute(
        select(Holding).where(Holding.household_id == household_id)
    )).scalars().all() if all_accounts else []

    history_start = min((_day(t.date) for t in txns), default=None)

    # Average cost per share from current holdings: the fallback basis for
    # shares sold that were bought before the transaction history begins
    avg_cost: dict[tuple, Decimal] = {}
    for h in holdings:
        q = h.quantity or _ZERO
        if q > 0 and h.cost_basis and h.cost_basis > 0:
            avg_cost[(h.account_id, _ticker(h.ticker_symbol))] = h.cost_basis / q

    buys_by_ticker: dict[str, list[tuple[date, uuid.UUID]]] = defaultdict(list)
    for t in txns:
        if t.type == "buy" and _ticker(t.ticker_symbol):
            buys_by_ticker[_ticker(t.ticker_symbol)].append((_day(t.date), t.account_id))

    # Splits: Plaid writes the new share count on the ticker row and the old
    # count on an untickered row the same day
    split_old: dict[tuple, Decimal] = {}
    for t in txns:
        if t.type == "split" and not _ticker(t.ticker_symbol) and (t.quantity or _ZERO) < 0:
            split_old[(t.account_id, _day(t.date))] = abs(t.quantity)

    rows = [(t, k) for t in txns if (k := _kind(t))]
    rows.sort(key=lambda r: (_day(r[0].date), _ORDER[r[1]]))

    lots: dict[tuple, list[_Lot]] = defaultdict(list)
    in_transit: dict[tuple, list[list[_Lot]]] = defaultdict(list)
    sales: list[dict] = []

    for t, kind in rows:
        d = _day(t.date)
        tk = _ticker(t.ticker_symbol)
        key = (t.account_id, tk)
        qty = abs(t.quantity or _ZERO)
        amount = abs(t.amount or _ZERO)

        if kind == "buy":
            if qty <= 0:
                continue
            cost = amount if amount > 0 else qty * (t.price or _ZERO)
            lots[key].append(_Lot(qty, cost, d))

        elif kind == "out":
            taken, short = _pop_fifo(lots[key], qty)
            if short > _EPS:
                taken.append(_Lot(short, None, None))
            in_transit[(tk, qty.quantize(Decimal("0.0001")), d)].append(taken)

        elif kind == "in":
            moved = in_transit.get((tk, qty.quantize(Decimal("0.0001")), d))
            if moved:
                lots[key].extend(moved.pop(0))
                lots[key].sort(key=lambda l: l.acquired or date.min)
            else:
                lots[key].append(_Lot(qty, None, None))

        elif kind == "split":
            if not tk or (t.quantity or _ZERO) <= 0:
                continue
            held = sum((l.qty for l in lots[key]), _ZERO)
            old = split_old.get((t.account_id, d)) or held
            if old > 0 and held > 0:
                factor = qty / old
                for l in lots[key]:
                    l.qty *= factor

        elif kind == "sell":
            if qty <= 0:
                continue
            proceeds = amount if amount > 0 else qty * (t.price or _ZERO) - (t.fees or _ZERO)
            taken, uncovered = _pop_fifo(lots[key], qty)
            if d < year_start or d > year_end:
                continue
            if treatment.get(t.account_id) not in ("taxable", "crypto") or t.account_id not in shown:
                continue
            if _is_cash_sweep(tk, t.name):
                continue

            fallback = avg_cost.get(key)
            parts: list[tuple[Decimal, Decimal | None, date | None, str]] = []
            for lot in taken:
                if lot.cost is not None:
                    parts.append((lot.qty, lot.cost, lot.acquired, "lots"))
                else:
                    parts.append((lot.qty, fallback * lot.qty if fallback else None, lot.acquired, "estimated"))
            if uncovered > _EPS:
                parts.append((uncovered, fallback * uncovered if fallback else None, None, "estimated"))

            st = lt = unk = _ZERO
            basis = _ZERO
            missing_qty = _ZERO
            sources = set()
            for q, cost, acquired, src in parts:
                p = proceeds * q / qty
                if cost is None:
                    missing_qty += q
                    continue
                g = p - cost
                basis += cost
                sources.add(src)
                if acquired is None:
                    unk += g
                elif _is_long_term(acquired, d):
                    lt += g
                else:
                    st += g

            covered_qty = qty - missing_qty
            gain = st + lt + unk
            terms = [n for n, v in (("short", st), ("long", lt), ("unknown", unk)) if v != 0]
            wash = gain < 0 and any(
                abs((bd - d).days) <= _WASH_DAYS and not (bd == d and ba == t.account_id)
                for bd, ba in buys_by_ticker.get(tk, [])
            )
            sales.append({
                "date": d.isoformat(),
                "account_id": str(t.account_id),
                "account_name": acct_name.get(t.account_id),
                "ticker": tk,
                "name": t.name,
                "quantity": _qty(qty),
                "proceeds": _money(proceeds),
                "matched_proceeds": _money(proceeds * covered_qty / qty),
                "cost_basis": _money(basis) if covered_qty > 0 else None,
                "gain": _money(gain) if covered_qty > 0 else None,
                "short_term": _money(st),
                "long_term": _money(lt),
                "unknown_term": _money(unk),
                "term": terms[0] if len(terms) == 1 else ("mixed" if terms else None),
                "basis_source": None if not sources else ("estimated" if "estimated" in sources else "lots"),
                "missing_basis_proceeds": _money(proceeds * missing_qty / qty) if missing_qty > 0 else None,
                "possible_wash_sale": wash,
            })

    def bucket(field: str) -> dict:
        vals = [Decimal(s[field]) for s in sales]
        g = sum((v for v in vals if v > 0), _ZERO)
        l = sum((v for v in vals if v < 0), _ZERO)
        return {"gains": _money(g), "losses": _money(l), "net": _money(g + l)}

    sales.sort(key=lambda s: s["date"], reverse=True)
    st_b, lt_b, unk_b = bucket("short_term"), bucket("long_term"), bucket("unknown_term")
    missing = [s for s in sales if s["missing_basis_proceeds"]]

    # ── Harvest candidates ──────────────────────────────────────────────────
    wash_cutoff = today - timedelta(days=_WASH_DAYS)
    candidates = []
    for h in holdings:
        if h.account_id not in shown or treatment.get(h.account_id) not in ("taxable", "crypto"):
            continue
        value = h.current_value or _ZERO
        cost = h.cost_basis or _ZERO
        qty = h.quantity or _ZERO
        if qty <= 0 or cost <= 0 or value <= 0 or cost - value < 1:
            continue
        tk = _ticker(h.ticker_symbol)
        if (h.asset_class or "").lower() == "cash" or _is_cash_sweep(tk, h.name):
            continue
        open_lots = lots.get((h.account_id, tk), [])
        terms = {
            "unknown" if l.acquired is None else "long" if _is_long_term(l.acquired, today) else "short"
            for l in open_lots if l.qty > _EPS
        }
        if sum((l.qty for l in open_lots), _ZERO) < qty * Decimal("0.98"):
            # Shares bought before the history began: long-term once that's a year back
            terms.add("long" if history_start and _is_long_term(history_start, today) else "unknown")
        known = terms - {"unknown"}
        term = known.pop() if len(known) == 1 else "mixed" if known else None
        recent = sorted(
            ((bd, ba) for bd, ba in buys_by_ticker.get(tk, []) if bd >= wash_cutoff),
            reverse=True,
        ) if tk else []
        candidates.append({
            "account_id": str(h.account_id),
            "account_name": acct_name.get(h.account_id),
            "treatment": treatment[h.account_id],
            "ticker": tk or None,
            "name": h.name,
            "quantity": _qty(qty),
            "value": _money(value),
            "cost_basis": _money(cost),
            "loss": _money(value - cost),
            "loss_pct": float((value - cost) / cost),
            "term": term,
            "recent_buy": {
                "date": recent[0][0].isoformat(),
                "account_name": acct_name.get(recent[0][1]),
                "clear_on": (recent[0][0] + timedelta(days=_WASH_DAYS + 1)).isoformat(),
            } if recent else None,
        })
    candidates.sort(key=lambda c: Decimal(c["loss"]))

    # ── Fees ────────────────────────────────────────────────────────────────
    commissions = account_fees = margin = _ZERO
    trades_with_fees = 0
    fees_by_account: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for t in txns:
        d = _day(t.date)
        if t.account_id not in shown or d < year_start or d > year_end:
            continue
        if t.fees and t.fees > 0:
            commissions += t.fees
            trades_with_fees += 1
            fees_by_account[t.account_id] += t.fees
        notes = (t.notes or "").lower()
        if t.type == "other" and notes.startswith("plaid: fee/"):
            # Plaid signs charges positive and refunds negative
            amt = t.amount or _ZERO
            if "margin" in notes:
                margin += amt
            else:
                account_fees += amt
            fees_by_account[t.account_id] += amt

    return {
        "year": year,
        "as_of": today.isoformat(),
        "history_start": history_start.isoformat() if history_start else None,
        "accounts": [
            {"id": str(a.id), "name": a.name, "treatment": treatment[a.id]}
            for a in all_accounts if a.id in shown
        ],
        "realized": {
            "short_term": st_b,
            "long_term": lt_b,
            "unknown_term": unk_b,
            "net": _money(sum((Decimal(b["net"]) for b in (st_b, lt_b, unk_b)), _ZERO)),
            "proceeds": _money(sum((Decimal(s["proceeds"]) for s in sales), _ZERO)),
            "estimated_count": sum(1 for s in sales if s["basis_source"] == "estimated"),
            "missing_basis_count": len(missing),
            "missing_basis_proceeds": _money(sum((Decimal(s["missing_basis_proceeds"]) for s in missing), _ZERO)),
            "sales": sales,
        },
        "harvest": {
            "total_loss": _money(sum((Decimal(c["loss"]) for c in candidates), _ZERO)),
            "candidates": candidates,
        },
        "fees": {
            "commissions": _money(commissions),
            "account_fees": _money(account_fees),
            "margin_interest": _money(margin),
            "total": _money(commissions + account_fees + margin),
            "trades_with_fees": trades_with_fees,
            "by_account": sorted(
                ({"account_name": acct_name.get(k), "amount": _money(v)} for k, v in fees_by_account.items() if v != 0),
                key=lambda r: -Decimal(r["amount"]),
            ),
        },
    }
