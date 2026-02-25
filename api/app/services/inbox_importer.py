"""
Inbox file importer — handles DB inserts and file operations.

Called by the watcher for each new file found in the inbox.
Uses synchronous SQLAlchemy (psycopg2) since the watcher is not an async context.
"""
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.financial_document import FinancialDocument
from app.models.property import Property, PropertyDocument
from app.services.inbox_parser import (
    FinancialImport,
    ParseResult,
    PropertyImport,
    match_property_slug,
)
from app.services.pdf_extractor import extract_pdf_text

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

_MIME_MAP: dict[str, str] = {
    "pdf":  "application/pdf",
    "doc":  "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls":  "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv":  "text/csv",
    "txt":  "text/plain",
    "png":  "image/png",
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "heic": "image/heic",
    "webp": "image/webp",
}


def import_inbox_file(
    file_path: Path,
    parse_result: ParseResult,
    db: Session,
    household_id: uuid.UUID,
    errors_root: Path,
    processed_root: Path,
) -> bool:
    """
    Import a single file from the inbox into uploads_data + DB.

    Returns True on success (including graceful dedup skips).
    Returns False and moves the file to _errors/ on any failure.
    """
    # ── Basic file validation ───────────────────────────────────────────────
    ext = file_path.suffix.lstrip(".").lower()
    if ext not in _MIME_MAP:
        move_to_errors(file_path, errors_root, f"Unsupported file type: .{ext}")
        return False

    try:
        size = file_path.stat().st_size
    except OSError as exc:
        move_to_errors(file_path, errors_root, f"Cannot stat file: {exc}")
        return False

    if size > MAX_FILE_SIZE:
        move_to_errors(
            file_path, errors_root,
            f"File too large: {size:,} bytes (max {MAX_FILE_SIZE // 1024 // 1024} MB)"
        )
        return False

    content_type = _MIME_MAP[ext]

    if isinstance(parse_result, FinancialImport):
        return _import_financial(
            file_path, parse_result, db, household_id, content_type, size,
            errors_root, processed_root,
        )
    if isinstance(parse_result, PropertyImport):
        return _import_property(
            file_path, parse_result, db, household_id, content_type, size,
            errors_root, processed_root,
        )
    return False


# ── Financial document ───────────────────────────────────────────────────────

def _import_financial(
    file_path: Path,
    result: FinancialImport,
    db: Session,
    household_id: uuid.UUID,
    content_type: str,
    size: int,
    errors_root: Path,
    processed_root: Path,
) -> bool:
    # Dedup: same filename + type + year + household already imported?
    existing = db.execute(
        select(FinancialDocument).where(
            FinancialDocument.household_id == household_id,
            FinancialDocument.filename == file_path.name,
            FinancialDocument.document_type == result.document_type,
            FinancialDocument.reference_year == result.reference_year,
        )
    ).scalar_one_or_none()

    if existing:
        logger.info("Skipping duplicate financial doc: %s", file_path.name)
        move_to_processed(file_path, processed_root)
        return True

    # Copy file into uploads_data volume
    stored_name = f"{uuid.uuid4()}_{file_path.name}"
    dest_dir = Path(settings.upload_dir) / "financial" / str(household_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / stored_name

    try:
        shutil.copy2(file_path, dest_path)
    except OSError as exc:
        move_to_errors(file_path, errors_root, f"File copy failed: {exc}")
        return False

    extracted_text = extract_pdf_text(str(dest_path))

    try:
        doc = FinancialDocument(
            household_id=household_id,
            document_type=result.document_type,
            category=result.category,
            reference_year=result.reference_year,
            filename=file_path.name,
            stored_filename=stored_name,
            file_size=size,
            content_type=content_type,
            description="Auto-imported from inbox",
            extracted_text=extracted_text,
        )
        db.add(doc)
        db.commit()
    except Exception as exc:
        db.rollback()
        dest_path.unlink(missing_ok=True)  # clean up copied file
        move_to_errors(file_path, errors_root, f"DB insert failed: {exc}")
        return False

    move_to_processed(file_path, processed_root)
    logger.info(
        "Imported financial doc: %s  type=%s  year=%s  text=%s",
        file_path.name, result.document_type, result.reference_year,
        f"{len(extracted_text)} chars" if extracted_text else "none (scanned)",
    )
    return True


# ── Property document ────────────────────────────────────────────────────────

def _import_property(
    file_path: Path,
    result: PropertyImport,
    db: Session,
    household_id: uuid.UUID,
    content_type: str,
    size: int,
    errors_root: Path,
    processed_root: Path,
) -> bool:
    # Resolve slug → property
    properties = db.execute(
        select(Property).where(Property.household_id == household_id)
    ).scalars().all()

    prop = match_property_slug(result.property_slug, properties)
    if not prop:
        move_to_errors(
            file_path, errors_root,
            f"No property matching folder name '{result.property_slug}'. "
            f"Available slugs: {[__import__('app.services.inbox_parser', fromlist=['slugify']).slugify(p.address) for p in properties]}"
        )
        return False

    # Dedup: same filename + property already imported?
    existing = db.execute(
        select(PropertyDocument).where(
            PropertyDocument.property_id == prop.id,
            PropertyDocument.filename == file_path.name,
        )
    ).scalar_one_or_none()

    if existing:
        logger.info("Skipping duplicate property doc: %s", file_path.name)
        move_to_processed(file_path, processed_root)
        return True

    # Copy file into uploads_data volume
    stored_name = f"{uuid.uuid4()}_{file_path.name}"
    dest_dir = Path(settings.upload_dir) / "properties" / str(prop.id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / stored_name

    try:
        shutil.copy2(file_path, dest_path)
    except OSError as exc:
        move_to_errors(file_path, errors_root, f"File copy failed: {exc}")
        return False

    extracted_text = extract_pdf_text(str(dest_path))

    try:
        doc = PropertyDocument(
            property_id=prop.id,
            household_id=household_id,
            filename=file_path.name,
            stored_filename=stored_name,
            file_size=size,
            content_type=content_type,
            category=result.category,
            description="Auto-imported from inbox",
            extracted_text=extracted_text,
        )
        db.add(doc)
        db.commit()
    except Exception as exc:
        db.rollback()
        dest_path.unlink(missing_ok=True)
        move_to_errors(file_path, errors_root, f"DB insert failed: {exc}")
        return False

    move_to_processed(file_path, processed_root)
    logger.info(
        "Imported property doc: %s  property=%s  category=%s",
        file_path.name, prop.address, result.category,
    )
    return True


# ── File movement helpers ────────────────────────────────────────────────────

def move_to_processed(file_path: Path, processed_root: Path) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dest_dir = processed_root / today
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / file_path.name
    if dest.exists():
        dest = dest_dir / f"{file_path.stem}_{uuid.uuid4().hex[:6]}{file_path.suffix}"
    shutil.move(str(file_path), dest)


def move_to_errors(file_path: Path, errors_root: Path, reason: str) -> None:
    errors_root.mkdir(parents=True, exist_ok=True)
    dest = errors_root / file_path.name
    if dest.exists():
        dest = errors_root / f"{file_path.stem}_{uuid.uuid4().hex[:6]}{file_path.suffix}"
    try:
        shutil.move(str(file_path), dest)
    except OSError:
        pass  # file may have been removed already
    reason_file = errors_root / f"{dest.name}.reason.txt"
    reason_file.write_text(reason, encoding="utf-8")
    logger.warning("→ _errors/: %s — %s", file_path.name, reason)
