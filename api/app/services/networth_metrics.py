"""The net worth formula, shared by the daily snapshot task and the manual
"Take snapshot" endpoint so both store the same numbers the dashboard shows.

    net_worth = cash + investments + real_estate − debts

    cash         – visible depository accounts
    investments  – visible investment/brokerage accounts (incl. 529 plans)
    real_estate  – properties' current_value
    debts        – credit-card balances + loans on those properties

Like the dashboard card, only accounts and properties in the household's home
country count; properties must also be in the home currency (no FX here).
"""
from decimal import Decimal

from app.models.account import Account
from app.models.property import Property
from app.models.property_details import Loan


def compute_net_worth(
    accounts: list[Account], properties: list[Property], loans: list[Loan],
    home_country: str, home_currency: str,
) -> dict[str, Decimal]:
    total_cash = Decimal(0)
    total_investments = Decimal(0)
    credit_debt = Decimal(0)

    for acc in accounts:
        if acc.is_hidden or (acc.country or home_country) != home_country:
            continue
        bal = acc.current_balance or Decimal(0)
        if acc.type == "depository":
            total_cash += bal
        elif acc.type in ("investment", "brokerage"):
            total_investments += bal
        elif acc.type == "credit":
            credit_debt += bal

    counted = [
        p for p in properties
        if (p.country or home_country) == home_country and (p.currency_code or home_currency) == home_currency
    ]
    counted_ids = {p.id for p in counted}
    total_real_estate = sum((p.current_value or Decimal(0) for p in counted), Decimal(0))
    property_debt = sum(
        (l.current_balance or Decimal(0) for l in loans if l.property_id in counted_ids), Decimal(0)
    )

    total_debts = credit_debt + property_debt
    return {
        "total_cash": total_cash,
        "total_investments": total_investments,
        "total_real_estate": total_real_estate,
        "total_debts": total_debts,
        "net_worth": total_cash + total_investments + total_real_estate - total_debts,
    }
