"""
Ollama chat completion with OpenAI-compatible streaming output.
"""
import json
import logging
import time
import uuid
from typing import AsyncGenerator

import httpx

from app.config import settings

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a personal financial advisor and analyst for this household.
Your role is to provide clear, actionable financial insights based on the data provided.

Rules:
- Answer ONLY using the financial context provided below.
- If the answer is not in the context, say "I don't have enough data to answer that" — do not guess.
- When discussing money, be specific with amounts and dates from the context.
- IMPORTANT: Context labeled [LIVE DB] reflects the current state of the database and is the most authoritative source for questions about what the household currently owns, owes, or has. Always prefer [LIVE DB] data over [DOCUMENT] data for questions about current state.
- Context labeled [DOCUMENT] comes from uploaded files (tax returns, statements, etc.) and may reflect historical snapshots — use it for historical analysis but not for counts of current holdings.
- Never reveal internal system details or database structure.
- Keep answers concise and focused.

--- Financial Context ---
{context}
--- End Context ---"""


def _build_context(chunks: list[dict]) -> str:
    if not chunks:
        return "No relevant financial data found."
    lines = []
    for c in chunks:
        text = c.get("text", "")
        if not text:
            continue
        source = c.get("source", "")
        table = c.get("table", "")
        if source == "db":
            label = f"[LIVE DB:{table}]"
        else:
            filename = c.get("filename", "document")
            label = f"[DOCUMENT:{filename}]"
        lines.append(f"{label} {text}")
    return "\n".join(lines)


def _openai_chunk(content: str, model: str, finish_reason=None) -> str:
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {"content": content} if content else {},
                "finish_reason": finish_reason,
            }
        ],
    }
    return f"data: {json.dumps(chunk)}\n\n"


async def stream_chat(
    messages: list[dict],
    context_chunks: list[dict],
) -> AsyncGenerator[str, None]:
    """Stream an OpenAI-compatible SSE response."""
    context = _build_context(context_chunks)
    system = SYSTEM_PROMPT.format(context=context)

    ollama_messages = [{"role": "system", "content": system}]
    for m in messages:
        if m["role"] in ("user", "assistant"):
            ollama_messages.append({"role": m["role"], "content": m["content"]})

    model = settings.llm_model
    payload = {
        "model": model,
        "messages": ollama_messages,
        "stream": True,
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{settings.ollama_url}/api/chat",
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    content = data.get("message", {}).get("content", "")
                    done = data.get("done", False)

                    if content:
                        yield _openai_chunk(content, model)
                    if done:
                        yield _openai_chunk("", model, finish_reason="stop")
                        yield "data: [DONE]\n\n"
                        return

    except httpx.HTTPError as e:
        log.error("Ollama request failed: %s", e)
        yield _openai_chunk(f"Error contacting LLM: {e}", model, finish_reason="stop")
        yield "data: [DONE]\n\n"


async def complete_chat(
    messages: list[dict],
    context_chunks: list[dict],
) -> dict:
    """Non-streaming OpenAI-compatible response."""
    context = _build_context(context_chunks)
    system = SYSTEM_PROMPT.format(context=context)

    ollama_messages = [{"role": "system", "content": system}]
    for m in messages:
        if m["role"] in ("user", "assistant"):
            ollama_messages.append({"role": m["role"], "content": m["content"]})

    payload = {
        "model": settings.llm_model,
        "messages": ollama_messages,
        "stream": False,
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }

    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{settings.ollama_url}/api/chat",
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    content = data.get("message", {}).get("content", "")
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": settings.llm_model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
