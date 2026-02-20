import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import decrypt_value, encrypt_value
from app.models.account import Account, PlaidItem, Transaction
from app.models.property_details import Loan
from app.models.rule import CategorizationRule
from app.models.user import User

router = APIRouter(prefix="/plaid", tags=["plaid"])


# ─── Schemas ───────────────────────────────────────────────────────────────

class LinkTokenResponse(BaseModel):
    link_token: str


class PublicTokenExchange(BaseModel):
    public_token: str
    institution_id: str | None = None
    institution_name: str | None = None


class PlaidItemResponse(BaseModel):
    id: str
    item_id: str
    institution_name: str | None
    last_synced_at: datetime | None
    account_count: int = 0


class SyncResponse(BaseModel):
    status: str
    accounts: int
    transactions_added: int


# ─── Helpers ───────────────────────────────────────────────────────────────

def _build_plaid_client():
    if not settings.plaid_client_id or not settings.plaid_secret:
        raise HTTPException(status_code=503, detail="Plaid not configured")

    import plaid
    from plaid.api import plaid_api

    configuration = plaid.Configuration(
        host=getattr(plaid.Environment, settings.plaid_env.capitalize()),
        api_key={
            "clientId": settings.plaid_client_id,
            "secret": settings.plaid_secret,
        },
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


async def _sync_item(item: PlaidItem, client, db: AsyncSession) -> dict:
    """Pull accounts and new transactions from Plaid and upsert into DB."""
    from plaid.model.accounts_get_request import AccountsGetRequest
    from plaid.model.transactions_sync_request import TransactionsSyncRequest
    from app.routers.rules import apply_rules_to_txn

    access_token = decrypt_value(item.encrypted_access_token)

    # ── 1. Sync accounts ─────────────────────────────────────────────
    accts_resp = client.accounts_get(AccountsGetRequest(access_token=access_token))
    account_count = 0

    for pa in accts_resp.accounts:
        result = await db.execute(
            select(Account).where(Account.plaid_account_id == pa.account_id)
        )
        acct = result.scalar_one_or_none()
        curr_bal = Decimal(str(pa.balances.current)) if pa.balances.current is not None else None
        avail_bal = Decimal(str(pa.balances.available)) if pa.balances.available is not None else None

        if acct:
            acct.current_balance = curr_bal
            acct.available_balance = avail_bal
            # Propagate balance to any loan linked to this account
            if curr_bal is not None:
                linked_loans = await db.execute(select(Loan).where(Loan.account_id == acct.id))
                for loan in linked_loans.scalars().all():
                    loan.current_balance = curr_bal
        else:
            type_str = pa.type.value if hasattr(pa.type, "value") else str(pa.type)
            sub_str = pa.subtype.value if pa.subtype and hasattr(pa.subtype, "value") else (str(pa.subtype) if pa.subtype else None)
            acct = Account(
                plaid_item_id=item.id,
                household_id=item.household_id,
                plaid_account_id=pa.account_id,
                name=pa.name,
                official_name=pa.official_name,
                type=type_str,
                subtype=sub_str,
                mask=pa.mask,
                current_balance=curr_bal,
                available_balance=avail_bal,
                currency_code=pa.balances.iso_currency_code or "USD",
            )
            db.add(acct)
        account_count += 1

    await db.flush()

    # ── 1.5 Sync investment holdings ──────────────────────────────────────────
    try:
        from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest
        from app.models.investment import Holding

        holdings_resp = client.investments_holdings_get(
            InvestmentsHoldingsGetRequest(access_token=access_token)
        )
        sec_map = {s.security_id: s for s in (holdings_resp.securities or [])}

        # Get all account UUIDs for this Plaid item
        item_accts_result = await db.execute(
            select(Account).where(Account.plaid_item_id == item.id)
        )
        item_acct_ids = [a.id for a in item_accts_result.scalars().all()]

        # Delete stale holdings for this item's accounts
        for acct_id in item_acct_ids:
            old_h_result = await db.execute(select(Holding).where(Holding.account_id == acct_id))
            for old_h in old_h_result.scalars().all():
                await db.delete(old_h)
        await db.flush()

        # Insert fresh holdings
        for ph in (holdings_resp.holdings or []):
            a_result = await db.execute(
                select(Account).where(Account.plaid_account_id == ph.account_id)
            )
            h_acct = a_result.scalar_one_or_none()
            if not h_acct:
                continue
            sec = sec_map.get(ph.security_id)
            db.add(Holding(
                account_id=h_acct.id,
                household_id=item.household_id,
                security_id=ph.security_id,
                ticker_symbol=sec.ticker_symbol if sec else None,
                name=sec.name if sec else None,
                quantity=Decimal(str(ph.quantity)),
                cost_basis=Decimal(str(ph.cost_basis)) if ph.cost_basis is not None else None,
                current_value=Decimal(str(ph.institution_value)) if ph.institution_value is not None else None,
                as_of_date=datetime.now(timezone.utc),
            ))
    except Exception:
        pass  # Item may not have investments product enabled

    # Load active household rules once for the whole sync
    rules_result = await db.execute(
        select(CategorizationRule)
        .where(
            CategorizationRule.household_id == item.household_id,
            CategorizationRule.is_active == True,  # noqa: E712
        )
        .order_by(CategorizationRule.priority.desc())
    )
    rules = rules_result.scalars().all()

    # Build plaid_account_id → account.type map for rule matching
    accts_map_result = await db.execute(
        select(Account).where(Account.household_id == item.household_id)
    )
    account_type_map: dict[str, str] = {
        a.plaid_account_id: a.type
        for a in accts_map_result.scalars().all()
        if a.plaid_account_id
    }

    # ── 2. Sync transactions (cursor-based) ───────────────────────────
    has_more = True
    cursor = item.cursor
    added_count = 0

    while has_more:
        if cursor:
            sync_req = TransactionsSyncRequest(access_token=access_token, cursor=cursor)
        else:
            sync_req = TransactionsSyncRequest(access_token=access_token)

        sync_resp = client.transactions_sync(sync_req)

        for pt in sync_resp.added:
            acct_result = await db.execute(
                select(Account).where(Account.plaid_account_id == pt.account_id)
            )
            acct = acct_result.scalar_one_or_none()
            if not acct:
                continue

            existing = await db.execute(
                select(Transaction).where(
                    Transaction.plaid_transaction_id == pt.transaction_id
                )
            )
            if existing.scalar_one_or_none():
                continue

            # Plaid returns date objects, convert to aware datetime
            d = pt.date
            txn_dt = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)

            # Normalize Plaid category array to "Group > Item" format
            if pt.category and len(pt.category) >= 2:
                plaid_cat = f"{pt.category[0]} > {pt.category[1]}"
            elif pt.category:
                plaid_cat = pt.category[0]
            else:
                plaid_cat = None

            txn = Transaction(
                account_id=acct.id,
                household_id=item.household_id,
                plaid_transaction_id=pt.transaction_id,
                amount=Decimal(str(pt.amount)),
                date=txn_dt,
                name=pt.name,
                merchant_name=pt.merchant_name,
                pending=pt.pending,
                plaid_category=plaid_cat,
                plaid_category_id=pt.category_id,
            )

            # Apply household categorization rules (same as CSV import)
            matched = False
            if rules:
                account_type = account_type_map.get(pt.account_id, acct.type)
                matched = apply_rules_to_txn(txn, account_type, rules)

            if not matched:
                txn.plaid_category = "Uncategorized"

            db.add(txn)
            added_count += 1

        cursor = sync_resp.next_cursor
        has_more = sync_resp.has_more

    item.cursor = cursor
    item.last_synced_at = datetime.now(timezone.utc)
    item.error_code = None
    await db.flush()

    return {"accounts": account_count, "transactions_added": added_count}


