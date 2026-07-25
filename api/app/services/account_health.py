"""Shared health classification for Plaid/SnapTrade connections.

Used by both the account-health WhatsApp alert (notifications.py) and the
GET /accounts/sync-health API endpoint, so the two stay in sync on what
counts as an unhealthy connection.
"""

from datetime import datetime, timedelta, timezone

STALE_DAYS = 60  # flag connections not synced within this many days


def classify_connection(
    error_code: str | None,
    is_active: bool,
    last_synced_at: datetime | None,
    created_at: datetime,
    now: datetime | None = None,
) -> tuple[str, str | None]:
    """Return (status, detail) for a Plaid item or SnapTrade connection.

    status is one of: "disabled", "error", "never_synced", "stale", "ok"
    detail is a short human-readable reason, or None when status == "ok".
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=STALE_DAYS)

    if not is_active:
        return "disabled", "Connection disabled"

    if error_code:
        return "error", f"Connection error: {error_code}"

    if last_synced_at is None:
        if created_at < cutoff:
            return "never_synced", f"Never synced (connected {created_at.strftime('%b %d, %Y')})"
        return "never_synced", "Not yet synced"

    if last_synced_at < cutoff:
        days_ago = (now - last_synced_at).days
        return "stale", f"Last synced {days_ago} days ago ({last_synced_at.strftime('%b %d, %Y')})"

    return "ok", None
