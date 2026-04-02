"""
Celery task for asynchronous receipt parsing.
"""
import asyncio
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.worker import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.services.receipt_tasks.parse_receipt_task")
def parse_receipt_task(receipt_id: str, provider: str = "local") -> None:
    """Parse a receipt. provider: 'local' (Ollama) or 'claude' (Anthropic API)."""
    from app.services.receipt_parser import parse_receipt

    async def _run():
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with async_session() as db:
            await parse_receipt(uuid.UUID(receipt_id), db, provider=provider)
        await engine.dispose()

    asyncio.run(_run())
