"""
Document ingest: financial, property, and business uploaded documents.
Uses extracted_text from DB when available; falls back to pdfplumber on disk.
"""
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

from app.config import settings
from app.hasher import hash_text

log = logging.getLogger(__name__)

CHUNK_SIZE = 500
CHUNK_OVERLAP = 100


def _chunk_text(text: str) -> list[str]:
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
    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            pages = [p.extract_text() or "" for p in pdf.pages]
        return "\n".join(pages).strip()
    except Exception as e:
        log.warning("pdfplumber failed for %s: %s", path, e)
        return ""


def _resolve_path(subdir: str, identifier: str, stored_filename: str) -> str:
    return os.path.join(settings.finance_doc_root, subdir, identifier, stored_filename)


def ingest_financial_documents(conn, points: list, since: datetime | None = None) -> int:
    clause = "AND fd.uploaded_at > :since" if since else ""
    params = {"since": since} if since else {}
    rows = conn.execute(text(f"""
        SELECT
            fd.id, fd.household_id, fd.document_type, fd.category,
            fd.reference_year, fd.filename, fd.stored_filename,
            fd.description, fd.extracted_text
        FROM financial_documents fd
        WHERE 1=1 {clause}
        ORDER BY fd.uploaded_at DESC
    """), params).fetchall()

    count = 0
    for r in rows:
        raw_text = r.extracted_text
        if not raw_text:
            file_path = _resolve_path("financial", str(r.household_id), r.stored_filename)
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
            text_val = prefix + chunk
            points.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"fdoc:{r.id}:chunk:{i}")),
                "text": text_val,
                "payload": {
                    "source": "doc", "table": "financial_documents",
                    "record_id": str(r.id), "household_id": str(r.household_id),
                    "document_type": r.document_type, "category": r.category,
                    "reference_year": r.reference_year, "filename": r.filename,
                    "stored_filename": r.stored_filename, "chunk_index": i,
                },
            })
        count += 1

    log.info("Prepared chunks for %d financial documents", count)
    return count


def ingest_property_documents(conn, points: list, since: datetime | None = None) -> int:
    clause = "AND pd.uploaded_at > :since" if since else ""
    params = {"since": since} if since else {}
    rows = conn.execute(text(f"""
        SELECT
            pd.id, pd.household_id, pd.property_id,
            pd.filename, pd.stored_filename, pd.category,
            pd.description, pd.extracted_text,
            p.address AS property_address
        FROM property_documents pd
        LEFT JOIN properties p ON p.id = pd.property_id
        WHERE 1=1 {clause}
        ORDER BY pd.uploaded_at DESC
    """), params).fetchall()

    count = 0
    for r in rows:
        raw_text = r.extracted_text
        if not raw_text:
            file_path = _resolve_path("properties", str(r.property_id), r.stored_filename)
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
            text_val = prefix + chunk
            points.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"pdoc:{r.id}:chunk:{i}")),
                "text": text_val,
                "payload": {
                    "source": "doc", "table": "property_documents",
                    "record_id": str(r.id), "household_id": str(r.household_id),
                    "property_id": str(r.property_id), "category": r.category,
                    "filename": r.filename, "stored_filename": r.stored_filename,
                    "chunk_index": i,
                },
            })
        count += 1

    log.info("Prepared chunks for %d property documents", count)
    return count


def ingest_business_documents(conn, points: list, since: datetime | None = None) -> int:
    clause = "AND bd.uploaded_at > :since" if since else ""
    params = {"since": since} if since else {}
    rows = conn.execute(text(f"""
        SELECT
            bd.id, bd.household_id, bd.entity_id,
            bd.filename, bd.stored_filename, bd.category,
            bd.description, bd.extracted_text,
            be.name AS entity_name
        FROM business_documents bd
        LEFT JOIN business_entities be ON be.id = bd.entity_id
        WHERE 1=1 {clause}
        ORDER BY bd.uploaded_at DESC
    """), params).fetchall()

    count = 0
    for r in rows:
        raw_text = r.extracted_text
        if not raw_text:
            file_path = _resolve_path("business", str(r.entity_id), r.stored_filename)
            if os.path.exists(file_path):
                raw_text = _extract_pdf(file_path)
        if not raw_text:
            continue

        entity_label = r.entity_name or str(r.entity_id)
        prefix = (
            f"Business document for {entity_label}: {r.filename} "
            f"(category: {r.category}"
            + (f", description: {r.description}" if r.description else "")
            + ")\n\n"
        )

        for i, chunk in enumerate(_chunk_text(raw_text)):
            text_val = prefix + chunk
            points.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"bdoc:{r.id}:chunk:{i}")),
                "text": text_val,
                "payload": {
                    "source": "doc", "table": "business_documents",
                    "record_id": str(r.id), "household_id": str(r.household_id),
                    "entity_id": str(r.entity_id), "entity_name": r.entity_name,
                    "category": r.category, "filename": r.filename,
                    "stored_filename": r.stored_filename, "chunk_index": i,
                },
            })
        count += 1

    log.info("Prepared chunks for %d business documents", count)
    return count
