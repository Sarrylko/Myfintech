"""Portfolio value over time, from the daily investment snapshots.

Values come from investment_value_snapshots (one row per account per day) and
positions from holding_value_snapshots. Both only exist from the day the
snapshot task started writing them, so history is short at first and can't
be backfilled.

External cash flows are read from investment_transactions at query time,
since Plaid delivers deposits days late: transfer_in counts as money added
and transfer_out as money taken out, by the transaction's absolute amount.
Securities moved in kind with no amount recorded are missed, and show up as
growth instead.

Growth is the change in value not explained by those flows. The return is
time-weighted: each day's growth is chained so deposits don't count as
performance.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.investment import HoldingValueSnapshot, InvestmentTransaction, InvestmentValueSnapshot

_INVESTMENT_TYPES = ("investment", "brokerage")
_INFLOW = "transfer_in"
_OUTFLOW = "transfer_out"


def _money(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.01")))


async def build_investment_history(
    db: AsyncSession,
    household_id: uuid.UUID,
    account_ids: list[uuid.UUID] | None,
    days: int | None,
) -> dict:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days) if days else None

    acct_q = select(Account.id).where(
        Account.household_id == household_id, Account.type.in_(_INVESTMENT_TYPES),
    )
    if account_ids:
        acct_q = acct_q.where(Account.id.in_(account_ids))
    ids = list((await db.execute(acct_q)).scalars().all())

    empty = {
        "as_of": today.isoformat(), "history_start": None, "series": [],
        "securities": [], "positions": [], "summary": None,
    }
    if not ids:
        return empty

    snap_q = select(InvestmentValueSnapshot).where(
        InvestmentValueSnapshot.household_id == household_id,
        InvestmentValueSnapshot.account_id.in_(ids),
    )
    if start:
        snap_q = snap_q.where(InvestmentValueSnapshot.snapshot_date >= start)
    snaps = (await db.execute(snap_q.order_by(InvestmentValueSnapshot.snapshot_date))).scalars().all()
    if not snaps:
        return empty

    dates = sorted({s.snapshot_date for s in snaps})
    first = dates[0]

    by_day: dict[date, dict[uuid.UUID, InvestmentValueSnapshot]] = defaultdict(dict)
    for s in snaps:
        by_day[s.snapshot_date][s.account_id] = s

    # ── External cash flows, bucketed onto the snapshot they precede ───────
    flow_rows = (await db.execute(
        select(InvestmentTransaction.date, InvestmentTransaction.type, InvestmentTransaction.amount).where(
            InvestmentTransaction.account_id.in_(ids),
            InvestmentTransaction.type.in_((_INFLOW, _OUTFLOW)),
            InvestmentTransaction.date > datetime.combine(first, datetime.max.time(), tzinfo=timezone.utc),
        )
    )).all()
    flows: dict[date, Decimal] = defaultdict(Decimal)
    for when, kind, amount in flow_rows:
        d = when.date()
        # A flow lands on the first snapshot taken on or after it; flows after
        # the latest snapshot aren't in any value yet
        target = next((x for x in dates if x >= d), None)
        if target is None:
            continue
        amt = abs(amount or Decimal(0))
        flows[target] += amt if kind == _INFLOW else -amt

    # ── Daily totals; an account missing a day keeps its last value ────────
    last: dict[uuid.UUID, InvestmentValueSnapshot] = {}
    series = []
    for d in dates:
        last.update(by_day[d])
        value = sum((s.market_value for s in last.values()), Decimal(0))
        costs = [s.cost_basis for s in last.values() if s.cost_basis is not None]
        series.append({
            "date": d.isoformat(),
            "value": value,
            "cost_basis": sum(costs, Decimal(0)) if costs else None,
            "net_flow": flows.get(d, Decimal(0)),
            "accounts": {str(aid): _money(s.market_value) for aid, s in last.items()},
        })

    # ── Summary ─────────────────────────────────────────────────────────────
    start_value = series[0]["value"]
    end_value = series[-1]["value"]
    contributions = sum((r["net_flow"] for r in series[1:]), Decimal(0))
    growth = end_value - start_value - contributions

    twr = 1.0
    for prev, cur in zip(series, series[1:]):
        if prev["value"] > 0:
            twr *= float((cur["value"] - cur["net_flow"]) / prev["value"])
    peak = max(series, key=lambda r: r["value"])
    drawdown = float(end_value / peak["value"] - 1) if peak["value"] > 0 else 0.0

    # ── Positions behind each day, for allocation over time ─────────────────
    pos_q = select(HoldingValueSnapshot).where(
        HoldingValueSnapshot.household_id == household_id,
        HoldingValueSnapshot.account_id.in_(ids),
        HoldingValueSnapshot.snapshot_date >= first,
    )
    pos_rows = (await db.execute(pos_q)).scalars().all()
    sec_index: dict[tuple, int] = {}
    securities = []
    per_day: dict[date, dict[int, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for p in pos_rows:
        key = (str(p.account_id), p.ticker_symbol, p.name, p.asset_class)
        idx = sec_index.get(key)
        if idx is None:
            idx = sec_index[key] = len(securities)
            securities.append({
                "account_id": key[0], "ticker_symbol": p.ticker_symbol,
                "name": p.name, "asset_class": p.asset_class,
            })
        per_day[p.snapshot_date][idx] += p.market_value
    positions = [
        {"date": d.isoformat(), "values": [[i, _money(v)] for i, v in sorted(per_day[d].items())]}
        for d in dates if d in per_day
    ]

    return {
        "as_of": today.isoformat(),
        "history_start": first.isoformat(),
        "series": [
            {
                **r,
                "value": _money(r["value"]),
                "cost_basis": _money(r["cost_basis"]) if r["cost_basis"] is not None else None,
                "net_flow": _money(r["net_flow"]),
            }
            for r in series
        ],
        "securities": securities,
        "positions": positions,
        "summary": {
            "start_value": _money(start_value),
            "end_value": _money(end_value),
            "contributions": _money(contributions),
            "growth": _money(growth),
            "time_weighted_return": twr - 1 if len(series) > 1 else None,
            "all_time_high": _money(peak["value"]),
            "all_time_high_date": peak["date"],
            "drawdown": drawdown,
            "days": (dates[-1] - first).days,
        },
    }
