"""
AI assistant proxy router.
Routes authenticated chat requests through to the RAG API,
injecting the user's household_id for multi-tenant filtering.

Endpoints:
  GET  /ai/financial-picture  — return cached financial picture from Redis
  POST /ai/financial-picture  — stream fresh financial picture, save to Redis when done
  POST /ai/chat               — streaming chat completions (SSE)
  POST /ai/learn              — save a ChatGPT Q&A pair to the knowledge base
  GET  /ai/learned            — list saved Q&A pairs for the household
"""
import json
import logging
from datetime import datetime, timezone
from typing import AsyncIterator, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_async_db
from app.core.deps import get_current_user
from app.core.redis import get_redis
from app.models.account import Account
from app.models.financial_document import FinancialDocument as FinancialDocumentModel
from app.models.investment import Holding
from app.models.networth import NetWorthSnapshot
from app.models.property import Property
from app.models.property_details import Loan
from app.models.rental import Lease, Unit
from app.models.user import User
from app.services.financial_picture import CACHE_TTL, _build_prompt, cache_key

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


@router.get("/financial-picture")
async def get_financial_picture_cache(
    year: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
):
    """Return the cached financial picture report for this household, or null if not yet generated."""
    resolved_year = year or (datetime.now(timezone.utc).year - 1)
    rdb = await get_redis()
    raw = await rdb.get(cache_key(str(current_user.household_id), resolved_year))
    if not raw:
        return {"cached": False, "report_text": None, "generated_at": None, "year": resolved_year}
    data = json.loads(raw)
    return {"cached": True, **data}


