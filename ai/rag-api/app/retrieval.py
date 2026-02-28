"""
Embedding and Qdrant vector store operations.
"""
import logging
import uuid
from typing import Any

import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
)

from app.config import settings

log = logging.getLogger(__name__)

EMBED_DIM = 768          # nomic-embed-text output dimension
BATCH_SIZE = 64          # points per Qdrant upsert call

_qdrant: QdrantClient | None = None


def get_qdrant() -> QdrantClient:
    global _qdrant
    if _qdrant is None:
        _qdrant = QdrantClient(url=settings.qdrant_url, timeout=30)
    return _qdrant


def ensure_collection():
    client = get_qdrant()
    existing = [c.name for c in client.get_collections().collections]
    if settings.qdrant_collection not in existing:
        client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
        )
        log.info("Created Qdrant collection '%s'", settings.qdrant_collection)
    return client


def collection_count() -> int:
    try:
        info = get_qdrant().get_collection(settings.qdrant_collection)
        return info.points_count or 0
    except Exception:
        return 0


async def embed_text(text: str) -> list[float]:
    """Embed a single text string using Ollama nomic-embed-text."""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{settings.ollama_url}/api/embeddings",
            json={"model": settings.embed_model, "prompt": text},
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


async def upsert_points(points: list[dict[str, Any]]):
    """
    Embed each point's 'text' field and upsert to Qdrant.
    Each item: {"id": str, "text": str, "payload": dict}
    """
    client = ensure_collection()

    for i in range(0, len(points), BATCH_SIZE):
        batch = points[i : i + BATCH_SIZE]
        structs = []
        for p in batch:
            try:
                vec = await embed_text(p["text"])
                structs.append(
                    PointStruct(
                        id=p["id"],
                        vector=vec,
                        payload={**p["payload"], "text": p["text"]},
                    )
                )
            except Exception as e:
                log.warning("Failed to embed point %s: %s", p.get("id"), e)

        if structs:
            client.upsert(
                collection_name=settings.qdrant_collection,
                points=structs,
            )
        log.debug("Upserted batch %d/%d", i // BATCH_SIZE + 1, (len(points) + BATCH_SIZE - 1) // BATCH_SIZE)


async def search(question: str, top_k: int = 10) -> list[dict]:
    """Return top-k relevant chunks for a question."""
    client = ensure_collection()
    vec = await embed_text(question)
    hits = client.search(
        collection_name=settings.qdrant_collection,
        query_vector=vec,
        limit=top_k,
        with_payload=True,
    )
    return [h.payload for h in hits]
