"""
One-time backfill script — extract text from all existing PDFs that were
uploaded before the extracted_text column was added.

Run once after the d1e2f3a4b5c6 migration:

    docker exec myfintech-api-1 bash -c \\
        "export PYTHONPATH=/app && python -m app.scripts.backfill_extracted_text"

The script is safe to re-run: it only processes rows where extracted_text IS NULL
and the file is a PDF. Non-PDF rows and already-processed rows are skipped.
"""
import logging
import sys
from pathlib import Path

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.financial_document import FinancialDocument
from app.models.property import PropertyDocument
from app.services.pdf_extractor import extract_pdf_text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("backfill")

engine = create_engine(settings.database_url_sync)
SessionLocal = sessionmaker(bind=engine)

PDF_MIME = "application/pdf"


def backfill_financial(db) -> tuple[int, int, int]:
    """Returns (processed, extracted, scanned)."""
    rows = db.execute(
        select(FinancialDocument).where(
            FinancialDocument.extracted_text.is_(None),
            FinancialDocument.content_type == PDF_MIME,
        )
    ).scalars().all()

    processed = extracted = scanned = 0
    for doc in rows:
        file_path = (
            Path(settings.upload_dir)
            / "financial"
            / str(doc.household_id)
            / doc.stored_filename
        )
        if not file_path.exists():
            logger.warning("  ✗ file missing on disk: %s", doc.stored_filename)
            processed += 1
            continue

        text = extract_pdf_text(str(file_path))
        db.execute(
            update(FinancialDocument)
            .where(FinancialDocument.id == doc.id)
            .values(extracted_text=text)
        )
        processed += 1
        if text:
            extracted += 1
            logger.info("  ✓ %s  (%d chars)", doc.filename, len(text))
        else:
            scanned += 1
            logger.info("  ─ %s  (scanned / no text layer)", doc.filename)

    db.commit()
    return processed, extracted, scanned


def backfill_property(db) -> tuple[int, int, int]:
    rows = db.execute(
        select(PropertyDocument).where(
            PropertyDocument.extracted_text.is_(None),
            PropertyDocument.content_type == PDF_MIME,
        )
    ).scalars().all()

    processed = extracted = scanned = 0
    for doc in rows:
        file_path = (
            Path(settings.upload_dir)
            / "properties"
            / str(doc.property_id)
            / doc.stored_filename
        )
        if not file_path.exists():
            logger.warning("  ✗ file missing on disk: %s", doc.stored_filename)
            processed += 1
            continue

        text = extract_pdf_text(str(file_path))
        db.execute(
            update(PropertyDocument)
            .where(PropertyDocument.id == doc.id)
            .values(extracted_text=text)
        )
        processed += 1
        if text:
            extracted += 1
            logger.info("  ✓ %s  (%d chars)", doc.filename, len(text))
        else:
            scanned += 1
            logger.info("  ─ %s  (scanned / no text layer)", doc.filename)

    db.commit()
    return processed, extracted, scanned


def main() -> None:
    logger.info("Starting extracted_text backfill...")

    with SessionLocal() as db:
        logger.info("── Financial documents ──────────────────────")
        fp, fe, fs = backfill_financial(db)
        logger.info("   processed=%d  extracted=%d  scanned=%d", fp, fe, fs)

        logger.info("── Property documents ───────────────────────")
        pp, pe, ps = backfill_property(db)
        logger.info("   processed=%d  extracted=%d  scanned=%d", pp, pe, ps)

    total = fp + pp
    if total == 0:
        logger.info("Nothing to backfill — all existing PDFs already have extracted_text.")
    else:
        logger.info(
            "Backfill complete. Total=%d  extracted=%d  scanned=%d",
            total, fe + pe, fs + ps,
        )


if __name__ == "__main__":
    main()
    sys.exit(0)
