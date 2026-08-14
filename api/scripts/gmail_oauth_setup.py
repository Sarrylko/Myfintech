"""
One-time Gmail OAuth consent for an entity_email_watches row.

Run once per Gmail address you want watched. Requires GMAIL_OAUTH_CLIENT_ID /
GMAIL_OAUTH_CLIENT_SECRET to be set (from a Google Cloud Console OAuth client,
type "Desktop app", with the Gmail API enabled).

Usage (from the api container, with port 8765 published for the redirect):
    docker compose run --rm -p 8765:8765 api python scripts/gmail_oauth_setup.py <watch_id>

Opens a URL to visit in your browser (won't auto-open from inside a
container — copy the printed link). After you grant read-only access to the
Gmail account, the refresh token is encrypted and saved on that watch row.
"""
import sys
import uuid

from google_auth_oauthlib.flow import InstalledAppFlow
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import encrypt_value
from app.models.business_entity import EntityEmailWatch

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
REDIRECT_PORT = 8765


def main(watch_id: str) -> None:
    if not settings.gmail_oauth_client_id or not settings.gmail_oauth_client_secret:
        print("GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET are not set in .env")
        sys.exit(1)

    from sqlalchemy import create_engine

    engine = create_engine(settings.database_url_sync)
    with Session(engine) as db:
        watch = db.get(EntityEmailWatch, uuid.UUID(watch_id))
        if not watch:
            print(f"No entity_email_watches row found with id={watch_id}")
            sys.exit(1)
        print(f"Authorizing for gmail_address={watch.gmail_address!r} (watch_id={watch_id})")

        client_config = {
            "installed": {
                "client_id": settings.gmail_oauth_client_id,
                "client_secret": settings.gmail_oauth_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [f"http://localhost:{REDIRECT_PORT}/"],
            }
        }
        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
        credentials = flow.run_local_server(
            port=REDIRECT_PORT,
            open_browser=False,
            access_type="offline",
            prompt="consent",
        )

        if not credentials.refresh_token:
            print(
                "No refresh_token returned. Revoke prior access at "
                "https://myaccount.google.com/permissions and re-run this script."
            )
            sys.exit(1)

        watch.encrypted_gmail_refresh_token = encrypt_value(credentials.refresh_token)
        db.commit()
        print(f"Saved refresh token for watch_id={watch_id} ({watch.gmail_address}).")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/gmail_oauth_setup.py <watch_id>")
        sys.exit(1)
    main(sys.argv[1])
