"""
Synthetic summary chunks — one per entity type, lists all items.
Used for 'how many / list / count' type queries.
Always full re-compute (not watermarked).
"""
import logging
import uuid

log = logging.getLogger(__name__)


def _fmt_money(val) -> str:
    if val is None:
        return "unknown"
    return f"${float(val):,.2f}"


def generate_summary_chunks(all_points: list[dict]) -> list[dict]:
    from collections import defaultdict
    by_table: dict[str, list[dict]] = defaultdict(list)
    for p in all_points:
        tbl = p["payload"].get("table", "")
        if tbl:
            by_table[tbl].append(p)

    summaries = []

    # Properties
    props = by_table.get("properties", [])
    if props:
        lines = []
        for i, p in enumerate(props, 1):
            addr = p["payload"].get("address", "Unknown address")
            lines.append(f"  {i}. {addr}")
        text = f"Household property inventory — {len(props)} properties total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:properties")),
            "text": text,
            "payload": {"source": "db", "table": "property_summary", "record_id": "summary"},
        })

    # Accounts
    accounts = by_table.get("accounts", [])
    if accounts:
        lines = []
        for i, p in enumerate(accounts, 1):
            bal = p["payload"].get("balance")
            bal_str = f" — {_fmt_money(bal)}" if bal is not None else ""
            chunk_text = p.get("text", "")
            label = chunk_text.split(",")[0].replace("Account: ", "").strip("'") if chunk_text else "Account"
            lines.append(f"  {i}. {label}{bal_str}")
        text = f"Household accounts — {len(accounts)} accounts total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:accounts")),
            "text": text,
            "payload": {"source": "db", "table": "account_summary", "record_id": "summary"},
        })

    # Loans
    loans = by_table.get("loans", [])
    if loans:
        lines = []
        for i, p in enumerate(loans, 1):
            bal = p["payload"].get("balance")
            bal_str = f" — {_fmt_money(bal)}" if bal is not None else ""
            chunk_text = p.get("text", "")
            label = chunk_text.split(",")[0].replace("Loan: ", "").strip() if chunk_text else "Loan"
            lines.append(f"  {i}. {label}{bal_str}")
        text = f"Household loans — {len(loans)} loans total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:loans")),
            "text": text,
            "payload": {"source": "db", "table": "loan_summary", "record_id": "summary"},
        })

    # Holdings
    holdings = by_table.get("holdings", [])
    if holdings:
        lines = []
        for i, p in enumerate(holdings, 1):
            ticker = p["payload"].get("ticker") or ""
            val = p["payload"].get("current_value")
            val_str = f" — {_fmt_money(val)}" if val is not None else ""
            ticker_str = f" ({ticker})" if ticker else ""
            chunk_text = p.get("text", "")
            label = chunk_text.split("(")[0].replace("Investment holding: ", "").strip() if chunk_text else "Holding"
            lines.append(f"  {i}. {label}{ticker_str}{val_str}")
        text = f"Investment portfolio — {len(holdings)} holdings total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:holdings")),
            "text": text,
            "payload": {"source": "db", "table": "holding_summary", "record_id": "summary"},
        })

    # Business entities
    biz = by_table.get("business_entities", [])
    if biz:
        lines = []
        for i, p in enumerate(biz, 1):
            etype = p["payload"].get("entity_type", "entity")
            chunk_text = p.get("text", "")
            label = chunk_text.split("(")[0].replace("Business entity: ", "").strip() if chunk_text else "Entity"
            lines.append(f"  {i}. {label} ({etype})")
        text = f"Business entities — {len(biz)} entities total:\n" + "\n".join(lines)
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:business_entities")),
            "text": text,
            "payload": {"source": "db", "table": "entity_summary", "record_id": "summary"},
        })

    # Insurance
    ins_pts = by_table.get("insurance_policies", [])
    if ins_pts:
        lines = []
        total_annual = 0.0
        for i, p in enumerate(ins_pts, 1):
            ptype = (p["payload"].get("policy_type") or "policy").replace("_", " ").title()
            provider = p["payload"].get("provider", "Unknown")
            annual = p["payload"].get("annual_premium")
            annual_str = f" — {_fmt_money(annual)}/year" if annual else ""
            total_annual += annual or 0.0
            lines.append(f"  {i}. {ptype} — {provider}{annual_str}")
        total_str = f", total annual premium: {_fmt_money(total_annual)}" if total_annual else ""
        text = (
            f"Household insurance portfolio — {len(ins_pts)} active polic"
            f"{'y' if len(ins_pts) == 1 else 'ies'}{total_str}:\n"
            + "\n".join(lines)
        )
        summaries.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "summary:insurance")),
            "text": text,
            "payload": {"source": "db", "table": "insurance_summary", "record_id": "summary"},
        })

    log.info("Generated %d summary chunks", len(summaries))
    return summaries
