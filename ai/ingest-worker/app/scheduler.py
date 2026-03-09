"""
APScheduler wrapper — runs DB sync and file reconcile on intervals.
Uses IntervalTrigger with max_instances=1 and coalesce=True to prevent overlap.
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone="UTC")
    return _scheduler


def start_scheduler(db_sync_fn, file_reconcile_fn) -> None:
    sched = get_scheduler()

    sched.add_job(
        db_sync_fn,
        trigger=IntervalTrigger(seconds=settings.db_sync_interval_seconds),
        id="db_sync",
        name="Incremental DB sync",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    log.info("Scheduled DB sync every %ds", settings.db_sync_interval_seconds)

    sched.add_job(
        file_reconcile_fn,
        trigger=IntervalTrigger(seconds=settings.file_reconcile_interval_seconds),
        id="file_reconcile",
        name="File reconciliation",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    log.info("Scheduled file reconcile every %ds", settings.file_reconcile_interval_seconds)

    sched.start()
    log.info("APScheduler started")


def stop_scheduler() -> None:
    sched = get_scheduler()
    if sched.running:
        sched.shutdown(wait=False)
        log.info("APScheduler stopped")


def run_now(job_id: str) -> None:
    """Trigger a scheduled job immediately (for API-driven runs)."""
    sched = get_scheduler()
    sched.get_job(job_id).trigger = IntervalTrigger(seconds=1)
