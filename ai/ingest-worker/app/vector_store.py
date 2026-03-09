"""
Qdrant upsert/delete with content-hash-based skip logic.
All operations are synchronous (called from APScheduler/watchdog threads).
"""
import logging
import uuid
from typing import Any

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
from app.embedder import embed_text, get_model_version
from app.hasher import hash_text

log = logging.getLogger(__name__)

EMBED_DIM = 768
BATCH_SIZE = 32

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=settings.qdrant_url, timeout=30)
    return _client


def ensure_collection(name: str) -> None:
    client = get_client()
    existing = [c.name for c in client.get_collections().collections]
    if name not in existing:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
        )
        log.info("Created Qdrant collection '%s'", name)


def ensure_collections() -> None:
    ensure_collection(settings.qdrant_collection_db)
    ensure_collection(settings.qdrant_collection_docs)


def collection_count(name: str) -> int:
    try:
        info = get_client().get_collection(name)
        return info.points_count or 0
    except Exception:
        return 0


def upsert_points(
    points: list[dict[str, Any]],
    collection: str,
    dry_run: bool = False,
) -> tuple[int, int]:
    """
    Embed and upsert points. Skips points whose content_hash + model_version match
    what's already stored in Qdrant (no re-embed needed).
    Returns (upserted_count, skipped_count).
    """
    ensure_collection(collection)
    client = get_client()
    model_ver = get_model_version()
    upserted = 0
    skipped = 0

    for i in range(0, len(points), BATCH_SIZE):
        batch = points[i: i + BATCH_SIZE]
        to_upsert: list[PointStruct] = []

        for p in batch:
            point_id = p["id"]
            text = p["text"]
            content_hash = hash_text(text)

            # Check if already stored with same hash + model
            try:
                existing = client.retrieve(
                    collection_name=collection,
                    ids=[point_id],
                    with_payload=True,
                    with_vectors=False,
                )
                if existing:
                    stored = existing[0].payload or {}
                    if (
                        stored.get("content_hash") == content_hash
                        and stored.get("model_version") == model_ver
                    ):
                        skipped += 1
                        continue
            except Exception:
                pass  # treat as missing → proceed to upsert

            if dry_run:
                log.info("[dry-run] Would upsert point %s", point_id)
                upserted += 1
                continue

            try:
                vec = embed_text(text)
                to_upsert.append(
                    PointStruct(
                        id=point_id,
                        vector=vec,
                        payload={
                            **p["payload"],
                            "text": text,
                            "content_hash": content_hash,
                            "model_version": model_ver,
                        },
                    )
                )
                upserted += 1
            except Exception as e:
                log.warning("Failed to embed point %s: %s", point_id, e)

        if to_upsert and not dry_run:
            client.upsert(collection_name=collection, points=to_upsert)

    return upserted, skipped


def delete_by_record_id(record_id: str, collection: str, dry_run: bool = False) -> int:
    """Delete all Qdrant points matching payload.record_id (handles multi-chunk docs)."""
    client = get_client()
    filt = Filter(must=[FieldCondition(key="record_id", match=MatchValue(value=record_id))])
    deleted = 0
    offset = None
    while True:
        points, next_offset = client.scroll(
            collection_name=collection,
            scroll_filter=filt,
            limit=100,
            with_payload=False,
            with_vectors=False,
            offset=offset,
        )
        if not points:
            break
        ids = [str(p.id) for p in points]
        if dry_run:
            log.info("[dry-run] Would delete %d points for record_id=%s", len(ids), record_id)
        else:
            client.delete(
                collection_name=collection,
                points_selector=ids,
            )
        deleted += len(ids)
        if next_offset is None:
            break
        offset = next_offset
    return deleted


def delete_by_stored_filename(stored_filename: str, dry_run: bool = False) -> int:
    """Delete all doc chunks for a stored_filename across docs collection."""
    client = get_client()
    filt = Filter(must=[FieldCondition(key="stored_filename", match=MatchValue(value=stored_filename))])
    deleted = 0
    offset = None
    while True:
        points, next_offset = client.scroll(
            collection_name=settings.qdrant_collection_docs,
            scroll_filter=filt,
            limit=100,
            with_payload=False,
            with_vectors=False,
            offset=offset,
        )
        if not points:
            break
        ids = [str(p.id) for p in points]
        if dry_run:
            log.info("[dry-run] Would delete %d points for file %s", len(ids), stored_filename)
        else:
            client.delete(collection_name=settings.qdrant_collection_docs, points_selector=ids)
        deleted += len(ids)
        if next_offset is None:
            break
        offset = next_offset
    return deleted


def get_all_record_ids(table: str, collection: str) -> set[str]:
    """Return all record_ids stored in Qdrant for a given table tag."""
    client = get_client()
    filt = Filter(must=[FieldCondition(key="table", match=MatchValue(value=table))])
    ids: set[str] = set()
    offset = None
    while True:
        points, next_offset = client.scroll(
            collection_name=collection,
            scroll_filter=filt,
            limit=500,
            with_payload=True,
            with_vectors=False,
            offset=offset,
        )
        for p in points:
            rid = (p.payload or {}).get("record_id")
            if rid and rid != "summary":
                ids.add(rid)
        if next_offset is None:
            break
        offset = next_offset
    return ids
