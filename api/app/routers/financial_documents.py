import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.financial_document import FinancialDocument
from app.models.user import User
from app.schemas.financial_document import FinancialDocumentResponse

router = APIRouter(tags=["financial-documents"])

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB streaming chunks

# Allowed file extensions and their canonical MIME types.
# Client-supplied Content-Type is ignored; we derive it from the extension.
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


# ─── List ────────────────────────────────────────────────────────────────────

@router.get("/financial-documents", response_model=list[FinancialDocumentResponse])
async def list_financial_documents(
    year: int | None = None,
    document_type: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(FinancialDocument)
        .where(FinancialDocument.household_id == user.household_id)
        .order_by(FinancialDocument.uploaded_at.desc())
    )
    if year is not None:
        query = query.where(FinancialDocument.reference_year == year)
    if document_type is not None:
        query = query.where(FinancialDocument.document_type == document_type)
    result = await db.execute(query)
    return result.scalars().all()


# ─── Upload ───────────────────────────────────────────────────────────────────

@router.post("/financial-documents", response_model=FinancialDocumentResponse, status_code=201)
async def upload_financial_document(
    file: UploadFile = File(...),
    document_type: str = Form("other"),
    category: str = Form("other"),
    reference_year: int | None = Form(None),
    owner_user_id: uuid.UUID | None = Form(None),
    description: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
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
    dir_path = Path(settings.upload_dir) / "financial" / str(user.household_id)
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / stored_name).write_bytes(content)

    doc = FinancialDocument(
        household_id=user.household_id,
        owner_user_id=owner_user_id,
        document_type=document_type,
        category=category,
        reference_year=reference_year,
        filename=original_name,
        stored_filename=stored_name,
        file_size=total,
        content_type=mime,
        description=description or None,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)
    return doc


# ─── Download ─────────────────────────────────────────────────────────────────

@router.get("/financial-documents/{doc_id}/download")
async def download_financial_document(
    doc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FinancialDocument).where(
            FinancialDocument.id == doc_id,
            FinancialDocument.household_id == user.household_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = (
        Path(settings.upload_dir) / "financial" / str(user.household_id) / doc.stored_filename
    )
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(path=str(file_path), filename=doc.filename, media_type=doc.content_type)


# ─── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/financial-documents/{doc_id}", status_code=204)
async def delete_financial_document(
    doc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FinancialDocument).where(
            FinancialDocument.id == doc_id,
            FinancialDocument.household_id == user.household_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = (
        Path(settings.upload_dir) / "financial" / str(user.household_id) / doc.stored_filename
    )
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        pass

    await db.delete(doc)
    await db.flush()
