"""
MyFintech Ingest Worker
MCP-style ingestion service with incremental DB sync, file watching, and job tracking.

Endpoints:
  GET  /health
  GET  /ready
  POST /sync/db
  POST /sync/files
  POST /reindex/source/{key}
  POST /reindex/all
  GET  /status
  GET  /status/job/{job_id}
  POST /dry-run/db
  POST /dry-run/files
"""
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException, Request

from app.checkpoints import (
    clear_all_checkpoints,
    clear_checkpoint,
    get_all_checkpoints,
    get_checkpoint,
    set_checkpoint,
)
from app.config import settings
from app.db import engine
from app.embedder import ollama_ready
from app.ingest.db_sources import TABLE_SOURCES
from app.ingest.doc_sources import (
    ingest_business_documents,
    ingest_financial_documents,
    ingest_property_documents,
)
from app.ingest.summary import generate_summary_chunks
from app.jobs import (
    complete_job,
    create_job,
    fail_job,
    get_job,
    get_recent_jobs,
    start_job,
)
from app.scheduler import start_scheduler, stop_scheduler
from app.vector_store import (
    collection_count,
    delete_by_record_id,
    delete_by_stored_filename,
    ensure_collections,
    get_all_record_ids,
    upsert_points,
)
from app.watcher import start_watcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger(__name__)

# Prevent concurrent ingest runs (one per type)
_db_lock = threading.Lock()
_files_lock = threading.Lock()


# ── Core ingest runners ───────────────────────────────────────────────────────

def _run_db_sync(triggered_by: str = "scheduler", dry_run: bool = False) -> str:
    """Incremental DB sync. Returns job_id."""
    job_id = create_job("sync_db", triggered_by=triggered_by, dry_run=dry_run)
    if not _db_lock.acquire(blocking=False):
        log.info("DB sync already running — skipping (job_id=%s)", job_id)
        fail_job(job_id, "Another DB sync is already running")
        return job_id

    def _run():
        start_job(job_id)
        total_upserted = 0
        total_skipped = 0
        total_deleted = 0
        total_rows = 0
        now = datetime.now(timezone.utc)
        all_points: list = []

        try:
            for source_key, meta in TABLE_SOURCES.items():
                since = get_checkpoint(f"db:{source_key}") if meta["watermark_col"] else None
                try:
                    with engine().connect() as conn:
                        fn = meta["fn"]
                        fn(conn, all_points, since)
                except Exception as e:
                    log.warning("DB source '%s' failed: %s", source_key, e)

            # Append summary chunks (always full recompute)
            summaries = generate_summary_chunks(all_points)
            all_points.extend(summaries)

            # Upsert all with hash-skip
            if all_points:
                ups, skipped = upsert_points(all_points, settings.qdrant_collection_db, dry_run=dry_run)
                total_upserted = ups
                total_skipped = skipped
                total_rows = len(all_points) - len(summaries)

            # Update checkpoints for watermarked sources
            if not dry_run:
                for source_key, meta in TABLE_SOURCES.items():
                    if meta["watermark_col"]:
                        set_checkpoint(f"db:{source_key}", now)

            # Reconcile deletions (hourly is fine; do it every sync run for simplicity)
            for source_key, meta in TABLE_SOURCES.items():
                if meta["watermark_col"] is None:
                    continue  # aggregate tables don't have individual record IDs
                try:
                    _reconcile_db_deletions(source_key, dry_run)
                except Exception as e:
                    log.warning("Reconcile deletions for '%s' failed: %s", source_key, e)

            complete_job(job_id, points_upserted=total_upserted, points_deleted=total_deleted, rows_processed=total_rows)
            log.info("DB sync done — upserted=%d skipped=%d deleted=%d (job=%s)", total_upserted, total_skipped, total_deleted, job_id)
        except Exception as e:
            log.exception("DB sync failed (job=%s): %s", job_id, e)
            fail_job(job_id, str(e))
        finally:
            _db_lock.release()

    threading.Thread(target=_run, daemon=True, name=f"db-sync-{job_id[:8]}").start()
    return job_id


