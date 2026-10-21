/**
 * Transactions-page filter state and its URL query-string form. The query
 * string is what gets bookmarked and what saved views store.
 */

export type CategoryMode = "include" | "exclude";
export type Direction = "all" | "income" | "expense";

export interface TxnFilters {
  search: string;
  account: string;              // account id or "all"
  datePreset: string;
  dateFrom: string;             // YYYY-MM-DD, used when datePreset === "custom"
  dateTo: string;
  categories: Record<string, CategoryMode>;
  merchants: string[];
  people: string[];             // user ids, or "shared" for joint/unowned accounts
  direction: Direction;
  amountMin: string;
  amountMax: string;
  hideTransfers: boolean;
  hideSavings: boolean;
  hideBusiness: boolean;
  showIgnored: boolean;
  splitLoans: boolean;          // split loan payments into interest vs principal
}

export const DEFAULT_FILTERS: TxnFilters = {
  search: "",
  account: "all",
  datePreset: "this_month",
  dateFrom: "",
  dateTo: "",
  categories: {},
  merchants: [],
  people: [],
  direction: "all",
  amountMin: "",
  amountMax: "",
  hideTransfers: false,
  hideSavings: false,
  hideBusiness: false,
  showIgnored: false,
  splitLoans: true,
};

const HIDE_FLAGS: [keyof TxnFilters, string][] = [
  ["hideTransfers", "transfers"],
  ["hideSavings", "savings"],
  ["hideBusiness", "business"],
];

export function filtersToQuery(f: TxnFilters): string {
  const p = new URLSearchParams();
  if (f.search) p.set("q", f.search);
  if (f.account !== "all") p.set("account", f.account);
  if (f.datePreset !== DEFAULT_FILTERS.datePreset) p.set("range", f.datePreset);
  if (f.datePreset === "custom") {
    if (f.dateFrom) p.set("from", f.dateFrom);
    if (f.dateTo) p.set("to", f.dateTo);
  }
  for (const [k, mode] of Object.entries(f.categories)) p.append(mode === "include" ? "cat" : "notcat", k);
  for (const m of f.merchants) p.append("merchant", m);
  for (const id of f.people) p.append("person", id);
  if (f.direction !== "all") p.set("dir", f.direction);
  if (f.amountMin) p.set("min", f.amountMin);
  if (f.amountMax) p.set("max", f.amountMax);
  const hide = HIDE_FLAGS.filter(([key]) => f[key]).map(([, name]) => name);
  if (hide.length) p.set("hide", hide.join(","));
  if (f.showIgnored) p.set("ignored", "1");
  if (!f.splitLoans) p.set("split", "0");
  return p.toString();
}

export function filtersFromQuery(query: string): TxnFilters {
  const p = new URLSearchParams(query);
  const categories: Record<string, CategoryMode> = {};
  for (const k of p.getAll("cat")) categories[k] = "include";
  for (const k of p.getAll("notcat")) categories[k] = "exclude";
  const hide = new Set((p.get("hide") ?? "").split(",").filter(Boolean));
  const dir = p.get("dir");
  const f: TxnFilters = {
    ...DEFAULT_FILTERS,
    search: p.get("q") ?? "",
    account: p.get("account") ?? "all",
    datePreset: p.get("range") ?? DEFAULT_FILTERS.datePreset,
    dateFrom: p.get("from") ?? "",
    dateTo: p.get("to") ?? "",
    categories,
    merchants: p.getAll("merchant"),
    people: p.getAll("person"),
    direction: dir === "income" || dir === "expense" ? dir : "all",
    amountMin: p.get("min") ?? "",
    amountMax: p.get("max") ?? "",
    showIgnored: p.get("ignored") === "1",
    splitLoans: p.get("split") !== "0",
  };
  for (const [key, name] of HIDE_FLAGS) (f[key] as boolean) = hide.has(name);
  return f;
}

/** "2026-04" → first and last day of that month as YYYY-MM-DD. */
export function monthRange(monthKey: string): { from: string; to: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, "0")}` };
}
