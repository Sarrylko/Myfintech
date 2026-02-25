"""
Inbox watcher entry point.

Polls the inbox directory every INBOX_POLL_SECONDS seconds, imports any new
files found, and moves them to _processed/ or _errors/.

Run as:  python -m app.watcher_main
Docker:  command: python -m app.watcher_main
"""
import logging
import signal
import time
import uuid
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.services.inbox_importer import import_inbox_file, move_to_errors
from app.services.inbox_parser import ParseError, parse_inbox_path
from app.services.inbox_scaffold import scaffold_inbox

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("inbox_watcher")

engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)

_running = True


def _on_shutdown(signum, frame):  # noqa: ANN001
    global _running
    logger.info("Shutdown signal received — stopping after current cycle.")
    _running = False


signal.signal(signal.SIGTERM, _on_shutdown)
signal.signal(signal.SIGINT, _on_shutdown)


# ── Household resolution ─────────────────────────────────────────────────────

def _get_household_id() -> uuid.UUID:
    """Return the primary household ID — the one with the most registered users."""
    with SessionLocal() as db:
        row = db.execute(text("""
            SELECT h.id
            FROM households h
            JOIN users u ON u.household_id = h.id
            GROUP BY h.id
            ORDER BY COUNT(u.id) DESC, h.created_at ASC
            LIMIT 1
        """)).fetchone()
    if not row:
        raise RuntimeError(
            "No household found in the database. "
            "Create a user account first, then start the watcher."
        )
    return uuid.UUID(str(row[0]))


# ── Single poll cycle ────────────────────────────────────────────────────────

def _process_inbox(inbox: Path, household_id: uuid.UUID) -> None:
    processed_root = inbox / "_processed"
    errors_root = inbox / "_errors"

    files = sorted(f for f in inbox.rglob("*") if f.is_file())
    if not files:
        return

    new_files = [
        f for f in files
        if not any(part.startswith("_") for part in f.relative_to(inbox).parts)
        and not f.name.startswith(".")
        and not f.name.endswith(".reason.txt")
    ]

    if not new_files:
        return

    logger.info("Found %d file(s) to process", len(new_files))

    for file_path in new_files:
        if not _running:
            break

        rel = file_path.relative_to(inbox)
        parse_result = parse_inbox_path(rel)

        if isinstance(parse_result, ParseError):
            move_to_errors(file_path, errors_root, parse_result.reason)
            continue

        try:
            with SessionLocal() as db:
                import_inbox_file(
                    file_path=file_path,
                    parse_result=parse_result,
                    db=db,
                    household_id=household_id,
                    errors_root=errors_root,
                    processed_root=processed_root,
                )
        except Exception:
            logger.exception("Unexpected error processing %s", file_path.name)


# ── Main loop ────────────────────────────────────────────────────────────────

def main() -> None:
    inbox = Path(settings.inbox_dir)
    inbox.mkdir(parents=True, exist_ok=True)

    logger.info(
        "Inbox watcher starting  inbox=%s  poll=%ds",
        inbox, settings.inbox_poll_seconds,
    )

    household_id = _get_household_id()
    logger.info("Household ID: %s", household_id)

    while _running:
        try:
            with SessionLocal() as db:
                scaffold_inbox(inbox, db, household_id)
            _process_inbox(inbox, household_id)
        except Exception:
            logger.exception("Poll cycle error")

        # Sleep in 1-second ticks so SIGTERM is handled promptly
        for _ in range(settings.inbox_poll_seconds):
            if not _running:
                break
            time.sleep(1)

    logger.info("Inbox watcher stopped.")


if __name__ == "__main__":
    main()
