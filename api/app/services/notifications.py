"""
Notification service — generates and sends WhatsApp alerts.

All functions are synchronous (for Celery tasks) and use a fresh SQLAlchemy
sync session per call.  Each function is also registered as a Celery task
so it can be triggered manually from the CLI for testing.

Scheduled tasks (via celery beat):
  send_daily_summary      — 08:00 UTC daily
  check_budget_alerts     — 09:00 UTC daily
  check_bill_reminders    — 09:05 UTC daily
  send_monthly_report     — 08:30 UTC on the 1st of each month

On-demand task:
  notify_new_transactions(household_id, count)  — called after sync
"""

import calendar
import logging
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import create_engine, desc, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.account import Category, Transaction
from app.models.budget import Budget
from app.models.networth import NetWorthSnapshot
from app.models.property import Property
from app.models.property_cost_status import PropertyCostStatus
from app.models.snaptrade import SnapTradeConnection  # noqa: F401 — ensures Account mapper resolves this relationship
from app.models.user import Household, User
from app.services.whatsapp import send_whatsapp_bulk
from app.worker import celery_app

logger = logging.getLogger(__name__)

_engine = create_engine(settings.database_url_sync, pool_pre_ping=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _phones_for_household(
    db: Session,
    household_id: uuid.UUID,
    notif_field: str | None = None,
) -> list[str]:
    """Return phone numbers for active household members who have the given
    notification type enabled (or all phones if notif_field is None)."""
    conditions = [
        User.household_id == household_id,
        User.phone.isnot(None),
        User.is_active == True,  # noqa: E712
    ]
    if notif_field:
        conditions.append(getattr(User, notif_field) == True)  # noqa: E712
    rows = db.execute(select(User.phone).where(*conditions)).scalars().all()
    return [p for p in rows if p]


def _fmt_currency(value: Decimal | None) -> str:
    if not value:
        return "$0"
    val = float(value)
    if abs(val) >= 1_000_000:
        return f"${val/1_000_000:.1f}M"
    if abs(val) >= 1_000:
        return f"${val/1_000:.1f}K"
    return f"${val:,.0f}"


# ── Daily summary ─────────────────────────────────────────────────────────────

@celery_app.task(name="app.services.notifications.send_daily_summary")
def send_daily_summary():
    """08:00 UTC — net worth Δ + top spending categories + unpaid bills."""
    logger.info("Sending daily summary notifications")

    today = datetime.now(timezone.utc)
    month_start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    with Session(_engine) as db:
        household_ids = db.execute(select(Household.id)).scalars().all()

        for hid in household_ids:
            phones = _phones_for_household(db, hid, "notif_daily_summary")
            if not phones:
                continue

            # Net worth: latest snapshot vs previous
            snapshots = db.execute(
                select(NetWorthSnapshot)
                .where(NetWorthSnapshot.household_id == hid)
                .order_by(NetWorthSnapshot.snapshot_date.desc())
                .limit(2)
            ).scalars().all()

            nw_line = ""
            if snapshots:
                latest_nw = snapshots[0].net_worth
                if len(snapshots) > 1:
                    delta = latest_nw - snapshots[1].net_worth
                    arrow = "↑" if delta >= 0 else "↓"
                    nw_line = f"Net worth: {_fmt_currency(latest_nw)} ({arrow}{_fmt_currency(abs(delta))})"
                else:
                    nw_line = f"Net worth: {_fmt_currency(latest_nw)}"

            # Top 3 spending categories this month (expense only)
            rows = db.execute(
                select(Category.name, func.sum(Transaction.amount).label("total"))
                .join(Transaction, Transaction.custom_category_id == Category.id)
                .where(
                    Transaction.household_id == hid,
                    Transaction.date >= month_start,
                    Transaction.is_ignored == False,  # noqa: E712
                    Transaction.pending == False,       # noqa: E712
                    Category.is_income == False,        # noqa: E712
                    Transaction.amount > 0,
                )
                .group_by(Category.name)
                .order_by(func.sum(Transaction.amount).desc())
                .limit(3)
            ).all()

            spending_lines = []
            for name, total in rows:
                spending_lines.append(f"  • {name}: {_fmt_currency(total)}")

            # Unpaid bills this year
            year = today.year
            unpaid = db.execute(
                select(func.count())
                .select_from(PropertyCostStatus)
                .where(
                    PropertyCostStatus.household_id == hid,
                    PropertyCostStatus.year == year,
                    PropertyCostStatus.is_paid == False,  # noqa: E712
                )
            ).scalar() or 0

            # Build message
            lines = [f"*MyFinTech Daily Summary — {today.strftime('%b %d, %Y')}*"]
            if nw_line:
                lines.append(f"\n{nw_line}")
            if spending_lines:
                lines.append(f"\nTop spending this month:")
                lines.extend(spending_lines)
            if unpaid:
                lines.append(f"\n⏰ {unpaid} unpaid bill(s) for {year}")

            if len(lines) > 1:
                send_whatsapp_bulk(phones, "\n".join(lines))


# ── Budget alerts ─────────────────────────────────────────────────────────────

@celery_app.task(name="app.services.notifications.check_budget_alerts")
def check_budget_alerts():
    """09:00 UTC — alert when spending hits or exceeds each budget's alert threshold."""
    logger.info("Checking budget alert thresholds")

    today = datetime.now(timezone.utc)

    with Session(_engine) as db:
        household_ids = db.execute(select(Household.id)).scalars().all()

        for hid in household_ids:
            phones = _phones_for_household(db, hid, "notif_budget_alerts")
            if not phones:
                continue

            budgets = db.execute(
                select(Budget)
                .where(
                    Budget.household_id == hid,
                    Budget.year == today.year,
                )
            ).scalars().all()

            alerts = []

            for budget in budgets:
                # Determine date range
                if budget.budget_type == "monthly" and budget.month:
                    from calendar import monthrange  # noqa: PLC0415
                    _, last_day = monthrange(budget.year, budget.month)
                    start = datetime(budget.year, budget.month, 1, tzinfo=timezone.utc)
                    end = datetime(budget.year, budget.month, last_day, 23, 59, 59, tzinfo=timezone.utc)
                    if today.month != budget.month:
                        continue  # only alert on current month
                elif budget.start_date and budget.end_date:
                    start = datetime.combine(budget.start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
                    end = datetime.combine(budget.end_date, datetime.max.time()).replace(tzinfo=timezone.utc)
                else:
                    continue

                # Sum actual spending for this category in range
                spent = db.execute(
                    select(func.sum(Transaction.amount))
                    .where(
                        Transaction.household_id == hid,
                        Transaction.custom_category_id == budget.category_id,
                        Transaction.date >= start,
                        Transaction.date <= end,
                        Transaction.is_ignored == False,  # noqa: E712
                        Transaction.amount > 0,
                    )
                ).scalar() or Decimal(0)

                if budget.amount <= 0:
                    continue

                pct = int(spent / budget.amount * 100)

                if pct >= budget.alert_threshold:
                    category = db.get(Category, budget.category_id)
                    cat_name = category.name if category else "Budget"
                    emoji = "🔴" if pct >= 100 else "🟡"
                    alerts.append(
                        f"{emoji} *{cat_name}*: {pct}% used "
                        f"({_fmt_currency(spent)}/{_fmt_currency(budget.amount)})"
                    )

            if alerts:
                msg = f"*Budget Alert — {today.strftime('%b %d')}*\n\n" + "\n".join(alerts)
                send_whatsapp_bulk(phones, msg)


# ── Bill reminders ────────────────────────────────────────────────────────────

_BILL_HINTS = {
    "property_tax": "typically Apr & Oct",
    "hoa": "monthly",
    "insurance": "annual renewal",
}

_BILL_LABELS = {
    "property_tax": "Property Tax",
    "hoa": "HOA",
    "insurance": "Insurance",
}


@celery_app.task(name="app.services.notifications.check_bill_reminders")
def check_bill_reminders():
    """09:05 UTC — remind about unpaid property bills for the current year."""
    logger.info("Checking bill reminders")

    today = datetime.now(timezone.utc)
    year = today.year

    with Session(_engine) as db:
        household_ids = db.execute(select(Household.id)).scalars().all()

        for hid in household_ids:
            phones = _phones_for_household(db, hid, "notif_bill_reminders")
            if not phones:
                continue

            # Get all properties for this household
            properties = db.execute(
                select(Property).where(Property.household_id == hid)
            ).scalars().all()

            if not properties:
                continue

            prop_ids = [p.id for p in properties]
            prop_map = {p.id: p.address for p in properties}

            # Get paid statuses for current year
            paid_statuses = db.execute(
                select(PropertyCostStatus).where(
                    PropertyCostStatus.household_id == hid,
                    PropertyCostStatus.year == year,
                    PropertyCostStatus.is_paid == True,  # noqa: E712
                )
            ).scalars().all()
            paid_set = {(s.property_id, s.category) for s in paid_statuses}

            reminders = []
            for prop_id in prop_ids:
                address = prop_map[prop_id]
                short_addr = address.split(",")[0] if address else "Property"
                for cat in ("property_tax", "hoa", "insurance"):
                    if (prop_id, cat) not in paid_set:
                        label = _BILL_LABELS[cat]
                        hint = _BILL_HINTS[cat]
                        reminders.append(f"  ⏰ *{label}* at {short_addr} ({hint})")

            if reminders:
                msg = (
                    f"*Unpaid Bills — {year}*\n\n"
                    + "\n".join(reminders)
                    + "\n\nMark paid in the Properties tab."
                )
                send_whatsapp_bulk(phones, msg)


# ── New transactions ──────────────────────────────────────────────────────────

@celery_app.task(name="app.services.notifications.notify_new_transactions")
def notify_new_transactions(household_id: str, count: int):
    """Called after a transaction sync completes for a household."""
    if count <= 0:
        return

    with Session(_engine) as db:
        phones = _phones_for_household(db, uuid.UUID(household_id), "notif_transaction_alerts")
        if phones:
            msg = f"💳 {count} new transaction{'s' if count != 1 else ''} synced to MyFinTech"
            send_whatsapp_bulk(phones, msg)


# ── Monthly report ─────────────────────────────────────────────────────────────

@celery_app.task(name="app.services.notifications.send_monthly_report")
def send_monthly_report():
    """08:30 UTC on the 1st of each month — Rocket Money-style report for the prior month."""
    today = datetime.now(timezone.utc)

    # --- Previous month date range ---
    prev_year  = today.year if today.month > 1 else today.year - 1
    prev_month = today.month - 1 if today.month > 1 else 12
    month_start = date(prev_year, prev_month, 1)
    month_end   = date(today.year, today.month, 1)   # exclusive

    # --- 6-month history window for averages ---
    hist_month = prev_month - 6
    hist_year  = prev_year
    if hist_month <= 0:
        hist_month += 12
        hist_year  -= 1
    history_start = date(hist_year, hist_month, 1)

    month_name = calendar.month_name[prev_month]

    with Session(_engine) as db:
        households = db.execute(select(Household)).scalars().all()
        for hh in households:
            try:
                _send_monthly_report_for_household(
                    db, hh.id, month_name, prev_year, prev_month,
                    month_start, month_end, history_start,
                )
            except Exception:
                logger.exception("Monthly report failed for household %s", hh.id)


def _send_monthly_report_for_household(
    db: Session,
    hh_id: uuid.UUID,
    month_name: str,
    prev_year: int,
    prev_month: int,
    month_start: date,
    month_end: date,
    history_start: date,
) -> None:
    phones = _phones_for_household(db, hh_id, "notif_monthly_report")
    if not phones:
        return

    # ── 1. Total spend (prev month, expense categories only) ──────────────────
    total_spend: Decimal = db.execute(
        select(func.sum(Transaction.amount))
        .join(Category, Transaction.custom_category_id == Category.id)
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            Transaction.amount > 0,
            Category.is_income == False,       # noqa: E712
        )
    ).scalar() or Decimal(0)

    # ── 2. Income (prev month) ────────────────────────────────────────────────
    total_income: Decimal = db.execute(
        select(func.sum(Transaction.amount))
        .join(Category, Transaction.custom_category_id == Category.id)
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            Transaction.amount > 0,
            Category.is_income == True,        # noqa: E712
        )
    ).scalar() or Decimal(0)

    # ── 3. Average monthly spend (6-month history, grouped by month) ──────────
    hist_rows = db.execute(
        select(
            func.extract("year",  Transaction.date).label("yr"),
            func.extract("month", Transaction.date).label("mo"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.custom_category_id == Category.id)
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= history_start,
            Transaction.date < month_start,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            Transaction.amount > 0,
            Category.is_income == False,       # noqa: E712
        )
        .group_by("yr", "mo")
    ).all()
    avg_monthly: Decimal = (
        sum((r.total for r in hist_rows), Decimal(0)) / len(hist_rows)
        if hist_rows else Decimal(0)
    )

    # ── 4. Top 3 categories by spend ─────────────────────────────────────────
    top_cats = db.execute(
        select(Category.name, func.sum(Transaction.amount).label("total"))
        .join(Transaction, Transaction.custom_category_id == Category.id)
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            Transaction.amount > 0,
            Category.is_income == False,       # noqa: E712
        )
        .group_by(Category.name)
        .order_by(desc("total"))
        .limit(3)
    ).all()

    # ── 5. Biggest category changes vs 6-month average ────────────────────────
    hist_cat_rows = db.execute(
        select(
            Category.name,
            func.extract("year",  Transaction.date).label("yr"),
            func.extract("month", Transaction.date).label("mo"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Transaction, Transaction.custom_category_id == Category.id)
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= history_start,
            Transaction.date < month_start,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            Transaction.amount > 0,
            Category.is_income == False,       # noqa: E712
        )
        .group_by(Category.name, "yr", "mo")
    ).all()

    cat_months: dict[str, list[Decimal]] = defaultdict(list)
    for r in hist_cat_rows:
        cat_months[r.name].append(r.total)
    cat_avg = {n: sum(v, Decimal(0)) / len(v) for n, v in cat_months.items()}

    all_prev_cats = db.execute(
        select(Category.name, func.sum(Transaction.amount).label("total"))
        .join(Transaction, Transaction.custom_category_id == Category.id)
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            Transaction.amount > 0,
            Category.is_income == False,       # noqa: E712
        )
        .group_by(Category.name)
    ).all()

    changes = []
    for row in all_prev_cats:
        diff = row.total - cat_avg.get(row.name, Decimal(0))
        changes.append((row.name, row.total, cat_avg.get(row.name, Decimal(0)), diff))
    changes.sort(key=lambda x: abs(x[3]), reverse=True)
    biggest = changes[:3]

    # ── 6. Subscriptions (merchants repeating from prior 2 months) ────────────
    prev_merchants = db.execute(
        select(Transaction.merchant_name, func.sum(Transaction.amount).label("total"))
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.merchant_name.isnot(None),
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
            Transaction.amount > 0,
        )
        .group_by(Transaction.merchant_name)
    ).all()

    two_mo_start = month_start - timedelta(days=62)
    prior_set = set(db.execute(
        select(Transaction.merchant_name.distinct())
        .where(
            Transaction.household_id == hh_id,
            Transaction.date >= two_mo_start,
            Transaction.date < month_start,
            Transaction.merchant_name.isnot(None),
            Transaction.is_ignored == False,  # noqa: E712
            Transaction.pending == False,      # noqa: E712
        )
    ).scalars().all())

    subs = [(r.merchant_name, r.total) for r in prev_merchants if r.merchant_name in prior_set]
    sub_count = len(subs)
    sub_total: Decimal = sum((t for _, t in subs), Decimal(0))

    # ── 7. Budget performance (monthly budgets for prev month) ────────────────
    budgets = db.execute(
        select(Budget).where(
            Budget.household_id == hh_id,
            Budget.year == prev_year,
            Budget.month == prev_month,
            Budget.budget_type == "monthly",
        )
    ).scalars().all()

    budget_lines = []
    for b in budgets[:4]:
        spent: Decimal = db.execute(
            select(func.sum(Transaction.amount)).where(
                Transaction.household_id == hh_id,
                Transaction.custom_category_id == b.category_id,
                Transaction.date >= month_start,
                Transaction.date < month_end,
                Transaction.is_ignored == False,  # noqa: E712
                Transaction.pending == False,      # noqa: E712
                Transaction.amount > 0,
            )
        ).scalar() or Decimal(0)
        icon = "⚠️" if spent > b.amount else "✅"
        budget_lines.append(f"  {icon} {b.category.name}: {_fmt_currency(spent)}/{_fmt_currency(b.amount)}")

    # ── Build message ─────────────────────────────────────────────────────────
    lines = [f"*📊 {month_name} Financial Report*\n"]

    # Spend vs avg
    spend_line = f"*{_fmt_currency(total_spend)}*"
    if avg_monthly > 0:
        pct = int(abs(total_spend - avg_monthly) / avg_monthly * 100)
        arrow = "↑" if total_spend > avg_monthly else "↓"
        spend_line += f"  {arrow}{pct}% vs avg"
        lines.append(f"*💰 Total Spend*\n{spend_line}\n{_fmt_currency(avg_monthly)}/mo avg")
    else:
        lines.append(f"*💰 Total Spend*\n{spend_line}")

    # Income vs spend
    if total_income > 0:
        delta = total_income - total_spend
        sign = "Surplus: +" if delta >= 0 else "Deficit: -"
        lines.append(
            f"\n*📈 Income vs. Spend*\n"
            f"Income: {_fmt_currency(total_income)} | Spend: {_fmt_currency(total_spend)}\n"
            f"{sign}{_fmt_currency(abs(delta))}"
        )

    # Subscriptions
    if sub_count > 0:
        lines.append(f"\n*🔄 Subscriptions*\n{_fmt_currency(sub_total)} across {sub_count} recurring merchant{'s' if sub_count != 1 else ''}")

    # Top categories
    if top_cats:
        cat_lines = []
        for name, amt in top_cats:
            pct = int(amt / total_spend * 100) if total_spend > 0 else 0
            cat_lines.append(f"  • {name}: {_fmt_currency(amt)} ({pct}%)")
        lines.append("\n*📊 Top Categories*\n" + "\n".join(cat_lines))

    # Biggest changes (only show if history exists)
    if biggest and avg_monthly > 0:
        change_lines = []
        for name, amt, avg, diff in biggest:
            direction = "more" if diff > 0 else "less"
            change_lines.append(f"  • {name}: {_fmt_currency(abs(diff))} {direction} than avg")
        lines.append("\n*📉 Biggest Changes*\n" + "\n".join(change_lines))

    # Budget performance
    if budget_lines:
        lines.append("\n*📋 Budget Performance*\n" + "\n".join(budget_lines))

    lines.append("\n_View details in your MyFinTech app._")

    send_whatsapp_bulk(phones, "\n".join(lines))
