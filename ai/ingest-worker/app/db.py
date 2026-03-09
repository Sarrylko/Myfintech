"""Synchronous SQLAlchemy engine for reading checkpoints and writing job state."""
from sqlalchemy import create_engine, text

from app.config import settings


def get_engine():
    url = settings.database_url.replace("+asyncpg", "")
    return create_engine(url, pool_pre_ping=True, pool_size=2, max_overflow=2)


# Module-level singleton
_engine = None


def engine():
    global _engine
    if _engine is None:
        _engine = get_engine()
    return _engine