@router.post("/financial-picture")
async def generate_financial_picture(
    year: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Stream a fresh financial picture report (documents + live DB).
    Saves the completed report to Redis cache when generation finishes.
    """
    rag_url = _require_rag()
    resolved_year = year or (datetime.now(timezone.utc).year - 1)
    hid = str(current_user.household_id)

    # ── Fetch documents ──────────────────────────────────────────────────────
    q = (
        select(FinancialDocumentModel)
        .where(FinancialDocumentModel.household_id == current_user.household_id)
        .order_by(FinancialDocumentModel.document_type, FinancialDocumentModel.reference_year)
    )
    if year is not None:
        q = q.where(FinancialDocumentModel.reference_year == year)
    docs = (await db.execute(q)).scalars().all()

    if not docs:
        yr_clause = f" for {resolved_year}" if year else ""
        manifest = f"No financial documents uploaded{yr_clause}."
        doc_count = 0
    else:
        lines = [f"Total documents: {len(docs)}\n"]
        by_type: dict[str, list] = {}
        for doc in docs:
            by_type.setdefault(doc.document_type, []).append(doc)
        for dtype, group in sorted(by_type.items()):
            lines.append(f"\n{dtype.upper()} ({len(group)} file{'s' if len(group) != 1 else ''}):")
            for doc in group:
                yr_tag = f" [{doc.reference_year}]" if doc.reference_year else ""
                desc_tag = f" — {doc.description}" if doc.description else ""
                lines.append(f"  • {doc.filename}{yr_tag}{desc_tag}")
        manifest = "\n".join(lines)
        doc_count = len(docs)

    # ── Build live DB snapshot (async) ───────────────────────────────────────
    live_lines: list[str] = []

    accounts = (await db.execute(
        select(Account).where(
            Account.household_id == current_user.household_id,
            Account.is_hidden == False,  # noqa: E712
        )
    )).scalars().all()
    if accounts:
        cash = sum(float(a.current_balance or 0) for a in accounts if a.type == "depository")
        credit = sum(float(a.current_balance or 0) for a in accounts if a.type == "credit")
        invest = sum(float(a.current_balance or 0) for a in accounts if a.type == "investment")
        live_lines.append(f"\nACCOUNTS (live, {len(accounts)} total):")
        live_lines.append(f"  Cash/Depository: ${cash:,.2f}  |  Investment: ${invest:,.2f}  |  Credit: ${credit:,.2f}")
        for a in accounts:
            live_lines.append(f"  • {a.name} ({a.type}/{a.subtype or '—'}) — ${float(a.current_balance or 0):,.2f}")

    snapshots = (await db.execute(
        select(NetWorthSnapshot)
        .where(NetWorthSnapshot.household_id == current_user.household_id)
        .order_by(NetWorthSnapshot.snapshot_date.desc())
        .limit(3)
    )).scalars().all()
    if snapshots:
        live_lines.append(f"\nNET WORTH SNAPSHOTS (latest {len(snapshots)}):")
        for s in snapshots:
            live_lines.append(
                f"  • {s.snapshot_date.date()}: ${float(s.net_worth):,.2f} net worth "
                f"(Cash ${float(s.total_cash):,.2f} | Inv ${float(s.total_investments):,.2f} "
                f"| RE ${float(s.total_real_estate):,.2f} | Debt ${float(s.total_debts):,.2f})"
            )

    properties = (await db.execute(
        select(Property).where(Property.household_id == current_user.household_id)
    )).scalars().all()
    if properties:
        prop_ids = [p.id for p in properties]
        loans = (await db.execute(select(Loan).where(Loan.property_id.in_(prop_ids)))).scalars().all()
        loans_by_prop: dict[str, list] = {}
        for loan in loans:
            loans_by_prop.setdefault(str(loan.property_id), []).append(loan)
        live_lines.append(f"\nPROPERTIES (live, {len(properties)} total):")
        for p in properties:
            prop_loans = loans_by_prop.get(str(p.id), [])
            total_debt = sum(float(l.current_balance or 0) for l in prop_loans)
            equity = float(p.current_value or 0) - total_debt
            live_lines.append(
                f"  • {p.address}: Value ${float(p.current_value or 0):,.2f} | "
                f"Mortgage ${total_debt:,.2f} | Equity ${equity:,.2f}"
            )

    h_row = (await db.execute(
        select(func.sum(Holding.current_value), func.count(Holding.id))
        .where(Holding.household_id == current_user.household_id, Holding.quantity > 0)
    )).one()
    if h_row[1] and h_row[1] > 0:
        live_lines.append(f"\nHOLDINGS (live): {h_row[1]} positions, total ${float(h_row[0] or 0):,.2f}")

    units = (await db.execute(
        select(Unit).where(Unit.household_id == current_user.household_id)
    )).scalars().all()
    if units:
        unit_ids = [u.id for u in units]
        active_leases = (await db.execute(
            select(Lease).where(Lease.unit_id.in_(unit_ids), Lease.status == "active")
        )).scalars().all()
        if active_leases:
            monthly_rent = sum(float(l.monthly_rent or 0) for l in active_leases)
            live_lines.append(
                f"\nACTIVE LEASES: {len(active_leases)} leases, "
                f"${monthly_rent:,.2f}/mo (${monthly_rent * 12:,.2f}/yr)"
            )

    live_snapshot = "\n".join(live_lines) if live_lines else "No live database records found."
    year_context = f"for tax year {resolved_year}"
    prompt = _build_prompt(manifest, live_snapshot, doc_count, year_context)

    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "household_id": hid,
        "stream": True,
    }

    async def _stream_and_cache() -> AsyncIterator[bytes]:
        accumulated = ""
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                async with client.stream(
                    "POST",
                    f"{rag_url}/v1/chat/completions",
                    json=payload,
                    headers=_rag_headers(),
                ) as resp:
                    resp.raise_for_status()
                    async for raw_line in resp.aiter_lines():
                        if not raw_line:
                            continue
                        # Accumulate content for caching
                        if raw_line.startswith("data: "):
                            data = raw_line[6:].strip()
                            if data not in ("[DONE]", ""):
                                try:
                                    chunk = json.loads(data)
                                    content = (
                                        chunk.get("choices", [{}])[0]
                                        .get("delta", {})
                                        .get("content", "")
                                    )
                                    if content:
                                        accumulated += content
                                except Exception:
                                    pass
                        yield (raw_line + "\n").encode()
        except httpx.HTTPStatusError as e:
            log.error("RAG API %s for financial-picture: %s", e.response.status_code, e.response.text)
            yield b'data: {"error": "RAG API error"}\n'
        except httpx.HTTPError as e:
            log.error("RAG connection error for financial-picture: %s", e)
            yield b'data: {"error": "Could not reach AI service"}\n'
        finally:
            yield b"data: [DONE]\n\n"
            # Save accumulated report to Redis cache
            if accumulated:
                try:
                    rdb = await get_redis()
                    await rdb.set(
                        cache_key(hid, resolved_year),
                        json.dumps({
                            "report_text": accumulated,
                            "generated_at": datetime.now(timezone.utc).isoformat(),
                            "year": resolved_year,
                        }),
                        ex=CACHE_TTL,
                    )
                    log.info("Cached on-demand financial picture for household %s year %d", hid, resolved_year)
                except Exception as e:
                    log.warning("Redis cache write failed: %s", e)

    return StreamingResponse(
        _stream_and_cache(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
