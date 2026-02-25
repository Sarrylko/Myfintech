"""
Inbox path parser — pure functions, no DB, fully unit-testable.

Converts a file path relative to the inbox root into a structured
import request (FinancialImport or PropertyImport) or a ParseError.

Expected folder conventions
────────────────────────────
Financial documents:
  financial/{type}/{filename}           → type, year=None
  financial/{type}/{4-digit-year}/{fn}  → type, year=YYYY

Property documents:
  properties/{address-slug}/{filename}              → category="other"
  properties/{address-slug}/{category}/{filename}   → category

System folders (_processed, _errors) are NOT parsed — the watcher
skips them before calling this module.
"""
import re
from dataclasses import dataclass
from pathlib import Path

# ── Valid values ────────────────────────────────────────────────────────────

VALID_DOCUMENT_TYPES = frozenset(
    {"tax", "investment", "retirement", "insurance", "banking", "income", "estate", "other"}
)

VALID_PROPERTY_CATEGORIES = frozenset(
    {"deed", "insurance", "inspection", "permits", "photos", "maintenance", "legal", "other"}
)

_YEAR_PATTERN = re.compile(r"^\d{4}$")
_YEAR_MIN = 1990
_YEAR_MAX = 2100


# ── Result types ────────────────────────────────────────────────────────────

@dataclass
class FinancialImport:
    document_type: str      # one of VALID_DOCUMENT_TYPES
    category: str           # same as document_type (refined later if needed)
    reference_year: int | None


@dataclass
class PropertyImport:
    property_slug: str      # slugified address, e.g. "123-main-st"
    category: str           # one of VALID_PROPERTY_CATEGORIES


@dataclass
class ParseError:
    reason: str


ParseResult = FinancialImport | PropertyImport | ParseError


# ── Public API ───────────────────────────────────────────────────────────────

def parse_inbox_path(relative_path: Path) -> ParseResult:
    """
    Parse a path relative to the inbox root.

    ``relative_path`` must NOT include the inbox root itself.
    Example:  parse_inbox_path(Path("financial/tax/2024/W2.pdf"))
    """
    parts = relative_path.parts

    if len(parts) < 2:
        return ParseError(f"Path too shallow (need at least root/filename): {relative_path}")

    root = parts[0].lower()

    if root == "financial":
        return _parse_financial(parts)
    if root == "properties":
        return _parse_property(parts)

    return ParseError(
        f"Unknown root folder '{parts[0]}'. Expected 'financial' or 'properties'."
    )


def slugify(text: str) -> str:
    """
    Convert an address string to a safe, lowercase folder slug.

    "123 Main St, Chicago IL 60601" → "123-main-st-chicago-il-60601"
    """
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)   # strip punctuation except hyphen
    text = re.sub(r"[\s_]+", "-", text)     # spaces/underscores → hyphens
    text = re.sub(r"-{2,}", "-", text)      # collapse consecutive hyphens
    return text.strip("-")


def match_property_slug(folder_slug: str, properties: list) -> object | None:
    """
    Return the first Property whose address slug matches folder_slug, or None.

    ``properties`` is a list of ORM Property objects with an ``address`` field.
    """
    folder_slug = folder_slug.lower()
    for prop in properties:
        if slugify(prop.address) == folder_slug:
            return prop
    return None


# ── Private helpers ─────────────────────────────────────────────────────────

def _parse_financial(parts: tuple[str, ...]) -> ParseResult:
    # parts[0] = "financial"
    # parts[1] = document_type
    # parts[2] = year (optional) OR filename
    # parts[3] = filename (when year present)

    if len(parts) < 3:
        return ParseError(
            "Financial path needs: financial/{type}/{filename} "
            "or financial/{type}/{year}/{filename}"
        )

    doc_type = parts[1].lower()
    if doc_type not in VALID_DOCUMENT_TYPES:
        return ParseError(
            f"Unknown document_type '{doc_type}'. "
            f"Valid types: {sorted(VALID_DOCUMENT_TYPES)}"
        )

    # Three parts = financial/{type}/{filename} — no year
    if len(parts) == 3:
        return FinancialImport(document_type=doc_type, category=doc_type, reference_year=None)

    # Four+ parts: parts[2] might be a year folder
    candidate = parts[2]
    if _YEAR_PATTERN.match(candidate):
        year = int(candidate)
        if not (_YEAR_MIN <= year <= _YEAR_MAX):
            return ParseError(
                f"Year {year} is outside valid range ({_YEAR_MIN}–{_YEAR_MAX})."
            )
        return FinancialImport(document_type=doc_type, category=doc_type, reference_year=year)

    # Non-year intermediate folder — treat as no-year (graceful fallback)
    return FinancialImport(document_type=doc_type, category=doc_type, reference_year=None)


def _parse_property(parts: tuple[str, ...]) -> ParseResult:
    # parts[0] = "properties"
    # parts[1] = property slug
    # parts[2] = category folder OR filename
    # parts[3] = filename (when category folder present)

    if len(parts) < 3:
        return ParseError(
            "Property path needs: properties/{slug}/{filename} "
            "or properties/{slug}/{category}/{filename}"
        )

    prop_slug = parts[1].lower()

    # Three parts = properties/{slug}/{filename} — no category subfolder
    if len(parts) == 3:
        return PropertyImport(property_slug=prop_slug, category="other")

    # Four+ parts: parts[2] is a category folder
    category = parts[2].lower()
    if category not in VALID_PROPERTY_CATEGORIES:
        category = "other"  # unknown category folder → fallback gracefully

    return PropertyImport(property_slug=prop_slug, category=category)
