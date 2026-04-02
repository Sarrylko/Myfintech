"""
Receipt parsing service — two providers:

  local   → pdfplumber (PDF text layer) + Ollama qwen2.5 text model
             OR Ollama llava (if installed) for images / scanned PDFs
  claude  → Claude claude-sonnet-4-6 vision API (best accuracy, handles all formats)

The provider is chosen at upload time by the user.
"""
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import ReceiptLineItem, TransactionReceipt
from app.services.pdf_extractor import extract_pdf_text

logger = logging.getLogger(__name__)

CATEGORY_LIST = (
    # Food & Dining
    "Groceries, Restaurants, Coffee Shops, Fast Food, Food Delivery, Alcohol & Bars, "
    # Shopping
    "General Merchandise, Clothing, Electronics, Home Improvement, Personal Care Products, Gifts, "
    # Housing
    "Maintenance & Repairs, Furnishings, Cleaning Services, "
    # Health & Medical
    "Pharmacy, Doctor Visits, Dental, Vision, Fitness / Gym, "
    # Transportation
    "Fuel, Parking, Tolls, Vehicle Maintenance, "
    # Entertainment
    "Movies, Streaming Services, Gaming, Hobbies, Subscriptions, "
    # Personal Care
    "Salon / Spa, Haircuts, Cosmetics, Wellness, "
    # Financial
    "Bank Fees, Interest Paid, Tax Payments, "
    # Miscellaneous
    "Uncategorized"
)

JSON_SCHEMA = (
    '{"merchant": "...", "date": "YYYY-MM-DD or null", '
    '"items": [{"description": "...", "amount": 0.00, "suggested_category": "..."}], '
    '"subtotal": 0.00, "tax": 0.00, "total": 0.00}'
)

SYSTEM_PROMPT = (
    "You are a receipt parser. Extract every line item from the receipt provided. "
    "Return ONLY valid JSON with this exact structure — no markdown, no commentary:\n"
    f"{JSON_SCHEMA}\n\n"
    f"Use one of these categories: {CATEGORY_LIST}\n"
    "Rules:\n"
    "- amount must be a positive number (ignore refunds / negative lines)\n"
    "- Include tax as a separate item if shown\n"
    "- If a line has quantity × price, use the line total as amount\n"
    "- description should be the item name, concise (max 100 chars)"
)


# ─── Shared response parser ────────────────────────────────────────────────────

def _parse_response(raw: str) -> list[dict]:
    """Parse JSON line items from any LLM response string."""
    raw = raw.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])

    data = json.loads(raw)
    items = data.get("items", [])
    result = []
    for idx, item in enumerate(items):
        desc = str(item.get("description", "")).strip()[:500]
        if not desc:
            continue
        try:
            amount = Decimal(str(item.get("amount", 0)))
        except Exception:
            amount = Decimal("0")
        if amount <= 0:
            continue
        result.append({
            "description": desc,
            "amount": amount,
            "ai_category": str(item.get("suggested_category", "Other"))[:255],
            "sort_order": idx,
        })
    return result


# ─── Local / Ollama paths ──────────────────────────────────────────────────────

def _ollama_url() -> str:
    url = settings.ollama_receipt_url.rstrip("/")
    if not url:
        raise RuntimeError(
            "OLLAMA_RECEIPT_URL is not configured. "
            "Set it in .env to the Ollama URL reachable from the API container "
            "(e.g. http://172.21.0.4:11434) and restart."
        )
    return url


def _call_ollama_text(text: str, transaction_amount: Decimal) -> list[dict]:
    """Parse receipt text using Ollama text model (qwen2.5:7b-instruct)."""
    user_msg = (
        f"Transaction total on record: ${transaction_amount}\n\n"
        f"Receipt text:\n{text}"
    )
    payload = {
        "model": "qwen2.5:7b-instruct",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "stream": False,
        "options": {"temperature": 0.1},
    }
    with httpx.Client(timeout=120) as client:
        resp = client.post(f"{_ollama_url()}/api/chat", json=payload)
        resp.raise_for_status()
    content = resp.json()["message"]["content"]
    return _parse_response(content)


def _call_ollama_vision(file_path: str, transaction_amount: Decimal) -> list[dict]:
    """
    Parse receipt image using Ollama llava vision model.
    Raises RuntimeError if llava is not installed.
    """
    # Check if llava is available
    with httpx.Client(timeout=10) as client:
        tags_resp = client.get(f"{_ollama_url()}/api/tags")
        tags_resp.raise_for_status()
        models = [m["name"] for m in tags_resp.json().get("models", [])]

    vision_model = next((m for m in models if "llava" in m or "moondream" in m or "bakllava" in m), None)
    if not vision_model:
        raise RuntimeError(
            "No vision model found in local Ollama. "
            "Pull one first: docker exec fintech-ollama ollama pull llava:7b\n"
            "Or use Claude AI parsing instead."
        )

    with open(file_path, "rb") as f:
        image_b64 = base64.standard_b64encode(f.read()).decode("utf-8")

    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Transaction total on record: ${transaction_amount}\n\nExtract all line items from this receipt image.",
                "images": [image_b64],
            },
        ],
        "stream": False,
        "options": {"temperature": 0.1},
    }
    with httpx.Client(timeout=180) as client:
        resp = client.post(f"{_ollama_url()}/api/chat", json=payload)
        resp.raise_for_status()
    content = resp.json()["message"]["content"]
    return _parse_response(content)


