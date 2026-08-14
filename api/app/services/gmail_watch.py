"""
Local Gmail inbox watch — runs entirely inside this Celery worker, no inbound
network exposure. For each active entity_email_watches row with a saved OAuth
refresh token (see scripts/gmail_oauth_setup.py), fetches recent mail, flags
anything from an allowlisted sender or judged important by Claude, and sends
one WhatsApp summary per watch via the existing notification path. Never
sends email — drafts are for the household to review and send themselves.
"""

import json
import logging
from datetime import date, datetime, timedelta, timezone

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decrypt_value
from app.models.business_entity import BusinessEntity, EntityEmailWatch
from app.services.notifications import _engine, notify_gmail_alert
from app.worker import celery_app

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _build_gmail_service(refresh_token: str):
    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.gmail_oauth_client_id,
        client_secret=settings.gmail_oauth_client_secret,
        scopes=SCOPES,
    )
    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def _header(headers: list[dict], name: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _is_allowlisted(sender: str, allowlist: list[str]) -> bool:
    sender_lower = sender.lower()
    return any(entry.lower() in sender_lower for entry in allowlist if entry)


def _judge_importance(sender: str, subject: str, snippet: str) -> dict | None:
    """Ask Claude whether this email needs attention. Returns None on any failure
    (a down/unconfigured AI classifier should never crash the whole watch run)."""
    if not settings.anthropic_api_key:
        return None
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            system=(
                "You triage email for a household's rental-property inbox. "
                'Reply with ONLY a JSON object: {"important": bool, "reason": '
                '"<one short sentence>", "draft_reply": "<short suggested reply, '
                'or null if none needed>"}. Mark important: true for anything '
                "needing action — payment due, legal notice, maintenance "
                "request, lease matter, urgent tenant/HOA/government "
                "correspondence. Mark false for newsletters, receipts, spam, "
                "routine confirmations."
            ),
            messages=[
                {
                    "role": "user",
                    "content": f"From: {sender}\nSubject: {subject}\nPreview: {snippet}",
                }
            ],
        )
        return json.loads(response.content[0].text)
    except Exception:
        logger.exception("Gmail watch: importance classification failed")
        return None


def _fetch_flagged_items(service, allowlist: list[str], since: date) -> list[str]:
    query = f"after:{since.strftime('%Y/%m/%d')}"
    msg_list = service.users().messages().list(userId="me", q=query, maxResults=50).execute()
    flagged: list[str] = []

    for msg_ref in msg_list.get("messages", []):
        msg = (
            service.users()
            .messages()
            .get(
                userId="me",
                id=msg_ref["id"],
                format="metadata",
                metadataHeaders=["From", "Subject"],
            )
            .execute()
        )
        headers = msg.get("payload", {}).get("headers", [])
        sender = _header(headers, "From")
        subject = _header(headers, "Subject") or "(no subject)"
        snippet = msg.get("snippet", "")

        if _is_allowlisted(sender, allowlist):
            flagged.append(f"  • *{subject}* — {sender} (allowlisted sender)")
            continue

        verdict = _judge_importance(sender, subject, snippet)
        if verdict and verdict.get("important"):
            line = f"  • *{subject}* — {sender}\n    {verdict.get('reason', '')}"
            draft = verdict.get("draft_reply")
            if draft:
                line += f"\n    Suggested reply: {draft}"
            flagged.append(line)

    return flagged


@celery_app.task(name="app.services.gmail_watch.check_gmail_alerts")
def check_gmail_alerts():
    """Daily beat task — checks every active Gmail watch and alerts on flagged mail."""
    logger.info("check_gmail_alerts: starting")

    with Session(_engine) as db:
        rows = db.execute(
            select(EntityEmailWatch, BusinessEntity.name)
            .join(BusinessEntity, BusinessEntity.id == EntityEmailWatch.entity_id)
            .where(
                EntityEmailWatch.is_active == True,  # noqa: E712
                EntityEmailWatch.encrypted_gmail_refresh_token.isnot(None),
            )
        ).all()

        for watch, entity_name in rows:
            since = (
                watch.last_checked_at.date()
                if watch.last_checked_at
                else date.today() - timedelta(days=1)
            )
            try:
                refresh_token = decrypt_value(watch.encrypted_gmail_refresh_token)
                service = _build_gmail_service(refresh_token)
                flagged = _fetch_flagged_items(service, watch.sender_allowlist, since)
            except Exception:
                logger.exception(
                    "check_gmail_alerts: failed for watch_id=%s (%s)",
                    watch.id,
                    watch.gmail_address,
                )
                continue

            watch.last_checked_at = datetime.now(timezone.utc)
            db.commit()

            if flagged:
                message = f"{len(flagged)} email(s) need attention:\n\n" + "\n".join(flagged)
                notify_gmail_alert(
                    str(watch.household_id), entity_name, message, watch.notif_phone_override
                )

    logger.info("check_gmail_alerts: done")
