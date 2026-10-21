import type { ReportType } from "./api";

/**
 * Built-in defaults, applied when the household has no override for a
 * category. Keys are a category group ("Savings & Investments") or a full
 * "Group > Item" string; the full string wins over its group.
 */
export const DEFAULT_REPORT_TYPES: Record<string, ReportType> = {
  "Savings & Investments": "savings",
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  cashflow: "Income / Spending",
  transfer: "Transfer (excluded)",
  savings: "Savings & Investing",
};

/** "Food & Dining > Restaurants" → "Food & Dining" */
export function categoryGroup(raw: string | null | undefined): string {
  if (!raw) return "";
  const idx = raw.indexOf(" > ");
  return (idx === -1 ? raw : raw.slice(0, idx)).trim();
}

/**
 * The report type a category string has been explicitly given, by the
 * household override or the built-in defaults — or null when nothing is set.
 */
export function explicitReportType(
  category: string | null | undefined,
  overrides: Record<string, ReportType>,
): ReportType | null {
  if (!category) return null;
  const full = category.trim();
  const group = categoryGroup(full);
  return (
    overrides[full] ?? overrides[group] ??
    DEFAULT_REPORT_TYPES[full] ?? DEFAULT_REPORT_TYPES[group] ?? null
  );
}

// Mirrors _TRANSFER_PLAID_PREFIXES in api/app/schemas/account.py
const TRANSFER_PREFIXES = ["transfer", "payment > credit card", "payment > credit", "payment > loan"];

/** Report type a category string gets when it has no explicit setting. */
export function implicitReportType(category: string | null | undefined): ReportType {
  const c = (category ?? "").toLowerCase();
  return TRANSFER_PREFIXES.some((p) => c.startsWith(p)) ? "transfer" : "cashflow";
}

/** True when `category` is `key` itself or a subcategory of the group `key`. */
export function categoryMatches(category: string | null | undefined, key: string): boolean {
  if (!category) return false;
  const full = category.trim();
  return full === key || categoryGroup(full) === key;
}