# ─── Claude paths ──────────────────────────────────────────────────────────────

def _call_claude_text(text: str, transaction_amount: Decimal) -> list[dict]:
    """Parse receipt text via Claude text API."""
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed. Rebuild the API container.")

    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set in .env")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    user_msg = (
        f"Transaction total on record: ${transaction_amount}\n\n"
        f"Receipt text:\n{text}"
    )
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": user_msg}],
        system=SYSTEM_PROMPT,
    )
    return _parse_response(response.content[0].text)


def _call_claude_vision(file_path: str, content_type: str, transaction_amount: Decimal) -> list[dict]:
    """Parse receipt image via Claude Vision API."""
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed. Rebuild the API container.")

    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set in .env")

    with open(file_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    media_type_map = {
        "image/jpeg": "image/jpeg",
        "image/jpg": "image/jpeg",
        "image/png": "image/png",
        "image/gif": "image/gif",
        "image/webp": "image/webp",
        "image/heic": "image/jpeg",
        "application/pdf": "application/pdf",
    }
    media_type = media_type_map.get(content_type.lower(), "image/jpeg")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    if media_type == "application/pdf":
        content = [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": image_data}},
            {"type": "text", "text": f"Transaction total on record: ${transaction_amount}\n\nExtract all line items from this receipt."},
        ]
    else:
        content = [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_data}},
            {"type": "text", "text": f"Transaction total on record: ${transaction_amount}\n\nExtract all line items from this receipt."},
        ]

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}],
        system=SYSTEM_PROMPT,
    )
    return _parse_response(response.content[0].text)


# ─── Main entry point ──────────────────────────────────────────────────────────

async def parse_receipt(receipt_id: uuid.UUID, db: AsyncSession, provider: str = "local") -> None:
    """
    Parse a receipt using the specified provider.
    provider: "local" (Ollama) | "claude" (Anthropic API)
    """
    result = await db.execute(
        select(TransactionReceipt).where(TransactionReceipt.id == receipt_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        logger.error("Receipt %s not found", receipt_id)
        return

    receipt.status = "parsing"
    await db.commit()

    file_path = os.path.join(
        settings.upload_dir, "receipts", str(receipt.household_id), receipt.stored_filename
    )
    txn_amount = _get_transaction_amount(receipt)

    try:
        line_items_data: list[dict] = []

        if provider == "claude":
            # Claude path: text for PDFs with text layer, vision for everything else
            if receipt.content_type == "application/pdf":
                text = extract_pdf_text(file_path)
                if text:
                    receipt.extracted_text = text
                    line_items_data = _call_claude_text(text, txn_amount)
                else:
                    line_items_data = _call_claude_vision(file_path, receipt.content_type, txn_amount)
            else:
                line_items_data = _call_claude_vision(file_path, receipt.content_type, txn_amount)

        else:
            # Local Ollama path
            if receipt.content_type == "application/pdf":
                text = extract_pdf_text(file_path)
                if text:
                    receipt.extracted_text = text
                    line_items_data = _call_ollama_text(text, txn_amount)
                else:
                    # Scanned PDF — needs vision model
                    line_items_data = _call_ollama_vision(file_path, txn_amount)
            else:
                # Image — needs vision model
                line_items_data = _call_ollama_vision(file_path, txn_amount)

        # Replace existing line items (re-parse scenario)
        existing = await db.execute(
            select(ReceiptLineItem).where(ReceiptLineItem.receipt_id == receipt_id)
        )
        for item in existing.scalars().all():
            await db.delete(item)

        for item_data in line_items_data:
            db.add(ReceiptLineItem(
                receipt_id=receipt_id,
                transaction_id=receipt.transaction_id,
                household_id=receipt.household_id,
                description=item_data["description"],
                amount=item_data["amount"],
                ai_category=item_data["ai_category"],
                sort_order=item_data["sort_order"],
                is_confirmed=False,
            ))

        receipt.status = "parsed"
        receipt.parsed_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info("Receipt %s parsed (%s): %d line items", receipt_id, provider, len(line_items_data))

    except Exception as exc:
        logger.error("Receipt %s parse failed (%s): %s", receipt_id, provider, exc, exc_info=True)
        receipt.status = "failed"
        receipt.parse_error = str(exc)[:2000]
        await db.commit()


def _get_transaction_amount(receipt: TransactionReceipt) -> Decimal:
    try:
        return receipt.transaction.amount
    except Exception:
        return Decimal("0")
