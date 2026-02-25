from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "myfintech",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# ─── Scheduled tasks ──────────────────────────
celery_app.conf.beat_schedule = {
    "sync-transactions-daily": {
        "task": "app.services.sync.sync_all_items",
        "schedule": crontab(hour=6, minute=0),
    },
    "net-worth-snapshot-daily": {
        "task": "app.services.networth.take_snapshot_all",
        "schedule": crontab(hour=7, minute=0),
    },
    "refresh-property-valuations-weekly": {
        "task": "app.services.property.refresh_valuations",
        "schedule": crontab(hour=8, minute=0, day_of_week=1),
    },
    "refresh-investment-prices": {
        "task": "app.services.price_refresh.refresh_investment_prices",
        "schedule": crontab(minute="*/5"),  # every 5 min; task handles per-household interval check
    },
    # ── WhatsApp notifications ──────────────────
    "send-daily-summary": {
        "task": "app.services.notifications.send_daily_summary",
        "schedule": crontab(hour=8, minute=0),
    },
    "check-budget-alerts": {
        "task": "app.services.notifications.check_budget_alerts",
        "schedule": crontab(hour=9, minute=0),
    },
    "check-bill-reminders": {
        "task": "app.services.notifications.check_bill_reminders",
        "schedule": crontab(hour=9, minute=5),
    },
}

# Explicitly include task modules so the worker registers them on startup.
# autodiscover_tasks() only looks for a "tasks.py" file, which we don't use.
celery_app.conf.include = [
    "app.services.price_refresh",
    "app.services.sync",
    "app.services.networth",
    "app.services.property",
    "app.services.notifications",
]