def _reconcile_db_deletions(source_key: str, dry_run: bool = False) -> int:
    """Delete Qdrant points for records that no longer exist in Postgres."""
    from sqlalchemy import text
    # Get live IDs from Postgres
    table = source_key  # source_key matches table name for most
    id_column = "id"
    with engine().connect() as conn:
        try:
            rows = conn.execute(text(f"SELECT {id_column}::text FROM {table}")).fetchall()
        except Exception:
            return 0
    live_ids = {str(r[0]) for r in rows}
    qdrant_ids = get_all_record_ids(source_key, settings.qdrant_collection_db)
    orphans = qdrant_ids - live_ids
    deleted = 0
    for rid in orphans:
        deleted += delete_by_record_id(rid, settings.qdrant_collection_db, dry_run=dry_run)
    if orphans:
        log.info("Reconcile '%s': %d orphans deleted", source_key, deleted)
    return deleted


def _run_file_sync(triggered_by: str = "scheduler", dry_run: bool = False) -> str:
    """File reconciliation sync. Returns job_id."""
    job_id = create_job("sync_files", triggered_by=triggered_by, dry_run=dry_run)
    if not _files_lock.acquire(blocking=False):
        log.info("File sync already running — skipping (job_id=%s)", job_id)
        fail_job(job_id, "Another file sync is already running")
        return job_id

    def _run():
        start_job(job_id)
        total_upserted = 0
        total_deleted = 0
        now = datetime.now(timezone.utc)
        all_points: list = []

        try:
            since_fin = get_checkpoint("doc:financial_documents")
            since_prop = get_checkpoint("doc:property_documents")
            since_biz = get_checkpoint("doc:business_documents")

            with engine().connect() as conn:
                try:
                    ingest_financial_documents(conn, all_points, since_fin)
                except Exception as e:
                    log.warning("Financial doc ingest failed: %s", e)
                try:
                    ingest_property_documents(conn, all_points, since_prop)
                except Exception as e:
                    log.warning("Property doc ingest failed: %s", e)
                try:
                    ingest_business_documents(conn, all_points, since_biz)
                except Exception as e:
                    log.warning("Business doc ingest failed: %s", e)

            if all_points:
                ups, _ = upsert_points(all_points, settings.qdrant_collection_docs, dry_run=dry_run)
                total_upserted = ups

            if not dry_run:
                set_checkpoint("doc:financial_documents", now)
                set_checkpoint("doc:property_documents", now)
                set_checkpoint("doc:business_documents", now)

            complete_job(job_id, points_upserted=total_upserted, points_deleted=total_deleted, rows_processed=len(all_points))
            log.info("File sync done — upserted=%d (job=%s)", total_upserted, job_id)
        except Exception as e:
            log.exception("File sync failed (job=%s): %s", job_id, e)
            fail_job(job_id, str(e))
        finally:
            _files_lock.release()

    threading.Thread(target=_run, daemon=True, name=f"file-sync-{job_id[:8]}").start()
    return job_id


def _handle_file_upsert(path: str) -> None:
    """Called by watcher when a file is created or modified."""
    log.info("Watcher: upsert triggered for %s", path)
    _run_file_sync(triggered_by="watcher")


def _handle_file_delete(path: str) -> None:
    """Called by watcher when a file is deleted."""
    stored_filename = Path(path).name
    log.info("Watcher: delete triggered for %s", stored_filename)
    job_id = create_job("sync_files", triggered_by="watcher")
    start_job(job_id)
    try:
        deleted = delete_by_stored_filename(stored_filename)
        complete_job(job_id, points_deleted=deleted)
        log.info("Watcher: deleted %d chunks for %s (job=%s)", deleted, stored_filename, job_id)
    except Exception as e:
        fail_job(job_id, str(e))


# ── FastAPI app ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Ingest worker starting...")
    ensure_collections()

    # Trigger initial DB sync if collections are empty
    if collection_count(settings.qdrant_collection_db) == 0:
        log.info("DB collection empty — triggering initial sync")
        _run_db_sync(triggered_by="startup")
    if collection_count(settings.qdrant_collection_docs) == 0:
        log.info("Docs collection empty — triggering initial file sync")
        _run_file_sync(triggered_by="startup")

    # Start APScheduler for periodic syncs
    start_scheduler(
        db_sync_fn=lambda: _run_db_sync(triggered_by="scheduler"),
        file_reconcile_fn=lambda: _run_file_sync(triggered_by="scheduler"),
    )

    # Start file watcher
    if settings.file_watch_enabled:
        start_watcher(_handle_file_upsert, _handle_file_delete)

    yield

    stop_scheduler()
    log.info("Ingest worker shut down.")


