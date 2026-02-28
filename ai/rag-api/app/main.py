"""
MyFintech RAG API — OpenAI-compatible financial assistant.

Endpoints:
  GET  /health
  GET  /v1/models
  POST /v1/chat/completions   (streaming + non-streaming)
  POST /admin/ingest          (trigger full re-ingest)
  GET  /admin/stats           (Qdrant collection stats)
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import settings
from app.ingest.db import run_db_ingest
from app.ingest.docs import run_doc_ingest
from app.retrieval import collection_count, ensure_collection, search

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger(__name__)

# ── Background sync task ─────────────────────────────────────────────────────

_ingest_lock = asyncio.Lock()


async def _run_full_ingest():
    async with _ingest_lock:
        log.info("Running full ingest (DB + docs)...")
        db_count = await run_db_ingest()
        doc_count = await run_doc_ingest()
        log.info("Full ingest done — DB: %d points, Docs: %d chunks", db_count, doc_count)


async def _periodic_db_sync():
    interval = settings.db_sync_interval_seconds
    while True:
        await asyncio.sleep(interval)
        log.info("Periodic DB sync triggered (interval: %ds)", interval)
        try:
            async with _ingest_lock:
                await run_db_ingest()
        except Exception as e:
            log.error("Periodic DB sync failed: %s", e)


async def _wait_for_ollama():
    """Poll Ollama until it responds — models may still be loading."""
    log.info("Waiting for Ollama at %s...", settings.ollama_url)
    for attempt in range(60):
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{settings.ollama_url}/api/tags")
                if resp.status_code == 200:
                    log.info("Ollama is ready.")
                    return
        except Exception:
            pass
        await asyncio.sleep(5)
    log.warning("Ollama did not become ready after 5 minutes — continuing anyway.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting MyFintech RAG API...")
    ensure_collection()

    # Wait for Ollama to be ready before ingesting
    await _wait_for_ollama()

    count = collection_count()
    if count == 0:
        log.info("Collection is empty — running initial full ingest...")
        asyncio.create_task(_run_full_ingest())
    else:
        log.info("Collection has %d points — skipping initial ingest.", count)

    # Start periodic DB sync in background
    asyncio.create_task(_periodic_db_sync())

    yield
    log.info("RAG API shutting down.")


app = FastAPI(title="MyFintech RAG API", lifespan=lifespan)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    ollama_ok = False
    qdrant_ok = False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{settings.ollama_url}/api/tags")
            ollama_ok = r.status_code == 200
    except Exception:
        pass
    try:
        qdrant_ok = collection_count() >= 0
    except Exception:
        pass

    return {
        "status": "ok",
        "ollama": ollama_ok,
        "qdrant": qdrant_ok,
        "collection_points": collection_count(),
        "llm_model": settings.llm_model,
        "embed_model": settings.embed_model,
    }


# ── OpenAI-compatible endpoints ───────────────────────────────────────────────

@app.get("/v1/models")
async def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": "fintech-assistant",
                "object": "model",
                "created": 1700000000,
                "owned_by": "myfintech",
            }
        ],
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    stream = body.get("stream", False)

    if not messages:
        raise HTTPException(status_code=400, detail="messages is required")

    # Extract last user message for retrieval
    last_user = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"), ""
    )

    # Retrieve relevant context from Qdrant
    try:
        context_chunks = await search(last_user, top_k=12)
    except Exception as e:
        log.error("Retrieval failed: %s", e)
        context_chunks = []

    from app.llm import complete_chat, stream_chat

    if stream:
        return StreamingResponse(
            stream_chat(messages, context_chunks),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        result = await complete_chat(messages, context_chunks)
        return JSONResponse(result)


# ── Admin endpoints ────────────────────────────────────────────────────────────

@app.post("/admin/ingest")
async def trigger_ingest():
    if _ingest_lock.locked():
        return {"status": "already_running", "message": "Ingest is already in progress."}
    asyncio.create_task(_run_full_ingest())
    return {"status": "started", "message": "Full ingest triggered in background."}


@app.get("/admin/stats")
async def stats():
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    client = ensure_collection()
    total = collection_count()

    source_counts = {}
    for source in ("db", "doc"):
        try:
            result = client.count(
                collection_name=settings.qdrant_collection,
                count_filter=Filter(
                    must=[FieldCondition(key="source", match=MatchValue(value=source))]
                ),
                exact=True,
            )
            source_counts[source] = result.count
        except Exception:
            source_counts[source] = "unknown"

    return {
        "collection": settings.qdrant_collection,
        "total_points": total,
        "by_source": source_counts,
        "llm_model": settings.llm_model,
        "embed_model": settings.embed_model,
        "db_sync_interval_seconds": settings.db_sync_interval_seconds,
    }
