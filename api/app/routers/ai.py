"""
AI assistant proxy router.
Routes authenticated chat requests through to the RAG API,
injecting the user's household_id for multi-tenant filtering.

Endpoints:
  POST /ai/chat     — streaming chat completions (SSE)
  POST /ai/learn    — save a ChatGPT Q&A pair to the knowledge base
  GET  /ai/learned  — list saved Q&A pairs for the household
"""
import logging
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(tags=["ai"])
log = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class LearnRequest(BaseModel):
    question: str
    answer: str


def _rag_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.rag_api_key:
        headers["X-RAG-Api-Key"] = settings.rag_api_key
    return headers


def _require_rag() -> str:
    if not settings.rag_api_url:
        raise HTTPException(
            status_code=503,
            detail="AI assistant is not available. Start the AI stack with: docker compose -f docker-compose.ai.yml up -d",
        )
    return settings.rag_api_url


@router.post("/chat")
async def ai_chat(
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    """Stream a chat response from the RAG API, scoped to the user's household."""
    rag_url = _require_rag()

    payload = {
        "messages": [m.model_dump() for m in body.messages],
        "household_id": str(current_user.household_id),
        "stream": True,
    }

    async def _stream() -> AsyncIterator[bytes]:
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{rag_url}/v1/chat/completions",
                    json=payload,
                    headers=_rag_headers(),
                ) as resp:
                    resp.raise_for_status()
                    async for chunk in resp.aiter_bytes():
                        yield chunk
        except httpx.HTTPStatusError as e:
            log.error("RAG API returned %s: %s", e.response.status_code, e.response.text)
            yield b'data: {"error": "RAG API error"}\n\ndata: [DONE]\n\n'
        except httpx.HTTPError as e:
            log.error("RAG API connection error: %s", e)
            yield b'data: {"error": "Could not reach AI service"}\n\ndata: [DONE]\n\n'

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/learn")
async def save_learned_answer(
    body: LearnRequest,
    current_user: User = Depends(get_current_user),
):
    """Save a ChatGPT Q&A pair to the local knowledge base for this household."""
    rag_url = _require_rag()

    if not body.question.strip() or not body.answer.strip():
        raise HTTPException(status_code=400, detail="question and answer cannot be empty")

    payload = {
        "question": body.question.strip(),
        "answer": body.answer.strip(),
        "household_id": str(current_user.household_id),
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{rag_url}/admin/learn",
                json=payload,
                headers=_rag_headers(),
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as e:
        log.error("RAG learn request failed: %s", e)
        raise HTTPException(status_code=503, detail="Failed to save answer to knowledge base")


@router.get("/learned")
async def list_learned_answers(
    current_user: User = Depends(get_current_user),
):
    """List all Q&A pairs saved to this household's knowledge base."""
    rag_url = _require_rag()

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{rag_url}/admin/learned",
                params={"household_id": str(current_user.household_id)},
                headers=_rag_headers(),
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as e:
        log.error("RAG learned list request failed: %s", e)
        raise HTTPException(status_code=503, detail="Failed to fetch knowledge base")
