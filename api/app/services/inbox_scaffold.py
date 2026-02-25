"""
Inbox folder scaffolding — creates the expected drop-folder tree on startup.

Called once at watcher boot and re-called on each poll cycle (idempotent)
so that folders for newly added properties appear automatically.
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.property import Property
from app.services.inbox_parser import VALID_DOCUMENT_TYPES, VALID_PROPERTY_CATEGORIES, slugify

logger = logging.getLogger(__name__)

# Document types that get year-numbered sub-folders (annual documents)
_YEAR_TYPES = frozenset({"tax", "investment", "income"})

# How many past years to scaffold (current year + N years back)
_PAST_YEARS = 5


def scaffold_inbox(inbox_root: Path, db: Session, household_id) -> None:
    """
    Idempotently create the full inbox folder tree.

    financial/{type}/               — all 8 document types
    financial/{type}/{year}/        — for tax, investment, income only
    properties/{slug}/{category}/   — one tree per property in the DB
    _processed/                     — successful imports land here
    _errors/                        — unrecognised / failed files land here
    """
    current_year = datetime.now(timezone.utc).year
    years = range(current_year - _PAST_YEARS, current_year + 1)

    # ── Financial folders ───────────────────────────────────────────────────
    for doc_type in VALID_DOCUMENT_TYPES:
        type_dir = inbox_root / "financial" / doc_type
        type_dir.mkdir(parents=True, exist_ok=True)
        if doc_type in _YEAR_TYPES:
            for year in years:
                (type_dir / str(year)).mkdir(exist_ok=True)

    # ── Property folders ────────────────────────────────────────────────────
    properties = db.execute(
        select(Property).where(Property.household_id == household_id)
    ).scalars().all()

    for prop in properties:
        slug = slugify(prop.address)
        prop_dir = inbox_root / "properties" / slug
        prop_dir.mkdir(parents=True, exist_ok=True)
        for cat in VALID_PROPERTY_CATEGORIES:
            (prop_dir / cat).mkdir(exist_ok=True)

    # ── System folders ──────────────────────────────────────────────────────
    (inbox_root / "_processed").mkdir(exist_ok=True)
    (inbox_root / "_errors").mkdir(exist_ok=True)

    logger.debug("Inbox scaffolded at %s (%d properties)", inbox_root, len(properties))
