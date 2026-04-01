import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class InvestmentTransactionCreate(BaseModel):
    ticker_symbol: str
    name: str
    type: str  # buy | sell | dividend | split | transfer_in | transfer_out | other
    date: datetime | None = None
    quantity: Decimal | None = None
    price: Decimal | None = None
    amount: Decimal
    fees: Decimal | None = None
    notes: str | None = None
    currency_code: str = "USD"


class InvestmentTransactionUpdate(BaseModel):
    ticker_symbol: str | None = None
    name: str | None = None
    type: str | None = None
    date: datetime | None = None
    quantity: Decimal | None = None
    price: Decimal | None = None
    amount: Decimal | None = None
    fees: Decimal | None = None
    notes: str | None = None
    currency_code: str | None = None


class InvestmentTransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    ticker_symbol: str | None
    name: str
    type: str
    date: datetime
    quantity: Decimal | None
    price: Decimal | None
    amount: Decimal
    fees: Decimal | None
    notes: str | None
    currency_code: str
    created_at: datetime


class TickerRollup(BaseModel):
    ticker_symbol: str
    name: str
    net_shares: Decimal
    avg_cost_per_share: Decimal | None
    total_cost_basis: Decimal | None
    total_fees: Decimal
    realized_gain: Decimal
    transaction_count: int
    last_transaction_date: datetime
    transactions: list[InvestmentTransactionResponse]


class AccountTransactionSummary(BaseModel):
    account_id: uuid.UUID
    positions: list[TickerRollup]


class CSVImportResult(BaseModel):
    imported: int
    duplicates: int = 0
    errors: list[str]
