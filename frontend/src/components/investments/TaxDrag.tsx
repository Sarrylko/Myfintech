"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  getTaxSummary,
  type Account, type Holding, type TaxSummary, type TaxTreatment, type TaxTerm,
} from "@/lib/api";
import {
  classifyHolding, classifyAccount, isSinglePosition, BUCKET_LABEL, type AssetBucket,
} from "@/components/investments/PortfolioInsights";

// The backend says how each account is taxed and does the lot math (realized
// gains, harvest candidates, fees). The location view is built here from the
// holdings already loaded, using the same classifier as Asset Allocation.

type Fmt = (val: string | number | null | undefined, decimals?: number) => string;

const TREATMENT_ORDER: TaxTreatment[] = ["taxable", "tax_deferred", "tax_free", "crypto"];
const TREATMENT_LABEL: Record<TaxTreatment, string> = {
  taxable: "Taxable",
  tax_deferred: "Tax-deferred",
  tax_free: "Tax-free",
  crypto: "Crypto",
};
const TREATMENT_HINT: Record<TaxTreatment, string> = {
  taxable: "Brokerage: dividends, interest and gains taxed every year",
  tax_deferred: "Traditional 401(k)/IRA: taxed as income on withdrawal",
  tax_free: "Roth, HSA, 529: qualified withdrawals untaxed",
  crypto: "Coins held directly: each sale or swap is taxable",
};
const BUCKET_SHORT: Record<AssetBucket, string> = {
  us_stocks: "US stocks", intl_stocks: "Intl stocks", bonds: "Bonds", balanced: "Balanced",
  real_estate: "REITs", cash: "Cash", crypto: "Crypto", other: "Other",
};

// Munis are meant for taxable accounts; savings bonds defer their own interest
const RE_TAX_EXEMPT = /\b(municipal|muni|tax[- ]?exempt|tax[- ]?free|savings bonds?|i-?bonds?|ee bonds?)\b/;
const TAX_EXEMPT_TICKERS = new Set(["MUB", "VTEB", "TFI", "SUB", "SHM", "VWIUX", "VWITX", "FTABX", "FMBIX", "VTEAX", "HYD", "MUNI"]);
const RE_GROWTH = /\b(growth|nasdaq|small[- ]?cap|technology|tech|innovation|semiconductor)\b/;
const GROWTH_TICKERS = new Set(["QQQ", "QQQM", "VUG", "VGT", "SCHG", "IWF", "MGK", "ARKK", "IWM", "VB", "VBK", "IJR", "XLK", "SMH", "SOXX", "FBGRX", "FSPTX"]);

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

function signed(fmt: Fmt, v: number, d = 0) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), d)}`;
}

function toneOf(v: number): "up" | "down" | undefined {
  return v > 0.005 ? "up" : v < -0.005 ? "down" : undefined;
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: React.ReactNode; tone?: "up" | "down";
}) {
  return (
    <div className="bg-white px-5 py-3 min-w-0">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${
        tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "text-gray-900"
      }`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <p className="px-5 pt-3 pb-1 text-xs font-semibold text-gray-900">
      {title}{note && <span className="font-normal text-gray-400"> · {note}</span>}
    </p>
  );
}

function TermBadge({ term }: { term: TaxTerm }) {
  if (!term || term === "unknown") return <span className="text-gray-300">—</span>;
  const cls = term === "short" ? "bg-amber-50 text-amber-700" : term === "long" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600";
  const label = term === "short" ? "Short" : term === "long" ? "Long" : "Mixed";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{label}</span>;
}

// ─── Tax location ────────────────────────────────────────────────────────────

interface Flag {
  kind: "bonds_taxable" | "reit_taxable" | "growth_deferred";
  key: string;
  ticker: string | null;
  name: string;
  account: string;
  value: number;
}

const FLAG_TEXT: Record<Flag["kind"], { title: string; why: string }> = {
  bonds_taxable: {
    title: "Bonds in taxable accounts",
    why: "Bond interest is taxed as ordinary income every year. In a traditional 401(k)/IRA it would compound untaxed.",
  },
  reit_taxable: {
    title: "REITs in taxable accounts",
    why: "REIT dividends are mostly non-qualified and taxed as ordinary income. They're more efficient in tax-advantaged accounts.",
  },
  growth_deferred: {
    title: "High-growth assets in tax-deferred accounts",
    why: "All growth in a traditional account is taxed as income on withdrawal. In a Roth it's tax-free; in taxable it gets long-term capital gains rates.",
  },
};

interface Location {
  total: number;
  rows: { treatment: TaxTreatment; value: number; accounts: number; mix: { bucket: AssetBucket; value: number }[] }[];
  flags: Flag[];
}

