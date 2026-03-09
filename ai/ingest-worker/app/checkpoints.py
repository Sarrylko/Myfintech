"""
Per-source watermark management in the ingest_checkpoints table.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from app.config import settings
from app.db import engine

log = logging.getLogger(__name__)

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def get_checkpoint(source_key: str) -> datetime | None:
    """Return the last_seen_at watermark for a source, or None if no checkpoint exists."""
    with engine().connect() as conn:
        row = conn.execute(
            text("SELECT last_seen_at, model_version FROM ingest_checkpoints WHERE source_key = :k"),
            {"k": source_key},
        ).fetchone()
    if row is None:
        return None
    # If model version changed, treat as if no checkpoint (force full re-embed)
    if row.model_version != settings.embed_model:
        log.info(
            "Model version changed for '%s' (%s → %s) — resetting checkpoint",
            source_key, row.model_version, settings.embed_model,
        )
        return None
    return row.last_seen_at.replace(tzinfo=timezone.utc) if row.last_seen_at.tzinfo is None else row.last_seen_at


def set_checkpoint(source_key: str, watermark: datetime) -> None:
    """Upsert the watermark for a source."""
    with engine().connect() as conn:
        conn.execute(
            text("""
                INSERT INTO ingest_checkpoints (source_key, last_seen_at, model_version, updated_at)
                VALUES (:k, :ts, :mv, now())
                ON CONFLICT (source_key) DO UPDATE
                  SET last_seen_at = EXCLUDED.last_seen_at,
                      model_version = EXCLUDED.model_version,
                      updated_at = now()
            """),
            {"k": source_key, "ts": watermark, "mv": settings.embed_model},
        )
        conn.commit()


def clear_checkpoint(source_key: str) -> None:
    """Delete a checkpoint (forces full re-index for that source on next run)."""
    with engine().connect() as conn:
        conn.execute(
            text("DELETE FROM ingest_checkpoints WHERE source_key = :k"),
            {"k": source_key},
        )
        conn.commit()
    log.info("Cleared checkpoint for '%s'", source_key)


def clear_all_checkpoints() -> None:
    """Delete all checkpoints."""
    with engine().connect() as conn:
        conn.execute(text("DELETE FROM ingest_checkpoints"))
        conn.commit()
    log.info("Cleared all ingest checkpoints")


def get_all_checkpoints() -> list[dict]:
    """Return all checkpoints as a list of dicts for the status API."""
    with engine().connect() as conn:
        rows = conn.execute(
            text("SELECT source_key, last_seen_at, model_version, updated_at FROM ingest_checkpoints ORDER BY source_key")
        ).fetchall()
    return [
        {
            "source_key": r.source_key,
            "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            "model_version": r.model_version,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]
