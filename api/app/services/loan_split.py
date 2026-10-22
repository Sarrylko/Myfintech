"""Split loan payments into interest/escrow (spending) and principal (equity).

Mirrors frontend/src/lib/loanSplit.ts so the dashboard and the Transactions
page agree on how much of a mortgage payment is really spending.
"""
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.models.property_details import Loan

# Words too generic to identify a lender in a transaction description
_GENERIC_WORDS = {
    "mortgage", "mortage", "bank", "loan", "loans", "home", "homes", "lending", "financial",
    "the", "inc", "llc", "corp", "co", "na", "of", "and", "services", "servicing",
}


@dataclass
class LoanPaymentSplit:
    interest: Decimal
    escrow: Decimal
    principal: Decimal


def _lender_tokens(lender: str | None) -> list[str]:
    words = re.split(r"[^a-z0-9]+", (lender or "").lower())
    return [w for w in words if len(w) >= 3 and w not in _GENERIC_WORDS]


def match_loan(
    amount: Decimal, category: str | None, name: str | None, merchant: str | None, loans: list[Loan],
) -> Loan | None:
    """The loan a payment pays, matched by lender name; None if none."""
    if amount <= 0:
        return None
    cat = (category or "").lower()
    text = f"{merchant or ''} {name or ''}".lower()
    if not re.search(r"loan|mortgage", cat) and not re.search(r"mortgage|mortage", text):
        return None
    for loan in loans:
        tokens = _lender_tokens(loan.lender_name)
        if tokens and all(w in text for w in tokens):
            return loan
    return None


def _months_between(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + (end.month - start.month)


def _payments_after(anchor: date, paid_on: date) -> int:
    """Monthly payments made after `anchor` up to and including `paid_on` (<= 0 if before)."""
    return _months_between(anchor, paid_on) + (1 if paid_on.day > anchor.day else 0)


def _interest_from_balance(balance: float, anchor: date, paid_on: date, r: float, payment: float) -> float:
    """Interest on a payment, amortizing from a balance known on `anchor`.

    Each payment: balance_after = balance_before * (1 + r) - payment.  Payments
    after the anchor roll the balance forward; earlier ones roll it back.
    """
    n = _payments_after(anchor, paid_on)
    before = balance
    if n >= 1:
        for _ in range(n - 1):
            before = before * (1 + r) - payment
    else:
        for _ in range(1 - n):
            before = (before + payment) / (1 + r)
    return max(0.0, before * r)


def _estimated_interest(loan: Loan, paid_on: date) -> float | None:
    """Interest portion of a payment.

    From the current balance when its date is known (exact, prepayments
    included), else per the original amortization schedule (no prepayments
    assumed), else one month of interest on the current balance.
    """
    rate = float(loan.interest_rate or 0)
    if rate <= 0:
        return None
    r = rate / 100 / 12
    balance = float(loan.current_balance or 0)
    escrow = float(loan.escrow_amount or 0) if loan.escrow_included else 0.0
    payment = float(loan.monthly_payment or 0) - escrow  # principal + interest
    if loan.balance_as_of and balance > 0 and payment > 0:
        return _interest_from_balance(balance, loan.balance_as_of, paid_on, r, payment)
    principal0 = float(loan.original_amount or 0)
    term = loan.term_months or 0
    if loan.origination_date and principal0 > 0 and term > 0:
        k = max(1, min(term, _months_between(loan.origination_date, paid_on)))
        growth = (1 + r) ** (k - 1)
        scheduled = principal0 * r / (1 - (1 + r) ** -term)
        balance_before = principal0 * growth - scheduled * (growth - 1) / r
        return max(0.0, balance_before * r)
    return balance * r if balance > 0 else None


def split_loan_payment(amount: Decimal, paid_on: date, loan: Loan) -> LoanPaymentSplit | None:
    estimate = _estimated_interest(loan, paid_on)
    if estimate is None:
        return None
    escrow_estimate = Decimal(str(loan.escrow_amount or 0)) if loan.escrow_included else Decimal(0)
    interest = min(amount, Decimal(str(round(estimate, 2))))
    escrow = min(amount - interest, escrow_estimate)
    return LoanPaymentSplit(interest=interest, escrow=escrow, principal=amount - interest - escrow)