function buildLocation(
  accounts: Account[], holdingsMap: Record<string, Holding[]>, treatmentOf: Map<string, TaxTreatment>,
): Location {
  const byT = new Map<TaxTreatment, { value: number; accounts: Set<string>; mix: Map<AssetBucket, number> }>();
  const flags: Flag[] = [];
  const add = (t: TaxTreatment, acc: string, b: AssetBucket, v: number) => {
    const row = byT.get(t) ?? { value: 0, accounts: new Set<string>(), mix: new Map() };
    row.value += v;
    row.accounts.add(acc);
    row.mix.set(b, (row.mix.get(b) ?? 0) + v);
    byT.set(t, row);
  };

  for (const acc of accounts) {
    const t = treatmentOf.get(acc.id) ?? "taxable";
    const balance = Number(acc.current_balance ?? 0);
    const holdings = (holdingsMap[acc.id] ?? []).filter((h) => Number(h.current_value ?? 0) > 0);
    if (holdings.length === 0) {
      if (balance > 0) add(t, acc.id, classifyAccount(acc), balance);
      continue;
    }
    let held = 0;
    for (const h of holdings) {
      const value = Number(h.current_value ?? 0);
      held += value;
      const bucket = classifyHolding(h, acc);
      // Coins held in a taxable account are their own tax category
      add(t === "taxable" && bucket === "crypto" ? "crypto" : t, acc.id, bucket, value);

      const ticker = h.ticker_symbol?.toUpperCase().trim() || null;
      const name = (h.name ?? "").toLowerCase();
      const base = { key: `${acc.id}:${h.id}`, ticker, name: h.name ?? ticker ?? "Unnamed", account: acc.name, value };
      if (t === "taxable" && bucket === "bonds" && !RE_TAX_EXEMPT.test(name) && !TAX_EXEMPT_TICKERS.has(ticker ?? "")
          && !/treasurydirect/i.test(acc.institution_name ?? "")) {
        flags.push({ kind: "bonds_taxable", ...base });
      } else if (t === "taxable" && bucket === "real_estate") {
        flags.push({ kind: "reit_taxable", ...base });
      } else if (t === "tax_deferred" && (
        bucket === "crypto" || isSinglePosition(h, bucket) || GROWTH_TICKERS.has(ticker ?? "") || RE_GROWTH.test(name)
      ) && bucket !== "bonds" && bucket !== "cash" && bucket !== "balanced") {
        flags.push({ kind: "growth_deferred", ...base });
      }
    }
    const gap = balance - held;
    if (gap > Math.max(1, balance * 0.005)) add(t, acc.id, "cash", gap);
  }

  const rows = TREATMENT_ORDER
    .filter((t) => (byT.get(t)?.value ?? 0) > 0.5)
    .map((t) => {
      const r = byT.get(t)!;
      return {
        treatment: t,
        value: r.value,
        accounts: r.accounts.size,
        mix: Array.from(r.mix.entries())
          .map(([bucket, value]) => ({ bucket, value }))
          .filter((m) => m.value > 0.5)
          .sort((a, b) => b.value - a.value),
      };
    });
  return {
    total: rows.reduce((s, r) => s + r.value, 0),
    rows,
    flags: flags.sort((a, b) => b.value - a.value),
  };
}

