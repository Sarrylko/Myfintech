"""
MyFintech RAG API — OpenAI-compatible financial assistant.

Endpoints:
  GET  /health
  GET  /v1/models
  POST /v1/chat/completions   (streaming + non-streaming)
  POST /admin/ingest          (proxy → ingest-worker /sync/db)
  POST /admin/ingest/docs     (proxy → ingest-worker /sync/files)
  GET  /admin/stats           (Qdrant collection stats)
  POST /admin/learn           (save a ChatGPT Q&A to the knowledge base)
  GET  /admin/learned         (list saved Q&A pairs for a household)
"""
import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import settings
from app.retrieval import collection_count, ensure_collections, search_combined, upsert_points

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger(__name__)


# ── API key guard ─────────────────────────────────────────────────────────────

async def verify_api_key(
    request: Request,
    x_rag_api_key: str | None = Header(None, alias="X-RAG-Api-Key"),
    authorization: str | None = Header(None),
):
    """
    Accept the API key via either:
      - X-RAG-Api-Key: {key}          (used by the main FastAPI proxy)
      - Authorization: Bearer {key}   (used by OpenWebUI)
    If RAG_API_KEY is not set, all requests are allowed (dev mode).
    """
    if not settings.rag_api_key:
        return  # auth disabled

    bearer_token = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer_token = authorization[7:]

    if x_rag_api_key == settings.rag_api_key:
        return
    if bearer_token == settings.rag_api_key:
        return

    raise HTTPException(status_code=401, detail="Invalid or missing RAG API key")


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
        import asyncio
        await asyncio.sleep(5)
    log.warning("Ollama did not become ready after 5 minutes — continuing anyway.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting MyFintech RAG API...")
    ensure_collections()
    await _wait_for_ollama()
    log.info("RAG API ready. Ingest is managed by ingest-worker service.")
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
    db_count = 0
    doc_count = 0
    learned_count = 0
    try:
        db_count = collection_count(settings.qdrant_collection_db)
        doc_count = collection_count(settings.qdrant_collection_docs)
        learned_count = collection_count(settings.qdrant_collection_learned)
        qdrant_ok = True
    except Exception:
        pass

    return {
        "status": "ok",
        "ollama": ollama_ok,
        "qdrant": qdrant_ok,
        "db_collection_points": db_count,
        "doc_collection_points": doc_count,
        "learned_collection_points": learned_count,
        "total_points": db_count + doc_count + learned_count,
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


@app.post("/v1/chat/completions", dependencies=[Depends(verify_api_key)])
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    stream = body.get("stream", False)
    household_id: str | None = body.get("household_id")

    if not messages:
        raise HTTPException(status_code=400, detail="messages is required")

    # Extract last user message for retrieval
    last_user = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"), ""
    )

    # Retrieve relevant context — learned first, then DB, then docs
    try:
        context_chunks = await search_combined(last_user, top_k_db=10, top_k_docs=10, household_id=household_id)
        if context_chunks:
            sources = [f"{c.get('source','?')}:{c.get('table', c.get('filename','?'))}" for c in context_chunks]
            log.info("Retrieved %d chunks for household %s: %s", len(context_chunks), household_id, sources)
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


# ── Admin endpoints (proxy to ingest-worker) ──────────────────────────────────

async def _proxy_to_ingest_worker(path: str) -> dict:
    """Forward an ingest trigger to the ingest-worker service."""
    if not settings.ingest_worker_url:
        return {"status": "unavailable", "message": "ingest-worker not configured"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{settings.ingest_worker_url}{path}")
            return resp.json()
    except Exception as e:
        log.warning("Proxy to ingest-worker failed: %s", e)
        return {"status": "error", "message": str(e)}


@app.post("/admin/ingest")
async def trigger_ingest():
    result = await _proxy_to_ingest_worker("/sync/db")
    return {"status": "proxied", "ingest_worker": result}


@app.post("/admin/ingest/docs")
async def trigger_doc_ingest():
    """Docs-only re-ingest — called automatically after file uploads."""
    result = await _proxy_to_ingest_worker("/sync/files")
    return {"status": "proxied", "ingest_worker": result}


@app.get("/admin/stats")
async def stats():
    from app.retrieval import get_qdrant

    client = get_qdrant()
    db_count = collection_count(settings.qdrant_collection_db)
    doc_count = collection_count(settings.qdrant_collection_docs)
    learned_count = collection_count(settings.qdrant_collection_learned)

    return {
        "fintech_rag_db": {
            "collection": settings.qdrant_collection_db,
            "total_points": db_count,
            "description": "Live database records (synced by ingest-worker)",
        },
        "fintech_rag_docs": {
            "collection": settings.qdrant_collection_docs,
            "total_points": doc_count,
            "description": "Uploaded document chunks (financial & property PDFs)",
        },
        "fintech_rag_learned": {
            "collection": settings.qdrant_collection_learned,
            "total_points": learned_count,
            "description": "Saved ChatGPT Q&A pairs (highest retrieval priority)",
        },
        "total_points": db_count + doc_count + learned_count,
        "llm_model": settings.llm_model,
        "embed_model": settings.embed_model,
        "ingest_worker_url": settings.ingest_worker_url,
    }


@app.post("/admin/learn", dependencies=[Depends(verify_api_key)])
async def save_learned(request: Request):
    """Save a ChatGPT Q&A pair to the knowledge base for a household."""
    body = await request.json()
    question = (body.get("question") or "").strip()
    answer = (body.get("answer") or "").strip()
    household_id = (body.get("household_id") or "").strip()

    if not question or not answer:
        raise HTTPException(status_code=400, detail="question and answer are required")

    # Deterministic ID so re-saving the same question replaces the previous answer
    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"learned:{household_id}:{question[:200]}"))

    await upsert_points(
        [{
            "id": point_id,
            "text": question,
            "payload": {
                "source": "learned",
                "question": question,
                "answer": answer,
                "household_id": household_id,
                "saved_at": datetime.now(timezone.utc).isoformat(),
            },
        }],
        settings.qdrant_collection_learned,
    )
    log.info("Saved learned Q&A for household %s: %s", household_id, question[:80])
    return {"status": "saved", "id": point_id}


@app.get("/admin/learned", dependencies=[Depends(verify_api_key)])
async def list_learned(household_id: str | None = None):
    """List saved Q&A pairs, optionally filtered by household."""
    from app.retrieval import get_qdrant
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    client = get_qdrant()
    scroll_filter = None
    if household_id:
        scroll_filter = Filter(
            must=[FieldCondition(key="household_id", match=MatchValue(value=household_id))]
        )

    results, _ = client.scroll(
        collection_name=settings.qdrant_collection_learned,
        scroll_filter=scroll_filter,
        limit=100,
        with_payload=True,
    )
    return {
        "items": [
            {
                "id": str(r.id),
                "question": r.payload.get("question"),
                "answer": r.payload.get("answer"),
                "saved_at": r.payload.get("saved_at"),
            }
            for r in results
        ]
    }
