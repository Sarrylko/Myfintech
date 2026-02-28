"""
Ingests uploaded financial and property documents into Qdrant.
Priority: use extracted_text from DB (fast). Fallback: read PDF from disk via pdfplumber.
"""
import logging
import os
import uuid
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import create_engine, text

from app.config import settings
from app.retrieval import upsert_points

log = logging.getLogger(__name__)

CHUNK_SIZE = 1200        # characters per chunk
CHUNK_OVERLAP = 200      # overlap between consecutive chunks


def _engine():
    url = settings.database_url.replace("+asyncpg", "")
    return create_engine(url, pool_pre_ping=True)


def _chunk_text(text: str) -> list[str]:
    """Split text into overlapping character-level chunks."""
    if not text or not text.strip():
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end].strip())
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return [c for c in chunks if c]


def _extract_pdf(path: str) -> str:
    """Extract text from a PDF using pdfplumber."""
    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            pages = [p.extract_text() or "" for p in pdf.pages]
        return "\n".join(pages).strip()
    except Exception as e:
        log.warning("pdfplumber failed for %s: %s", path, e)
        return ""


def _resolve_path(doc_root: str, subdir: str, identifier: str, stored_filename: str) -> str:
    """Build the file path: {doc_root}/{subdir}/{identifier}/{stored_filename}"""
    return os.path.join(doc_root, subdir, identifier, stored_filename)


async def _ingest_financial_documents(conn, all_points: list, doc_root: str):
    rows = conn.execute(text("""
        SELECT
            fd.id, fd.household_id, fd.document_type, fd.category,
            fd.reference_year, fd.filename, fd.stored_filename,
            fd.description, fd.extracted_text
        FROM financial_documents fd
        ORDER BY fd.uploaded_at DESC
    """)).fetchall()

    count = 0
    for r in rows:
        # Use pre-extracted text from DB when available
        raw_text = r.extracted_text
        if not raw_text:
            file_path = _resolve_path(doc_root, "financial", str(r.household_id), r.stored_filename)
            if os.path.exists(file_path):
                raw_text = _extract_pdf(file_path)

        if not raw_text:
            continue

        prefix = (
            f"Document: {r.filename} "
            f"(type: {r.document_type}, category: {r.category}"
            + (f", year: {r.reference_year}" if r.reference_year else "")
            + (f", description: {r.description}" if r.description else "")
            + ")\n\n"
        )

        for i, chunk in enumerate(_chunk_text(raw_text)):
            all_points.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"fdoc:{r.id}:chunk:{i}")),
                "text": prefix + chunk,
                "payload": {
                    "source": "doc",
                    "table": "financial_documents",
                    "record_id": str(r.id),
                    "household_id": str(r.household_id),
                    "document_type": r.document_type,
                    "category": r.category,
                    "reference_year": r.reference_year,
                    "filename": r.filename,
                    "chunk_index": i,
                },
            })
        count += 1

    log.info("Prepared chunks for %d financial documents", count)


async def _ingest_property_documents(conn, all_points: list, doc_root: str):
    rows = conn.execute(text("""
        SELECT
            pd.id, pd.household_id, pd.property_id,
            pd.filename, pd.stored_filename, pd.category,
            pd.description, pd.extracted_text,
            p.address AS property_address
        FROM property_documents pd
        LEFT JOIN properties p ON p.id = pd.property_id
        ORDER BY pd.uploaded_at DESC
    """)).fetchall()

    count = 0
    for r in rows:
        raw_text = r.extracted_text
        if not raw_text:
            file_path = _resolve_path(doc_root, "properties", str(r.property_id), r.stored_filename)
            if os.path.exists(file_path):
                raw_text = _extract_pdf(file_path)

        if not raw_text:
            continue

        prop_label = r.property_address or str(r.property_id)
        prefix = (
            f"Property document for {prop_label}: {r.filename} "
            f"(category: {r.category}"
            + (f", description: {r.description}" if r.description else "")
            + ")\n\n"
        )

        for i, chunk in enumerate(_chunk_text(raw_text)):
            all_points.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"pdoc:{r.id}:chunk:{i}")),
                "text": prefix + chunk,
                "payload": {
                    "source": "doc",
                    "table": "property_documents",
                    "record_id": str(r.id),
                    "household_id": str(r.household_id),
                    "property_id": str(r.property_id),
                    "category": r.category,
                    "filename": r.filename,
                    "chunk_index": i,
                },
            })
        count += 1

    log.info("Prepared chunks for %d property documents", count)


async def run_doc_ingest():
    """Ingest all financial and property documents."""
    log.info("Starting document ingest...")
    doc_root = settings.finance_doc_root
    engine = _engine()
    all_points: list = []

    with engine.connect() as conn:
        try:
            await _ingest_financial_documents(conn, all_points, doc_root)
        except Exception as e:
            log.warning("Financial document ingest failed: %s", e)
        try:
            await _ingest_property_documents(conn, all_points, doc_root)
        except Exception as e:
            log.warning("Property document ingest failed: %s", e)

    engine.dispose()

    if not all_points:
        log.info("No document chunks to upsert.")
        return 0

    log.info("Embedding and upserting %d document chunks...", len(all_points))
    from app.retrieval import upsert_points
    await upsert_points(all_points)
    log.info("Document ingest complete — %d chunks upserted.", len(all_points))
    return len(all_points)
