"""
PDF text extraction for financial and property documents.

Extracts selectable text from PDFs using pdfplumber.
Returns None for:
  - Non-PDF files (images, Word docs, etc.)
  - Scanned-only PDFs with no text layer
  - Any extraction failure

The caller stores the result in `extracted_text` on the document row.
Phase 2 LLM agent reads this field directly (fast path) and falls back
to Ollama vision inference only when extracted_text IS NULL.
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

try:
    import pdfplumber as _pdfplumber
    _AVAILABLE = True
except ImportError:
    _AVAILABLE = False
    logger.warning(
        "pdfplumber not installed — PDF text extraction disabled. "
        "Rebuild the Docker image to pick up requirements.txt changes."
    )


def extract_pdf_text(file_path: str) -> str | None:
    """
    Extract all text from a PDF file.

    Returns the full text (pages joined by double newline), or None if
    the file is not a PDF, has no text layer, or extraction fails.
    """
    if not _AVAILABLE:
        return None

    path = Path(file_path)
    if path.suffix.lower() != ".pdf":
        return None

    try:
        with _pdfplumber.open(file_path) as pdf:
            pages: list[str] = []
            for page in pdf.pages:
                text = page.extract_text()
                if text and text.strip():
                    pages.append(text.strip())

            if not pages:
                return None  # scanned / image-only PDF

            return "\n\n".join(pages)

    except Exception as exc:
        logger.warning("Text extraction failed for %s: %s", path.name, exc)
        return None