app = FastAPI(title="MyFintech Ingest Worker", lifespan=lifespan)


# ── Auth guard ────────────────────────────────────────────────────────────────

def _check_auth(x_ingest_api_key: str | None) -> None:
    if not settings.ingest_api_key:
        return  # disabled
    if x_ingest_api_key != settings.ingest_api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Ingest-Api-Key")


# ── Liveness / Readiness ──────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    postgres_ok = False
    qdrant_ok = False
    ollama_ok = ollama_ready()
    try:
        with engine().connect() as conn:
            conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        postgres_ok = True
    except Exception:
        pass
    try:
        collection_count(settings.qdrant_collection_db)
        qdrant_ok = True
    except Exception:
        pass
    status = "ready" if (postgres_ok and qdrant_ok and ollama_ok) else "degraded"
    return {"status": status, "postgres": postgres_ok, "qdrant": qdrant_ok, "ollama": ollama_ok}


# ── Sync endpoints ────────────────────────────────────────────────────────────

@app.post("/sync/db")
async def sync_db(x_ingest_api_key: str | None = Header(None)):
    _check_auth(x_ingest_api_key)
    job_id = _run_db_sync(triggered_by="api")
    return {"job_id": job_id, "status": "queued"}


@app.post("/sync/files")
async def sync_files(x_ingest_api_key: str | None = Header(None)):
    _check_auth(x_ingest_api_key)
    job_id = _run_file_sync(triggered_by="api")
    return {"job_id": job_id, "status": "queued"}


# ── Re-index endpoints ────────────────────────────────────────────────────────

@app.post("/reindex/source/{key}")
async def reindex_source(key: str, x_ingest_api_key: str | None = Header(None)):
    _check_auth(x_ingest_api_key)
    if key not in TABLE_SOURCES and key not in ("financial_documents", "property_documents", "business_documents"):
        raise HTTPException(status_code=404, detail=f"Unknown source key: {key}")
    clear_checkpoint(f"db:{key}")
    if key in TABLE_SOURCES:
        job_id = _run_db_sync(triggered_by="api")
    else:
        clear_checkpoint(f"doc:{key}")
        job_id = _run_file_sync(triggered_by="api")
    return {"job_id": job_id, "status": "queued", "source_key": key}


@app.post("/reindex/all")
async def reindex_all(x_ingest_api_key: str | None = Header(None)):
    _check_auth(x_ingest_api_key)
    clear_all_checkpoints()
    db_job = _run_db_sync(triggered_by="api")
    file_job = _run_file_sync(triggered_by="api")
    return {"db_job_id": db_job, "file_job_id": file_job, "status": "queued"}


# ── Dry-run endpoints ─────────────────────────────────────────────────────────

@app.post("/dry-run/db")
async def dry_run_db(x_ingest_api_key: str | None = Header(None)):
    _check_auth(x_ingest_api_key)
    job_id = _run_db_sync(triggered_by="api", dry_run=True)
    return {"job_id": job_id, "status": "queued", "dry_run": True}


@app.post("/dry-run/files")
async def dry_run_files(x_ingest_api_key: str | None = Header(None)):
    _check_auth(x_ingest_api_key)
    job_id = _run_file_sync(triggered_by="api", dry_run=True)
    return {"job_id": job_id, "status": "queued", "dry_run": True}


# ── Status endpoints ──────────────────────────────────────────────────────────

@app.get("/status")
async def status():
    jobs = get_recent_jobs(limit=20)
    checkpoints = get_all_checkpoints()
    return {
        "recent_jobs": [
            {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in j.items()}
            for j in jobs
        ],
        "checkpoints": checkpoints,
        "qdrant": {
            "db_collection_points": collection_count(settings.qdrant_collection_db),
            "doc_collection_points": collection_count(settings.qdrant_collection_docs),
        },
    }


@app.get("/status/job/{job_id}")
async def status_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in job.items()}
