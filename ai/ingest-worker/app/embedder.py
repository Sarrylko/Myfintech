"""Synchronous Ollama embedder for use in APScheduler/watchdog threads."""
import logging

import httpx

from app.config import settings

log = logging.getLogger(__name__)


def embed_text(text: str) -> list[float]:
    """Embed text via Ollama nomic-embed-text. Synchronous (for use in threads)."""
    with httpx.Client(timeout=60) as client:
        resp = client.post(
            f"{settings.ollama_url}/api/embeddings",
            json={"model": settings.embed_model, "prompt": text},
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


def get_model_version() -> str:
    """Return the configured embed model name (used as version stamp in Qdrant payloads)."""
    return settings.embed_model


def ollama_ready() -> bool:
    try:
        with httpx.Client(timeout=5) as client:
            r = client.get(f"{settings.ollama_url}/api/tags")
            return r.status_code == 200
    except Exception:
        return False
