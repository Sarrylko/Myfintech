/**
 * Spending insights computed from already-loaded transactions: recurring
 * charges, fixed vs flexible spending, unlabeled spending and unusual charges.
 * Callers pass only spending transactions and a function giving each one's
 * spending amount (loan payments count interest/escrow only).
 */
import type { Transaction } from "./api";
import { categoryMatches } from "./reportTypes";

const DAY_MS = 86_400_000;

/** Merchant identity that ignores dates, card numbers and reference codes */
export function merchantIdentity(t: Transaction): string {
  return (t.merchant_name || t.name)
    .toLowerCase()
    .replace(/[#*\d/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Recurring charges ─────────────────────────────────────────────────────────

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

const CADENCES: { cadence: Cadence; days: number; min: number; max: number }[] = [
  { cadence: "weekly", days: 7, min: 5, max: 9 },
  { cadence: "biweekly", days: 14, min: 12, max: 17 },
  { cadence: "monthly", days: 30.4, min: 25, max: 36 },
  { cadence: "quarterly", days: 91, min: 80, max: 100 },
  { cadence: "yearly", days: 365, min: 340, max: 390 },
];

export interface RecurringCharge {
  identity: string;
  /** A merchant label to display and to filter by */
  merchant: string;
  cadence: Cadence;
  typical: number;
  /** Typical amount before the latest charge, when it changed */
  previous: number | null;
  lastAmount: number;
  lastDate: Date;
  nextDate: Date;
  yearly: number;
  count: number;
  isNew: boolean;
  priceIncrease: boolean;
}

/**
 * Charges that repeat at a steady interval with a fairly stable amount and are
 * still active. Needs 3+ charges (2 for yearly).
 */
export function detectRecurring(
  spending: Transaction[],
  spendOf: (t: Transaction) => number,
  merchantLabel: (t: Transaction) => string,
  now = new Date(),
): RecurringCharge[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of spending) {
    const id = merchantIdentity(t);
    if (!id) continue;
    const list = groups.get(id);
    if (list) list.push(t);
    else groups.set(id, [t]);
  }

  const result: RecurringCharge[] = [];
  groups.forEach((txns, identity) => {
    // One charge per day (two same-day charges are usually one bill split up)
    const byDay = new Map<string, { date: Date; amount: number; t: Transaction }>();
    for (const t of txns) {
      const d = new Date(t.date);
      const key = d.toDateString();
      const prev = byDay.get(key);
      byDay.set(key, { date: d, amount: (prev?.amount ?? 0) + spendOf(t), t });
    }
    const charges = Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (charges.length < 2) return;

    const gaps = charges.slice(1).map((c, i) => (c.date.getTime() - charges[i].date.getTime()) / DAY_MS);
    const gap = median(gaps);
    const match = CADENCES.find((c) => gap >= c.min && gap <= c.max);
    if (!match || charges.length < (match.cadence === "yearly" ? 2 : 3)) return;
    // Most intervals must look like that cadence
    const steady = gaps.filter((g) => g >= match.min && g <= match.max).length;
    if (steady < Math.ceil(gaps.length * 0.6)) return;

    const amounts = charges.map((c) => c.amount);
    const typicalAll = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - typicalAll) <= Math.max(5, typicalAll * 0.35)).length;
    if (stable < Math.ceil(amounts.length * 0.6)) return;

    const last = charges[charges.length - 1];
    // Still active: last charge within ~1.5 cycles
    if ((now.getTime() - last.date.getTime()) / DAY_MS > match.days * 1.5 + 5) return;

    const recent = amounts.slice(-3);
    const earlier = amounts.slice(0, -1);
    const typical = median(recent);
    const previousTypical = earlier.length >= 2 ? median(earlier.slice(-3)) : null;
    const priceIncrease =
      previousTypical !== null && last.amount - previousTypical >= Math.max(2, previousTypical * 0.05);

    result.push({
      identity,
      merchant: merchantLabel(last.t),
      cadence: match.cadence,
      typical,
      previous: priceIncrease ? previousTypical : null,
      lastAmount: last.amount,
      lastDate: last.date,
      nextDate: new Date(last.date.getTime() + match.days * DAY_MS),
      // After a price increase the new price is what the year will cost
      yearly: (priceIncrease ? last.amount : typical) * (365 / match.days),
      count: charges.length,
      isNew: (now.getTime() - charges[0].date.getTime()) / DAY_MS <= 100,
      priceIncrease,
    });
  });
  return result.sort((a, b) => b.yearly - a.yearly);
}

// ── Fixed vs flexible ─────────────────────────────────────────────────────────

/** Categories (group or "Group > Item") that are commitments rather than choices */
export const FIXED_CATEGORY_KEYS = [
  "Housing > Mortgage / Rent",
  "Housing > Property Tax",
  "Housing > HOA Fees",
  "Housing > Home Insurance",
  "Housing > Security Systems",
  "Utilities",
  "Insurance",
  "Transportation > Car Insurance",
  "Transportation > Car Payment",
  "Financial > Loan Payments",
  "Health & Medical > Health Insurance",
  "Kids & Family > Childcare / Daycare",
  "Kids & Family > Activities / Sports",
  "Education > Tuition",
  "Entertainment > Subscriptions",
  "Entertainment > Streaming Services",
  "Taxes",
];

export function isFixedCategory(category: string | null): boolean {
  return FIXED_CATEGORY_KEYS.some((k) => categoryMatches(category, k));
}

// ── Spending that needs a label ───────────────────────────────────────────────

export function needsLabel(t: Transaction): boolean {
  const cat = (t.plaid_category ?? "").trim();
  if (!cat || cat === "Uncategorized" || cat === "Miscellaneous") return true;
  if (cat === "Miscellaneous > Uncategorized" || cat === "Miscellaneous > Cash Withdrawal") return true;
  return /\b(atm|withdrawal)\b/i.test(t.name);
}

// ── Unusual charges ───────────────────────────────────────────────────────────

export interface UnusualCharge {
  txn: Transaction;
  amount: number;
  reason: "above-usual" | "new-merchant";
  /** Merchant's usual (median) amount, for above-usual */
  usual: number | null;
}

/**
 * Charges in `period` far above that merchant's usual amount over the prior
 * year, or first-ever charges of $200+ at a merchant.
 */
export function findUnusual(
  period: Transaction[],
  history: Transaction[],
  spendOf: (t: Transaction) => number,
): UnusualCharge[] {
  const byMerchant = new Map<string, { date: number; amount: number; id: string }[]>();
  for (const t of history) {
    const id = merchantIdentity(t);
    const list = byMerchant.get(id) ?? [];
    list.push({ date: new Date(t.date).getTime(), amount: spendOf(t), id: t.id });
    byMerchant.set(id, list);
  }

  const out: UnusualCharge[] = [];
  for (const t of period) {
    const amount = spendOf(t);
    // Unlabeled spending (cash withdrawals etc.) is surfaced separately
    if (amount < 25 || needsLabel(t)) continue;
    const when = new Date(t.date).getTime();
    const prior = (byMerchant.get(merchantIdentity(t)) ?? []).filter(
      (h) => h.id !== t.id && h.date < when && when - h.date <= 365 * DAY_MS,
    );
    if (prior.length === 0) {
      if (amount >= 200) out.push({ txn: t, amount, reason: "new-merchant", usual: null });
      continue;
    }
    if (prior.length < 3) continue;
    const usual = median(prior.map((h) => h.amount));
    if (amount >= usual * 1.5 && amount - usual >= 75) {
      out.push({ txn: t, amount, reason: "above-usual", usual });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}