# ─── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/link-token", response_model=LinkTokenResponse)
async def create_link_token(user: User = Depends(get_current_user)):
    client = _build_plaid_client()

    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.products import Products
    from plaid.model.country_code import CountryCode

    request = LinkTokenCreateRequest(
        user=LinkTokenCreateRequestUser(client_user_id=str(user.id)),
        client_name="MyFintech",
        products=[Products("transactions")],
        optional_products=[Products("investments")],
        country_codes=[CountryCode("US")],
        language="en",
    )
    response = client.link_token_create(request)
    return LinkTokenResponse(link_token=response.link_token)


@router.get("/items", response_model=list[PlaidItemResponse])
async def list_items(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PlaidItem).where(
            PlaidItem.household_id == user.household_id,
            PlaidItem.is_active == True,
        )
    )
    items = result.scalars().all()

    out = []
    for item in items:
        acct_result = await db.execute(
            select(Account).where(Account.plaid_item_id == item.id)
        )
        account_count = len(acct_result.scalars().all())
        out.append(PlaidItemResponse(
            id=str(item.id),
            item_id=item.item_id,
            institution_name=item.institution_name,
            last_synced_at=item.last_synced_at,
            account_count=account_count,
        ))
    return out


@router.post("/exchange-token", response_model=PlaidItemResponse)
async def exchange_public_token(
    payload: PublicTokenExchange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = _build_plaid_client()

    from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest

    request = ItemPublicTokenExchangeRequest(public_token=payload.public_token)
    response = client.item_public_token_exchange(request)

    plaid_item = PlaidItem(
        household_id=user.household_id,
        institution_id=payload.institution_id,
        institution_name=payload.institution_name,
        encrypted_access_token=encrypt_value(response.access_token),
        item_id=response.item_id,
    )
    db.add(plaid_item)
    await db.flush()
    await db.refresh(plaid_item)

    # Immediately sync accounts + transactions
    try:
        await _sync_item(plaid_item, client, db)
    except Exception as e:
        # Don't fail the whole link if sync errors; user can sync manually
        plaid_item.error_code = str(e)[:100]

    acct_result = await db.execute(
        select(Account).where(Account.plaid_item_id == plaid_item.id)
    )
    account_count = len(acct_result.scalars().all())
    await db.commit()

    return PlaidItemResponse(
        id=str(plaid_item.id),
        item_id=response.item_id,
        institution_name=payload.institution_name,
        last_synced_at=plaid_item.last_synced_at,
        account_count=account_count,
    )


@router.post("/items/{item_id}/sync", response_model=SyncResponse)
async def sync_item(
    item_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PlaidItem).where(
            PlaidItem.id == item_id,
            PlaidItem.household_id == user.household_id,
            PlaidItem.is_active == True,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Institution not found")

    client = _build_plaid_client()
    stats = await _sync_item(item, client, db)
    await db.commit()
    return SyncResponse(status="ok", **stats)


@router.delete("/items/{item_id}", status_code=204)
async def delete_plaid_item(
    item_id: uuid.UUID,
    delete_transactions: bool = Query(default=True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a Plaid institution connection and all its accounts.
    If delete_transactions=True (default), also deletes all transactions.
    If delete_transactions=False, transactions are kept but unlinked (account_id set to NULL).
    """
    result = await db.execute(
        select(PlaidItem).where(
            PlaidItem.id == item_id,
            PlaidItem.household_id == user.household_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Institution not found")

    # Get all accounts linked to this institution
    accts_result = await db.execute(
        select(Account).where(Account.plaid_item_id == item.id)
    )
    accounts = accts_result.scalars().all()

    for acct in accounts:
        txns_result = await db.execute(
            select(Transaction).where(Transaction.account_id == acct.id)
        )
        for txn in txns_result.scalars().all():
            if delete_transactions:
                await db.delete(txn)
            else:
                txn.account_id = None
        await db.delete(acct)

    await db.delete(item)
    await db.commit()
