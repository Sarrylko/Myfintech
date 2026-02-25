import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.property import Property, PropertyDocument
from app.models.user import User
from app.schemas.property_document import PropertyDocumentResponse
from app.services.pdf_extractor import extract_pdf_text

router = APIRouter(tags=["property-documents"])

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB streaming chunks

_ALLOWED: dict[str, str] = {
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


def _validate_upload(filename: str) -> str:
    """Return the safe MIME type for the file, or raise 400."""
    ext = Path(filename).suffix.lstrip(".").lower()
    mime = _ALLOWED.get(ext)
    if mime is None:
        allowed = ", ".join(sorted(_ALLOWED))
        raise HTTPException(
            status_code=400,
            detail=f"File type '.{ext}' is not allowed. Allowed: {allowed}",
        )
    return mime


# ─── Helper: verify property ownership ───────────────────────────────────────

async def _get_property(
    property_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Property:
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.household_id == user.household_id,
        )
    )
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


# ─── List documents ───────────────────────────────────────────────────────────

@router.get("/properties/{property_id}/documents", response_model=list[PropertyDocumentResponse])
async def list_documents(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    result = await db.execute(
        select(PropertyDocument)
        .where(PropertyDocument.property_id == property_id)
        .order_by(PropertyDocument.uploaded_at.desc())
    )
    return result.scalars().all()


# ─── Upload document ──────────────────────────────────────────────────────────

@router.post("/properties/{property_id}/documents", response_model=PropertyDocumentResponse, status_code=201)
async def upload_document(
    property_id: uuid.UUID,
    file: UploadFile = File(...),
    category: str | None = Form(None),
    description: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)

    original_name = file.filename or "upload"
    mime = _validate_upload(original_name)

    # Stream the upload in chunks to avoid loading the entire file into RAM
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 50 MB)")
        chunks.append(chunk)
    content = b"".join(chunks)

    stored_name = f"{uuid.uuid4()}_{original_name}"
    dir_path = Path(settings.upload_dir) / "properties" / str(property_id)
    dir_path.mkdir(parents=True, exist_ok=True)
    file_path = dir_path / stored_name
    file_path.write_bytes(content)

    extracted_text = extract_pdf_text(str(file_path))

    doc = PropertyDocument(
        property_id=property_id,
        household_id=user.household_id,
        filename=original_name,
        stored_filename=stored_name,
        file_size=total,
        content_type=mime,
        category=category or None,
        description=description or None,
        extracted_text=extracted_text,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)
    return doc


# ─── Download document ────────────────────────────────────────────────────────

@router.get("/properties/{property_id}/documents/{doc_id}/download")
async def download_document(
    property_id: uuid.UUID,
    doc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)

    result = await db.execute(
        select(PropertyDocument).where(
            PropertyDocument.id == doc_id,
            PropertyDocument.property_id == property_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(settings.upload_dir) / "properties" / str(property_id) / doc.stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        filename=doc.filename,
        media_type=doc.content_type,
    )


# ─── Delete document ──────────────────────────────────────────────────────────

@router.delete("/properties/{property_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    property_id: uuid.UUID,
    doc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)

    result = await db.execute(
        select(PropertyDocument).where(
            PropertyDocument.id == doc_id,
            PropertyDocument.property_id == property_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove file from disk (best-effort — don't fail if already gone)
    file_path = Path(settings.upload_dir) / "properties" / str(property_id) / doc.stored_filename
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        pass

    await db.delete(doc)
    await db.flush()
