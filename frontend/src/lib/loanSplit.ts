import type { Loan, Transaction } from "./api";

/** How much of a loan payment was interest/escrow (spending) vs principal (equity). */
export interface LoanPaymentSplit {
  loanId: string;
  lender: string;
  interest: number;
  escrow: number;
  principal: number;
}

// Words too generic to identify a lender in a transaction description
const GENERIC_WORDS = new Set([
  "mortgage", "mortage", "bank", "loan", "loans", "home", "homes", "lending", "financial",
  "the", "inc", "llc", "corp", "co", "na", "of", "and", "services", "servicing",
]);

function lenderTokens(lender: string): string[] {
  return lender.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}

/** The loan a payment transaction pays, matched by lender name; null if none. */
export function matchLoan(t: Transaction, loans: Loan[]): Loan | null {
  if (parseFloat(t.amount) <= 0) return null;
  const cat = (t.plaid_category ?? "").toLowerCase();
  const text = `${t.merchant_name ?? ""} ${t.name}`.toLowerCase();
  if (!/loan|mortgage/.test(cat) && !/mortgage|mortage/.test(text)) return null;
  for (const loan of loans) {
    const tokens = lenderTokens(loan.lender_name ?? "");
    if (tokens.length > 0 && tokens.every((w) => text.includes(w))) return loan;
  }
  return null;
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/**
 * Estimated interest portion of a payment made on `paidOn`.
 *
 * With origination date, original amount and term this follows the standard
 * amortization schedule (assuming no prepayments); otherwise it falls back to
 * one month of interest on the loan's current balance.
 */
function estimatedInterest(loan: Loan, paidOn: Date): number | null {
  const rate = parseFloat(loan.interest_rate ?? "");
  if (!(rate > 0)) return null;
  const r = rate / 100 / 12;
  const principal0 = parseFloat(loan.original_amount ?? "");
  const term = loan.term_months ?? 0;
  if (loan.origination_date && principal0 > 0 && term > 0) {
    const k = Math.max(1, Math.min(term, monthsBetween(new Date(loan.origination_date), paidOn)));
    const growth = Math.pow(1 + r, k - 1);
    const scheduled = (principal0 * r) / (1 - Math.pow(1 + r, -term));
    const balanceBefore = principal0 * growth - (scheduled * (growth - 1)) / r;
    return Math.max(0, balanceBefore * r);
  }
  const balance = parseFloat(loan.current_balance ?? "");
  return balance > 0 ? balance * r : null;
}

export function splitLoanPayment(t: Transaction, loan: Loan): LoanPaymentSplit | null {
  const amount = parseFloat(t.amount);
  const interestEstimate = estimatedInterest(loan, new Date(t.date));
  if (interestEstimate === null) return null;
  const escrowEstimate = loan.escrow_included ? parseFloat(loan.escrow_amount ?? "") || 0 : 0;
  const interest = Math.min(amount, interestEstimate);
  const escrow = Math.min(amount - interest, escrowEstimate);
  return {
    loanId: loan.id,
    lender: loan.lender_name ?? "Loan",
    interest,
    escrow,
    principal: amount - interest - escrow,
  };
}
