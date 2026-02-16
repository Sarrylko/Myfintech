from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import encrypt_value
from app.models.account import PlaidItem
from app.models.user import User

router = APIRouter(prefix="/plaid", tags=["plaid"])


class LinkTokenResponse(BaseModel):
    link_token: str


class PublicTokenExchange(BaseModel):
    public_token: str
    institution_id: str | None = None
    institution_name: str | None = None


class ItemResponse(BaseModel):
    item_id: str
    institution_name: str | None


@router.post("/link-token", response_model=LinkTokenResponse)
async def create_link_token(
    user: User = Depends(get_current_user),
):
    """Create a Plaid Link token for the frontend."""
    if not settings.plaid_client_id or not settings.plaid_secret:
        raise HTTPException(status_code=503, detail="Plaid not configured")

    import plaid
    from plaid.api import plaid_api
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.products import Products
    from plaid.model.country_code import CountryCode

    configuration = plaid.Configuration(
        host=getattr(plaid.Environment, settings.plaid_env.capitalize()),
        api_key={
            "clientId": settings.plaid_client_id,
            "secret": settings.plaid_secret,
        },
    )
    api_client = plaid.ApiClient(configuration)
    client = plaid_api.PlaidApi(api_client)

    request = LinkTokenCreateRequest(
        user=LinkTokenCreateRequestUser(client_user_id=str(user.id)),
        client_name="MyFintech",
        products=[Products("transactions")],
        country_codes=[CountryCode("US")],
        language="en",
    )
    response = client.link_token_create(request)
    return LinkTokenResponse(link_token=response.link_token)


@router.post("/exchange-token", response_model=ItemResponse)
async def exchange_public_token(
    payload: PublicTokenExchange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Exchange a Plaid public token for an access token and store it."""
    if not settings.plaid_client_id or not settings.plaid_secret:
        raise HTTPException(status_code=503, detail="Plaid not configured")

    import plaid
    from plaid.api import plaid_api
    from plaid.model.item_public_token_exchange_request import (
        ItemPublicTokenExchangeRequest,
    )

    configuration = plaid.Configuration(
        host=getattr(plaid.Environment, settings.plaid_env.capitalize()),
        api_key={
            "clientId": settings.plaid_client_id,
            "secret": settings.plaid_secret,
        },
    )
    api_client = plaid.ApiClient(configuration)
    client = plaid_api.PlaidApi(api_client)

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

    return ItemResponse(
        item_id=response.item_id,
        institution_name=payload.institution_name,
    )
