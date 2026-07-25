import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import decrypt_value, encrypt_value
from app.models.account import Account, PlaidItem
from app.models.user import User
from app.services.plaid_sync import build_plaid_client, sync_plaid_item

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
    try:
        return build_plaid_client()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


async def _sync_item(item: PlaidItem, client, db: AsyncSession) -> dict:
    """Delegate to the plaid_sync service (client is built internally by the service)."""
    return await sync_plaid_item(item, db)


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


@router.post("/items/{item_id}/link-token", response_model=LinkTokenResponse)
async def create_update_link_token(
    item_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a Plaid Link token in 'update mode' for re-authenticating an existing
    item (e.g. after the bank password changed). Opening Link with this token lets
    the user re-enter credentials for the SAME item — no new connection is created."""
    result = await db.execute(
        select(PlaidItem).where(
            PlaidItem.id == item_id,
            PlaidItem.household_id == user.household_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Institution not found")

    client = _build_plaid_client()

    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.country_code import CountryCode

    request = LinkTokenCreateRequest(
        user=LinkTokenCreateRequestUser(client_user_id=str(user.id)),
        client_name="MyFintech",
        country_codes=[CountryCode("US")],
        language="en",
        access_token=decrypt_value(item.encrypted_access_token),
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
    try:
        stats = await _sync_item(item, client, db)
    except Exception as e:
        item.error_code = str(e)[:100]
        await db.commit()
        raise HTTPException(status_code=502, detail=str(e))
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
