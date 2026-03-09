"""
Job state management for ingest_jobs table.
Provides create/start/complete/fail helpers and a status query.
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from app.db import engine

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_job(
    job_type: str,
    source_key: str | None = None,
    triggered_by: str = "api",
    dry_run: bool = False,
) -> str:
    """Insert a new job row in 'queued' state. Returns the job_id correlation string."""
    job_id = str(uuid.uuid4())
    with engine().connect() as conn:
        conn.execute(
            text("""
                INSERT INTO ingest_jobs
                  (job_type, source_key, status, triggered_by, job_id, dry_run, created_at)
                VALUES
                  (:jt, :sk, 'queued', :tb, :jid, :dr, now())
            """),
            {"jt": job_type, "sk": source_key, "tb": triggered_by, "jid": job_id, "dr": dry_run},
        )
        conn.commit()
    return job_id


def start_job(job_id: str) -> None:
    with engine().connect() as conn:
        conn.execute(
            text("""
                UPDATE ingest_jobs
                SET status = 'running', started_at = now(), attempts = attempts + 1
                WHERE job_id = :jid
            """),
            {"jid": job_id},
        )
        conn.commit()


def complete_job(job_id: str, points_upserted: int = 0, points_deleted: int = 0, rows_processed: int = 0) -> None:
    with engine().connect() as conn:
        conn.execute(
            text("""
                UPDATE ingest_jobs
                SET status = 'succeeded',
                    completed_at = now(),
                    points_upserted = :pu,
                    points_deleted = :pd,
                    rows_processed = :rp
                WHERE job_id = :jid
            """),
            {"jid": job_id, "pu": points_upserted, "pd": points_deleted, "rp": rows_processed},
        )
        conn.commit()


def fail_job(job_id: str, error: str) -> None:
    with engine().connect() as conn:
        conn.execute(
            text("""
                UPDATE ingest_jobs
                SET status = 'failed', completed_at = now(), error_message = :err
                WHERE job_id = :jid
            """),
            {"jid": job_id, "err": error[:2000]},
        )
        conn.commit()


def get_job(job_id: str) -> dict | None:
    with engine().connect() as conn:
        row = conn.execute(
            text("SELECT * FROM ingest_jobs WHERE job_id = :jid"),
            {"jid": job_id},
        ).fetchone()
    if not row:
        return None
    return dict(row._mapping)


def get_recent_jobs(limit: int = 20) -> list[dict]:
    with engine().connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM ingest_jobs ORDER BY created_at DESC LIMIT :n"),
            {"n": limit},
        ).fetchall()
    return [dict(r._mapping) for r in rows]