function LocationPanel({ loc, fmt }: { loc: Location; fmt: Fmt }) {
  const [open, setOpen] = useState<Flag["kind"] | null>(null);
  const groups = (Object.keys(FLAG_TEXT) as Flag["kind"][])
    .map((kind) => {
      const items = loc.flags.filter((f) => f.kind === kind);
      return { kind, items, value: items.reduce((s, f) => s + f.value, 0) };
    })
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <SectionTitle title="Where it sits" note="by how each account is taxed" />
      <ul className="px-5 py-2 space-y-3">
        {loc.rows.map((r) => {
          const share = loc.total > 0 ? r.value / loc.total : 0;
          return (
            <li key={r.treatment} title={TREATMENT_HINT[r.treatment]}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-gray-700 font-medium">
                  {TREATMENT_LABEL[r.treatment]}
                  <span className="ml-1.5 font-normal text-gray-400">{r.accounts} account{r.accounts !== 1 ? "s" : ""}</span>
                </span>
                <span className="shrink-0 tabular-nums text-gray-900 font-semibold">
                  {pct(share)}<span className="ml-2 font-normal text-gray-400">{fmt(r.value)}</span>
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(share * 100, 1)}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-gray-500 truncate" title={r.mix.map((m) => `${BUCKET_LABEL[m.bucket]}: ${fmt(m.value)}`).join("\n")}>
                {r.mix.slice(0, 4).map((m) => `${BUCKET_SHORT[m.bucket]} ${pct(m.value / r.value, 0)}`).join(" · ")}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-gray-100">
        <SectionTitle title="Placement flags" />
        {groups.length === 0 ? (
          <p className="px-5 pb-4 text-xs text-gray-400">Nothing obviously misplaced: no taxable bonds or REITs, and no high-growth holdings in traditional accounts.</p>
        ) : (
          <ul className="pb-2">
            {groups.map((g) => (
              <li key={g.kind} className="border-t border-gray-50 first:border-0">
                <button
                  type="button"
                  onClick={() => setOpen(open === g.kind ? null : g.kind)}
                  className="w-full px-5 py-2 flex items-start justify-between gap-3 text-left hover:bg-gray-50"
                  aria-expanded={open === g.kind}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
                      <span aria-hidden className="text-amber-500">▲</span>{FLAG_TEXT[g.kind].title}
                    </span>
                    <span className="block text-[10px] text-gray-400 mt-0.5">{FLAG_TEXT[g.kind].why}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-900 font-semibold">
                    {fmt(g.value)}
                    <span className="block text-[10px] font-normal text-gray-400 text-right">{g.items.length} holding{g.items.length !== 1 ? "s" : ""} {open === g.kind ? "▴" : "▾"}</span>
                  </span>
                </button>
                {open === g.kind && (
                  <ul className="px-5 pb-2 max-h-[200px] overflow-y-auto">
                    {g.items.map((f) => (
                      <li key={f.key} className="flex items-center justify-between gap-3 py-1 text-xs border-t border-gray-50 first:border-0">
                        <span className="min-w-0 flex items-center gap-1.5">
                          {f.ticker && <span className="font-mono font-semibold text-gray-800">{f.ticker}</span>}
                          <span className="text-gray-400 truncate max-w-[140px]" title={f.name}>{f.name}</span>
                          <span className="text-[10px] text-gray-400 truncate">· {f.account}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-700">{fmt(f.value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Harvest candidates ──────────────────────────────────────────────────────

function HarvestTable({ data, fmt }: { data: TaxSummary; fmt: Fmt }) {
  const [showAll, setShowAll] = useState(false);
  const all = data.harvest.candidates;
  const rows = showAll ? all : all.slice(0, 8);
  if (all.length === 0) {
    return <p className="px-5 py-8 text-center text-xs text-gray-400">No taxable positions below cost</p>;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400">
              <th className="text-left font-semibold px-5 py-2">Holding</th>
              <th className="text-right font-semibold px-2 py-2">Value</th>
              <th className="text-right font-semibold px-2 py-2">Loss</th>
              <th className="text-center font-semibold px-2 py-2">Term</th>
              <th className="text-left font-semibold px-5 py-2">Wash sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.account_id}:${c.ticker ?? c.name}`} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-2 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {c.ticker && <span className="font-mono font-semibold text-gray-800">{c.ticker}</span>}
                    <span className="text-gray-400 truncate max-w-[140px]" title={c.name ?? ""}>{c.name}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{c.account_name}</div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-700">{fmt(c.value)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  <span className="text-red-600 font-medium">{signed(fmt, Number(c.loss))}</span>
                  <span className="block text-[10px] text-gray-400">{pct(c.loss_pct)}</span>
                </td>
                <td className="px-2 py-2 text-center"><TermBadge term={c.term} /></td>
                <td className="px-5 py-2 text-[10px]">
                  {c.recent_buy ? (
                    <span
                      className="text-amber-700"
                      title={`Bought ${new Date(`${c.recent_buy.date}T00:00:00`).toLocaleDateString()} in ${c.recent_buy.account_name ?? "another account"}. Selling at a loss before ${new Date(`${c.recent_buy.clear_on}T00:00:00`).toLocaleDateString()} would be a wash sale.`}
                    >
                      ▲ Bought {new Date(`${c.recent_buy.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      <span className="block text-gray-400">clear {new Date(`${c.recent_buy.clear_on}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </span>
                  ) : <span className="text-gray-400">No buys in 30 days</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {all.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="w-full px-5 py-2.5 text-xs font-medium text-blue-600 hover:bg-gray-50 border-t border-gray-100"
        >
          {showAll ? "Show top 8" : `Show all ${all.length} candidates`}
        </button>
      )}
    </>
  );
}

// ─── Realized sales ──────────────────────────────────────────────────────────

function SalesTable({ data, fmt }: { data: TaxSummary; fmt: Fmt }) {
  const [showAll, setShowAll] = useState(false);
  const sales = data.realized.sales;
  const rows = showAll ? sales : sales.slice(0, 8);
  if (sales.length === 0) {
    return <p className="px-5 py-8 text-center text-xs text-gray-400">No sales in taxable accounts in {data.year}</p>;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400">
              <th className="text-left font-semibold px-5 py-2">Sold</th>
              <th className="text-right font-semibold px-2 py-2">Proceeds</th>
              <th className="text-right font-semibold px-2 py-2">Basis</th>
              <th className="text-right font-semibold px-2 py-2">Gain</th>
              <th className="text-center font-semibold px-5 py-2">Term</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const gain = s.gain === null ? null : Number(s.gain);
              return (
                <tr key={`${s.date}:${s.account_id}:${s.ticker}:${i}`} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-2 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold text-gray-800">{s.ticker}</span>
                      <span className="text-gray-400 truncate max-w-[130px]" title={s.name}>{s.name}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(`${s.date}T00:00:00`).toLocaleDateString()} · {s.account_name}
                      {s.possible_wash_sale && (
                        <span className="ml-1 text-amber-700" title="The same ticker was bought within 30 days of this sale in a household account, so some of this loss may be disallowed.">
                          · ▲ possible wash sale
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-700">{fmt(s.proceeds, 2)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                    {s.cost_basis === null ? <span className="text-gray-300" title="No purchase history or current position to take a cost from">unknown</span> : (
                      <span title={s.basis_source === "estimated" ? "Some shares were bought before the transaction history begins; their cost is the position's average cost" : "Matched to purchases first-in, first-out"}>
                        {fmt(s.cost_basis, 2)}{s.basis_source === "estimated" && <span className="text-gray-400">*</span>}
                      </span>
                    )}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums font-medium ${gain === null ? "" : gain > 0 ? "text-emerald-600" : gain < 0 ? "text-red-600" : "text-gray-500"}`}>
                    {gain === null ? <span className="text-gray-300">—</span> : signed(fmt, gain, 2)}
                    {s.missing_basis_proceeds && gain !== null && (
                      <span className="block text-[10px] font-normal text-gray-400">excl. {fmt(s.missing_basis_proceeds)} w/o basis</span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-center"><TermBadge term={s.term} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sales.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full px-5 py-2.5 text-xs font-medium text-blue-600 hover:bg-gray-50 border-t border-gray-100"
        >
          {showAll ? "Show latest 8" : `Show all ${sales.length} sales`}
        </button>
      )}
    </>
  );
}

// ─── Fees ────────────────────────────────────────────────────────────────────

function FeesPanel({ data, fmt }: { data: TaxSummary; fmt: Fmt }) {
  const f = data.fees;
  const lines = [
    { label: "Trade commissions", value: Number(f.commissions), sub: `${f.trades_with_fees} trade${f.trades_with_fees !== 1 ? "s" : ""} with a fee` },
    { label: "Account fees", value: Number(f.account_fees), sub: "Charged by the broker" },
    { label: "Margin interest", value: Number(f.margin_interest), sub: "May be deductible as investment interest" },
  ];
  return (
    <div>
      <ul className="px-5 py-2 space-y-2">
        {lines.map((l) => (
          <li key={l.label} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0">
              <span className="text-gray-700 font-medium">{l.label}</span>
              <span className="block text-[10px] text-gray-400">{l.sub}</span>
            </span>
            <span className="shrink-0 tabular-nums text-gray-900 font-semibold">{fmt(l.value, 2)}</span>
          </li>
        ))}
      </ul>
      {f.by_account.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">By account</p>
          <ul className="space-y-1">
            {f.by_account.slice(0, 5).map((a) => (
              <li key={a.account_name ?? ""} className="flex justify-between gap-3 text-xs">
                <span className="text-gray-600 truncate">{a.account_name}</span>
                <span className="tabular-nums text-gray-800">{fmt(a.amount, 2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="px-5 pb-3 pt-1 text-[10px] text-gray-400">
        Fund expense ratios aren&apos;t included: they come out of fund prices and no source for them is connected yet.
      </p>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

export default function TaxDrag({ accounts, holdingsMap, fmt }: {
  accounts: Account[]; holdingsMap: Record<string, Holding[]>; fmt: Fmt;
}) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<TaxSummary | null>(null);
  const [error, setError] = useState("");
  const idsKey = accounts.map((a) => a.id).sort().join(",");

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    setError("");
    getTaxSummary(idsKey.split(","), year)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load tax summary"); });
    return () => { cancelled = true; };
  }, [idsKey, year]);

  const loc = useMemo(() => {
    if (!data) return null;
    const treatmentOf = new Map(data.accounts.map((a) => [a.id, a.treatment]));
    return buildLocation(accounts, holdingsMap, treatmentOf);
  }, [data, accounts, holdingsMap]);

  if (accounts.length === 0) return null;
  if (error) {
    return (
      <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-red-600">
        Tax summary couldn&apos;t load: {error}
      </div>
    );
  }
  if (!data || !loc) {
    return (
      <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-gray-400">
        Loading tax summary…
      </div>
    );
  }

  const r = data.realized;
  const st = Number(r.short_term.net);
  const lt = Number(r.long_term.net);
  const unk = Number(r.unknown_term.net);
  const net = Number(r.net);
  const harvest = Number(data.harvest.total_loss);
  const ytd = year === thisYear;
  const historyLate = data.history_start && new Date(data.history_start) > new Date(`${year}-01-01T00:00:00`);

  return (
    <div className="mb-5 bg-white rounded-xl shadow border border-gray-100">
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Tax Drag</h3>
          <p className="text-xs text-gray-400 mt-0.5">Where taxes and fees eat into returns, for the accounts shown</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
          {[thisYear, thisYear - 1].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`px-2.5 py-1 rounded-md font-medium ${year === y ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}
            >
              {y === thisYear ? `${y} YTD` : y}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-gray-100 border-b border-gray-100">
        <Stat
          label={`Realized ${ytd ? "YTD" : year}`}
          value={signed(fmt, net, 2)}
          tone={toneOf(net)}
          sub={`${r.sales.length} sale${r.sales.length !== 1 ? "s" : ""} in taxable accounts`}
        />
        <Stat label="Short-term" value={signed(fmt, st, 2)} tone={toneOf(st)} sub="Held a year or less · income rates" />
        <Stat
          label="Long-term"
          value={signed(fmt, lt, 2)}
          tone={toneOf(lt)}
          sub={Math.abs(unk) >= 0.01 ? `${signed(fmt, unk, 2)} more, term unknown` : "Held over a year · lower rates"}
        />
        <Stat
          label="Harvestable losses"
          value={harvest < 0 ? signed(fmt, harvest) : fmt(0)}
          tone={harvest < 0 ? "down" : undefined}
          sub={`${data.harvest.candidates.length} position${data.harvest.candidates.length !== 1 ? "s" : ""} below cost`}
        />
        <Stat label={`Fees ${ytd ? "YTD" : year}`} value={fmt(data.fees.total, 2)} sub="Commissions, account fees, margin" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5">
        <div className="lg:col-span-2 lg:border-r border-gray-100">
          <LocationPanel loc={loc} fmt={fmt} />
        </div>
        <div className="lg:col-span-3 border-t lg:border-t-0 border-gray-100">
          <SectionTitle title="Tax-loss harvesting candidates" note="taxable positions below cost, largest loss first" />
          <HarvestTable data={data} fmt={fmt} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 border-t border-gray-100">
        <div className="lg:col-span-3 lg:border-r border-gray-100">
          <SectionTitle title={`Realized gains ${ytd ? "this year" : `in ${year}`}`} note="sales minus cost, first-in first-out" />
          <SalesTable data={data} fmt={fmt} />
        </div>
        <div className="lg:col-span-2 border-t lg:border-t-0 border-gray-100">
          <SectionTitle title={`Fees paid ${ytd ? "this year" : `in ${year}`}`} />
          <FeesPanel data={data} fmt={fmt} />
        </div>
      </div>

      <p className="px-5 py-2.5 text-[11px] leading-relaxed text-gray-400 border-t border-gray-100">
        Estimates for planning, not tax reporting: your 1099-B is the record. Gains match sales to purchases first-in,
        first-out within each account, carrying lots across transfers between your own accounts; brokers may use a
        different lot method.
        {r.estimated_count > 0 && ` * ${r.estimated_count} sale${r.estimated_count !== 1 ? "s" : ""} include shares bought before the transaction history begins, costed at the position's average and counted as term unknown.`}
        {r.missing_basis_count > 0 && ` ${fmt(r.missing_basis_proceeds, 2)} of proceeds from ${r.missing_basis_count} sale${r.missing_basis_count !== 1 ? "s" : ""} has no cost basis and is left out of the totals.`}
        {historyLate && ` Transaction history starts ${new Date(data.history_start!).toLocaleDateString()}, so ${year} may be incomplete.`}
        {" "}Harvesting flags a buy of the same ticker in any household account in the last 30 days; buying it back within 30 days after selling also triggers a wash sale.
        Money market sweeps are left out.
      </p>
    </div>
  );
}
