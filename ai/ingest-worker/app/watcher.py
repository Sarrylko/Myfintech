"""
Watchdog file system observer for real-time document ingest/delete.
Uses PollingObserver for reliability on Docker bind-mounted Windows shares.
Debounces events with a 2-second coalesce window.
"""
import logging
import os
import queue
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver

from app.config import settings

log = logging.getLogger(__name__)

DEBOUNCE_SECONDS = 2.0

# File queue: items are ("upsert", path) or ("delete", path)
_event_queue: queue.Queue = queue.Queue()


class FinancialDocEventHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            _event_queue.put(("upsert", event.src_path))

    def on_modified(self, event):
        if not event.is_directory:
            _event_queue.put(("upsert", event.src_path))

    def on_deleted(self, event):
        if not event.is_directory:
            _event_queue.put(("delete", event.src_path))

    def on_moved(self, event):
        if not event.is_directory:
            _event_queue.put(("delete", event.src_path))
            _event_queue.put(("upsert", event.dest_path))


def _consumer_loop(upsert_fn, delete_fn):
    """
    Drain the event queue with debouncing.
    Coalesces events for the same path within DEBOUNCE_SECONDS.
    """
    pending: dict[str, str] = {}  # path → "upsert" | "delete"
    last_seen: dict[str, float] = {}

    while True:
        # Drain all immediately available events
        while True:
            try:
                action, path = _event_queue.get_nowait()
                pending[path] = action
                last_seen[path] = time.monotonic()
            except queue.Empty:
                break

        now = time.monotonic()
        ready = [p for p, t in last_seen.items() if now - t >= DEBOUNCE_SECONDS]
        for path in ready:
            action = pending.pop(path, None)
            last_seen.pop(path, None)
            if action is None:
                continue
            try:
                if action == "upsert":
                    upsert_fn(path)
                elif action == "delete":
                    delete_fn(path)
            except Exception as e:
                log.warning("Watcher %s failed for %s: %s", action, path, e)

        time.sleep(0.5)


def start_watcher(upsert_fn, delete_fn) -> threading.Thread | None:
    """Start the file watcher + consumer thread. Returns the consumer thread."""
    watch_dir = settings.finance_doc_root
    if not os.path.isdir(watch_dir):
        log.warning("File watcher: watch directory '%s' does not exist — skipping", watch_dir)
        return None

    if settings.file_watcher_observer.lower() == "polling":
        observer = PollingObserver(timeout=10)
    else:
        observer = Observer()

    handler = FinancialDocEventHandler()
    observer.schedule(handler, watch_dir, recursive=True)
    observer.start()
    log.info("File watcher started on '%s' (%s)", watch_dir, settings.file_watcher_observer)

    consumer = threading.Thread(
        target=_consumer_loop,
        args=(upsert_fn, delete_fn),
        daemon=True,
        name="watcher-consumer",
    )
    consumer.start()
    return consumer
