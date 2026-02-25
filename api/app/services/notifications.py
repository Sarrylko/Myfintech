"""
Notification service — generates and sends WhatsApp alerts.

All functions are synchronous (for Celery tasks) and use a fresh SQLAlchemy
sync session per call.  Each function is also registered as a Celery task
so it can be triggered manually from the CLI for testing.

Scheduled tasks (via celery beat):
  send_daily_summary      — 08:00 UTC daily
  check_budget_alerts     — 09:00 UTC daily
  check_bill_reminders    — 09:05 UTC daily

On-demand task:
  notify_new_transactions(household_id, count)  — called after sync
"""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import create_engine, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.account import Category, Transaction
from app.models.budget import Budget
from app.models.networth import NetWorthSnapshot
from app.models.property import Property
from app.models.property_cost_status import PropertyCostStatus
from app.models.user import Household, User
from app.services.whatsapp import send_whatsapp_bulk
from app.worker import celery_app

logger = logging.getLogger(__name__)

_engine = create_engine(settings.database_url_sync, pool_pre_ping=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _phones_for_household(db: Session, household_id: uuid.UUID) -> list[str]:
    """Return all non-null phone numbers for members of a household."""
    rows = db.execute(
        select(User.phone).where(
            User.household_id == household_id,
            User.phone.isnot(None),
            User.is_active == True,  # noqa: E712
        )
    ).scalars().all()
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
            phones = _phones_for_household(db, hid)
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
            phones = _phones_for_household(db, hid)
            if not phones:
                continue

            budgets = db.execute(
                select(Budget)
                .where(
                    BudgetModel.household_id == hid,
                    BudgetModel.year == today.year,
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
            phones = _phones_for_household(db, hid)
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
        phones = _phones_for_household(db, uuid.UUID(household_id))
        if phones:
            msg = f"💳 {count} new transaction{'s' if count != 1 else ''} synced to MyFinTech"
            send_whatsapp_bulk(phones, msg)
