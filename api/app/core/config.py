import base64
import sys

from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ─── App ──────────────────────────────────────
    environment: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_log_level: str = "info"

    # ─── Auth ─────────────────────────────────────
    api_secret_key: str = "CHANGE_ME"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    algorithm: str = "HS256"

    # ─── Database ─────────────────────────────────
    database_url: str = "postgresql+asyncpg://myfintech:password@postgres:5432/myfintech"
    database_url_sync: str = "postgresql://myfintech:password@postgres:5432/myfintech"

    # ─── Redis ────────────────────────────────────
    redis_url: str = "redis://redis:6379/0"

    # ─── Plaid ────────────────────────────────────
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"

    # ─── SnapTrade ────────────────────────────────
    snaptrade_client_id: str = ""
    snaptrade_consumer_key: str = ""

    # ─── Encryption ───────────────────────────────
    encryption_key: str = "CHANGE_ME"

    # ─── Domain ───────────────────────────────────
    domain: str = "localhost"

    # ─── Property API ─────────────────────────────
    property_api_key: str = ""
    property_api_provider: str = ""

    # ─── File Storage ─────────────────────────────
    upload_dir: str = "/app/uploads"

    # ─── Inbox Watcher ────────────────────────────
    inbox_dir: str = "/app/inbox"
    inbox_poll_seconds: int = 30

    # ─── WhatsApp Bot ─────────────────────────────
    whatsapp_bot_url: str = "http://whatsapp-bot:3000"
    whatsapp_enabled: bool = True

    # Look for .env in current dir (Docker) or parent dir (local dev from api/)
    model_config = {"env_file": [".env", "../.env"], "extra": "ignore"}


def _validate_secrets(s: Settings) -> None:
    """Abort startup if critical secrets are missing or insecure."""
    errors: list[str] = []

    # API secret key — must not be default and must have adequate entropy
    if s.api_secret_key in ("CHANGE_ME", "", "secret"):
        errors.append("API_SECRET_KEY is not set or uses the default placeholder")
    elif len(s.api_secret_key) < 32:
        errors.append("API_SECRET_KEY is too short (minimum 32 characters)")

    # Fernet encryption key — must be a valid 32-byte URL-safe base64 key (44 chars)
    if s.encryption_key in ("CHANGE_ME", ""):
        errors.append("ENCRYPTION_KEY is not set or uses the default placeholder")
    else:
        try:
            decoded = base64.urlsafe_b64decode(s.encryption_key + "==")
            if len(decoded) != 32:
                raise ValueError
            Fernet(s.encryption_key.encode())
        except Exception:
            errors.append(
                "ENCRYPTION_KEY is not a valid Fernet key. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )

    if errors:
        if s.environment == "production":
            # Hard fail in production — invalid secrets must not reach users
            print("FATAL: Invalid secrets configuration:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            sys.exit(1)
        else:
            # Warn loudly in development but allow startup
            import logging
            log = logging.getLogger("app.config")
            for e in errors:
                log.warning("SECRET VALIDATION WARNING: %s", e)


settings = Settings()
_validate_secrets(settings)
