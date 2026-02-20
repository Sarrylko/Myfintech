"""
Recurring transaction detection service.

Groups transactions by normalized merchant name + amount, then looks for
regular date intervals (weekly, bi-weekly, monthly, quarterly, annual).
"""
import re
import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from statistics import median, stdev
from typing import Any


# ─── Frequency definitions ────────────────────────────────────────────────────

FREQUENCY_RANGES: dict[str, tuple[int, int]] = {
    "weekly":    (5,   10),
    "biweekly":  (11,  18),
    "monthly":   (25,  35),
    "quarterly": (80, 100),
    "annual":   (350, 380),
}

FREQUENCY_ADVANCE_DAYS: dict[str, int] = {
    "weekly":    7,
    "biweekly":  14,
    "monthly":   30,
    "quarterly": 91,
    "annual":   365,
}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _normalize_name(name: str) -> str:
    """Lowercase, strip trailing store numbers and punctuation."""
    name = name.lower().strip()
    name = re.sub(r"\s*#\s*\d+\s*$", "", name)           # trailing #123
    name = re.sub(r"\s+\d{4,}\s*$", "", name)             # trailing long numbers
    name = re.sub(r"[^\w\s]", " ", name)                   # punctuation → space
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _to_date(dt: Any) -> date:
    if hasattr(dt, "date"):
        return dt.date()
    return dt


def _classify_interval(median_days: float) -> str | None:
    for freq, (lo, hi) in FREQUENCY_RANGES.items():
        if lo <= median_days <= hi:
            return freq
    return None


# ─── Main detector ────────────────────────────────────────────────────────────

def detect_recurring(transactions: list) -> list[dict]:
    """
    Analyse a list of Transaction ORM objects and return recurring candidates.

    Each candidate dict contains:
      key, name, merchant_name, amount, frequency, last_date,
      next_expected, occurrences, confidence, transaction_ids
    """
    # Group by (normalised_name, amount_bucket)
    # Amount bucket = rounded to nearest $0.50 to absorb tiny fee variations
    groups: dict[tuple[str, float], list] = defaultdict(list)

    for txn in transactions:
        if getattr(txn, "is_ignored", False):
            continue
        # Only look at debits (positive amounts in Plaid convention)
        try:
            amt = float(txn.amount)
        except (TypeError, ValueError):
            continue
        if amt <= 0:
            continue

        raw_name = txn.merchant_name or txn.name or ""
        if not raw_name.strip():
            continue

        norm = _normalize_name(raw_name)
        # Bucket: round to nearest $1 first; catches $14.99 / $15.00 pairs
        bucket = round(amt)
        groups[(norm, bucket)].append(txn)

    candidates: list[dict] = []

    for (norm_name, _bucket), txns in groups.items():
        if len(txns) < 3:
            continue

        # Sort chronologically
        sorted_txns = sorted(txns, key=lambda t: t.date)
        dates = [_to_date(t.date) for t in sorted_txns]

        # Compute day-intervals between consecutive occurrences
        intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        if not intervals:
            continue

        med = median(intervals)
        frequency = _classify_interval(med)
        if not frequency:
            continue

        # Consistency: lower std-dev relative to median = higher confidence
        if len(intervals) > 1:
            try:
                sd = stdev(intervals)
                # Tolerate up to ±3 days on a 30-day cycle without penalty
                tolerance = max(3.0, med * 0.10)
                consistency = max(0.0, 1.0 - sd / tolerance)
            except Exception:
                consistency = 0.5
        else:
            consistency = 0.6

        # Recency: transactions should have occurred in the last 6 months
        days_since_last = (date.today() - dates[-1]).days
        recency = max(0.0, 1.0 - days_since_last / 180)

        # Occurrence bonus (more occurrences = more confident)
        occ_score = min(1.0, len(txns) / 8)

        confidence = round(consistency * 0.5 + occ_score * 0.3 + recency * 0.2, 3)

        last_date = dates[-1]
        advance = FREQUENCY_ADVANCE_DAYS.get(frequency, int(med))
        next_expected = last_date + timedelta(days=advance)

        # Use the most-recent transaction's name as the display label
        best_name = sorted_txns[-1].merchant_name or sorted_txns[-1].name
        merchant_name = sorted_txns[-1].merchant_name

        # Use median amount (more stable than the bucket)
        amounts = sorted([float(t.amount) for t in sorted_txns])
        typical_amount = Decimal(str(median(amounts))).quantize(Decimal("0.01"))

        candidates.append({
            "key": f"{norm_name}|{float(typical_amount)}|{frequency}",
            "name": best_name,
            "merchant_name": merchant_name,
            "amount": typical_amount,
            "frequency": frequency,
            "last_date": last_date.isoformat(),
            "next_expected": next_expected.isoformat(),
            "occurrences": len(txns),
            "confidence": confidence,
            "transaction_ids": [str(t.id) for t in sorted_txns],
        })

    # Sort: highest confidence first, then most occurrences
    candidates.sort(key=lambda c: (-c["confidence"], -c["occurrences"]))
    return candidates
