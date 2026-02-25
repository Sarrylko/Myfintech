"""
WhatsApp notification client.

Calls the whatsapp-bot Node.js service (running on the private Docker network)
to send messages.  All failures are logged and swallowed so a WhatsApp outage
never breaks the main application flow.
"""

import logging

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)


def send_whatsapp(to: str, message: str) -> bool:
    """
    Send a WhatsApp message to `to` (E.164 format, e.g. +12223334444).

    Returns True on success, False on any error (logs the reason).
    Safe to call even when whatsapp_enabled=False — returns False silently.
    """
    if not settings.whatsapp_enabled:
        return False
    if not to or not message:
        return False
    try:
        resp = requests.post(
            f"{settings.whatsapp_bot_url}/send",
            json={"to": to, "message": message},
            timeout=10,
        )
        if resp.status_code == 200:
            return True
        logger.warning(
            "WhatsApp /send returned %d: %s", resp.status_code, resp.text[:200]
        )
        return False
    except Exception as exc:
        logger.warning("WhatsApp send failed (to=%s): %s", to, exc)
        return False


def send_whatsapp_bulk(recipients: list[str], message: str) -> int:
    """Send the same message to multiple recipients. Returns number of successes."""
    return sum(send_whatsapp(to, message) for to in recipients if to)
