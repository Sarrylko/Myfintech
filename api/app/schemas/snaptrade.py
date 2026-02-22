import uuid
from datetime import datetime

from pydantic import BaseModel


class SnapTradeRegisterResponse(BaseModel):
    registered: bool
    snaptrade_user_id: str


class SnapTradeConnectUrlResponse(BaseModel):
    redirect_url: str


class SnapTradeConnectionResponse(BaseModel):
    id: uuid.UUID
    brokerage_name: str | None
    brokerage_slug: str | None
    snaptrade_authorization_id: str
    is_active: bool
    last_synced_at: datetime | None
    account_count: int = 0

    model_config = {"from_attributes": True}


class SnapTradeSyncResponse(BaseModel):
    accounts_synced: int
    holdings_synced: int
