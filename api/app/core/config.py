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

    # ─── Encryption ───────────────────────────────
    encryption_key: str = "CHANGE_ME"

    # ─── Domain ───────────────────────────────────
    domain: str = "localhost"

    # ─── Property API ─────────────────────────────
    property_api_key: str = ""
    property_api_provider: str = ""

    # Look for .env in current dir (Docker) or parent dir (local dev from api/)
    model_config = {"env_file": [".env", "../.env"], "extra": "ignore"}


settings = Settings()
