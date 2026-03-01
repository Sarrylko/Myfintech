"""
Embedding and Qdrant vector store operations.
Supports separate collections for DB records vs document chunks.
"""
import logging
from typing import Any

import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
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


def ensure_collection(name: str) -> QdrantClient:
    """Ensure a named collection exists; create it if not."""
    client = get_qdrant()
    existing = [c.name for c in client.get_collections().collections]
    if name not in existing:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
        )
        log.info("Created Qdrant collection '%s'", name)
    return client


def ensure_collections():
    """Ensure DB, docs, and learned collections exist."""
    ensure_collection(settings.qdrant_collection_db)
    ensure_collection(settings.qdrant_collection_docs)
    ensure_collection(settings.qdrant_collection_learned)


def collection_count(name: str) -> int:
    try:
        info = get_qdrant().get_collection(name)
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


async def upsert_points(points: list[dict[str, Any]], collection: str):
    """
    Embed each point's 'text' field and upsert to the specified collection.
    Each item: {"id": str, "text": str, "payload": dict}
    """
    ensure_collection(collection)
    client = get_qdrant()

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
                collection_name=collection,
                points=structs,
            )
        log.debug("Upserted batch %d/%d to %s", i // BATCH_SIZE + 1, (len(points) + BATCH_SIZE - 1) // BATCH_SIZE, collection)


async def search(
    question: str,
    top_k: int = 10,
    collection: str = "",
    household_id: str | None = None,
) -> list[dict]:
    """Return top-k relevant chunks from a specific collection, filtered by household."""
    if not collection:
        collection = settings.qdrant_collection_db
    ensure_collection(collection)
    client = get_qdrant()
    vec = await embed_text(question)

    query_filter: Filter | None = None
    if household_id:
        query_filter = Filter(
            must=[FieldCondition(key="household_id", match=MatchValue(value=household_id))]
        )

    hits = client.search(
        collection_name=collection,
        query_vector=vec,
        limit=top_k,
        with_payload=True,
        query_filter=query_filter,
    )
    return [h.payload for h in hits]


async def search_combined(
    question: str,
    top_k_db: int = 10,
    top_k_docs: int = 10,
    household_id: str | None = None,
) -> list[dict]:
    """
    Tiered retrieval (highest to lowest priority):
      1. Learned Q&A (explicitly verified ChatGPT answers)
      2. Live DB records (current financial state)
      3. Uploaded documents (historical snapshots)
    """
    learned = await search(question, top_k=5, collection=settings.qdrant_collection_learned, household_id=household_id)
    db_chunks = await search(question, top_k=top_k_db, collection=settings.qdrant_collection_db, household_id=household_id)
    doc_chunks = await search(question, top_k=top_k_docs, collection=settings.qdrant_collection_docs, household_id=household_id)
    return learned + db_chunks + doc_chunks
