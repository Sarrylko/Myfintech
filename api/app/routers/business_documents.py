import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.business_document import BusinessDocument
from app.models.business_entity import BusinessEntity
from app.models.user import User
from app.schemas.business_document import BusinessDocumentResponse
from app.services.pdf_extractor import extract_pdf_text

router = APIRouter(tags=["business-documents"])

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE = 1024 * 1024           # 1 MB

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
    ext = Path(filename).suffix.lstrip(".").lower()
    mime = _ALLOWED.get(ext)
    if mime is None:
        raise HTTPException(
            status_code=400,
            detail=f"File type '.{ext}' not allowed. Allowed: {', '.join(sorted(_ALLOWED))}",
        )
    return mime


async def _get_entity(entity_id: uuid.UUID, user: User, db: AsyncSession) -> BusinessEntity:
    result = await db.execute(
        select(BusinessEntity).where(
            BusinessEntity.id == entity_id,
            BusinessEntity.household_id == user.household_id,
        )
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Business entity not found")
    return entity


# ── List ──────────────────────────────────────────────────────────────────────

@router.get(
    "/business-entities/{entity_id}/documents",
    response_model=list[BusinessDocumentResponse],
)
async def list_documents(
    entity_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity(entity_id, user, db)
    result = await db.execute(
        select(BusinessDocument)
        .where(BusinessDocument.entity_id == entity_id)
        .order_by(BusinessDocument.uploaded_at.desc())
    )
    return result.scalars().all()


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post(
    "/business-entities/{entity_id}/documents",
    response_model=BusinessDocumentResponse,
    status_code=201,
)
async def upload_document(
    entity_id: uuid.UUID,
    file: UploadFile = File(...),
    category: str | None = Form(None),
    description: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity(entity_id, user, db)

    original_name = file.filename or "upload"
    mime = _validate_upload(original_name)

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
    dir_path = Path(settings.upload_dir) / "business" / str(entity_id)
    dir_path.mkdir(parents=True, exist_ok=True)
    file_path = dir_path / stored_name
    file_path.write_bytes(content)

    extracted_text = extract_pdf_text(str(file_path))

    doc = BusinessDocument(
        entity_id=entity_id,
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


# ── Download ──────────────────────────────────────────────────────────────────

@router.get("/business-entities/{entity_id}/documents/{doc_id}/download")
async def download_document(
    entity_id: uuid.UUID,
    doc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity(entity_id, user, db)

    result = await db.execute(
        select(BusinessDocument).where(
            BusinessDocument.id == doc_id,
            BusinessDocument.entity_id == entity_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(settings.upload_dir) / "business" / str(entity_id) / doc.stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(path=str(file_path), filename=doc.filename, media_type=doc.content_type)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/business-entities/{entity_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    entity_id: uuid.UUID,
    doc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_entity(entity_id, user, db)

    result = await db.execute(
        select(BusinessDocument).where(
            BusinessDocument.id == doc_id,
            BusinessDocument.entity_id == entity_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(settings.upload_dir) / "business" / str(entity_id) / doc.stored_filename
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        pass

    await db.delete(doc)
    await db.flush()
