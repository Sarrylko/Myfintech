"use client";

import React, { useMemo, useState } from "react";
import type { Account, Holding } from "@/lib/api";

// ─── Classification ──────────────────────────────────────────────────────────
// Plaid sends a security type (equity, etf, mutual_fund, fixed_income, cash,
// crypto) which sync stores in holding.asset_class; manual and SnapTrade
// holdings usually only carry "crypto" or nothing. Type alone can't tell a
// bond fund from a stock fund, so the bucket comes from the type plus the
// ticker and fund name. It's an approximation and the UI says so.

export type AssetBucket =
  | "us_stocks"
  | "intl_stocks"
  | "bonds"
  | "balanced"
  | "real_estate"
  | "cash"
  | "crypto"
  | "other";

export const BUCKET_ORDER: AssetBucket[] = [
  "us_stocks", "intl_stocks", "bonds", "balanced", "real_estate", "cash", "crypto", "other",
];

export const BUCKET_LABEL: Record<AssetBucket, string> = {
  us_stocks: "US Stocks",
  intl_stocks: "International & Global Stocks",
  bonds: "Bonds & Fixed Income",
  balanced: "Target-Date & Balanced Funds",
  real_estate: "Real Estate (REITs)",
  cash: "Cash & Money Market",
  crypto: "Crypto",
  other: "Other / Unclassified",
};

const CASH_TICKERS = new Set([
  "SPAXX", "FDRXX", "FZFXX", "FCASH", "SPRXX", "FZDXX", "VMFXX", "VMRXX", "VUSXX",
  "SWVXX", "SNVXX", "SNSXX", "TTTXX", "CASH", "USD",
]);
const BOND_TICKERS = new Set([
  "BND", "AGG", "BNDX", "VBTLX", "FXNAX", "FBND", "TLT", "IEF", "SHY", "VGIT", "VGSH",
  "VGLT", "SGOV", "BIL", "SCHZ", "SCHP", "TIP", "VTIP", "MUB", "VTEB", "LQD", "HYG",
  "JNK", "BSV", "BIV", "BLV", "VCIT", "VCSH", "USFR", "TFLO", "IUSB", "FUAMX",
]);
const INTL_TICKERS = new Set([
  "VXUS", "IXUS", "VEA", "VWO", "IEFA", "IEMG", "EFA", "EEM", "VTIAX", "FTIHX",
  "FSPSX", "FZILX", "SPDW", "SCHF", "SCHE", "VEU", "ACWX", "VT", "VTWAX", "ACWI",
  "VFWAX", "FSGGX", "INDA", "EWJ", "MCHI", "FXI",
]);
const REIT_TICKERS = new Set(["VNQ", "VNQI", "SCHH", "IYR", "XLRE", "FREL", "VGSLX", "USRT", "RWR"]);

const RE_CASH = /\b(money market|cash reserves?|sweep|core position|fdic|deposit|treasury money|government money|cash)\b/;
const RE_FUND = /\b(etf|fund|index|trust|portfolio|ishares|vanguard|spdr|invesco|admiral|instl|institutional|idx)\b/;
// Words that are also common in company names ("Target Corp", "Global
// Payments") only count when the name also looks like a fund.
const RE_BALANCED = /\b(target (date|retirement|20[2-7]\d)|lifepath|lifecycle|life ?strategy|asset allocation|wellington|wellesley|retirement (20[2-7]\d|income))\b/;
const RE_BALANCED_FUND = /\b(target|freedom|balanced|20[2-7][05])\b/;
const RE_BONDS = /\b(bonds?|treasur(y|ies)|fixed income|aggregate|tips|municipal|muni|govt|i-?bonds?|ee bonds?|savings bonds?|cds?)\b/;
const RE_REIT = /\b(real estate|reit|realty)\b/;
const RE_INTL = /\b(international|intl|int'l|emerging|developed|ex[- ]?us|foreign|europe|pacific|all[- ]?world|em markets)\b/;
const RE_INTL_FUND = /\b(global|world|china|india|japan)\b/;

function isCryptoAccount(a: Account): boolean {
  return (a.subtype ?? "").toLowerCase() === "crypto exchange";
}

/** Classify a holding into a display bucket. */
export function classifyHolding(h: Holding, account: Account): AssetBucket {
  const cls = (h.asset_class ?? "").toLowerCase();
  const ticker = (h.ticker_symbol ?? "").toUpperCase().trim();
  const name = (h.name ?? "").toLowerCase();

  if (cls === "crypto" || h.coingecko_id || isCryptoAccount(account)) return "crypto";
  if (cls === "cash" || CASH_TICKERS.has(ticker) || ticker.startsWith("CUR:") || RE_CASH.test(name)) return "cash";
  if (cls === "derivative") return "other";
  if (BOND_TICKERS.has(ticker)) return "bonds";
  if (INTL_TICKERS.has(ticker)) return "intl_stocks";
  if (REIT_TICKERS.has(ticker)) return "real_estate";
  const fundLike = cls === "etf" || cls === "mutual_fund" || /^[A-Z]{4}X$/.test(ticker) || RE_FUND.test(name);
  if (RE_BALANCED.test(name) || (fundLike && RE_BALANCED_FUND.test(name))) return "balanced";
  if (cls === "fixed_income" || RE_BONDS.test(name)) return "bonds";
  if (RE_REIT.test(name)) return "real_estate";
  if (RE_INTL.test(name) || (fundLike && RE_INTL_FUND.test(name))) return "intl_stocks";
  if (["equity", "etf", "mutual_fund"].includes(cls) || ticker) return "us_stocks";
  return "other";
}

/** Balance-only account (no positions) — classify from the account itself. */
function classifyAccount(a: Account): AssetBucket {
  if (isCryptoAccount(a)) return "crypto";
  const text = `${a.name} ${a.institution_name ?? ""}`.toLowerCase();
  if (text.includes("treasurydirect") || RE_BONDS.test(text)) return "bonds";
  if (RE_CASH.test(text)) return "cash";
  return "other";
}

/** A single stock or coin, as opposed to a diversified fund — only those count
 * as concentration risk. */
function isSinglePosition(h: Holding, bucket: AssetBucket): boolean {
  if (bucket === "crypto") return true;
  if (bucket !== "us_stocks" && bucket !== "intl_stocks" && bucket !== "real_estate") return false;
  const cls = (h.asset_class ?? "").toLowerCase();
  if (cls === "etf" || cls === "mutual_fund") return false;
  const ticker = (h.ticker_symbol ?? "").toUpperCase();
  if (/^[A-Z]{4}X$/.test(ticker)) return false; // mutual-fund ticker convention
  if (RE_FUND.test((h.name ?? "").toLowerCase())) return false;
  return cls === "equity" || !!ticker;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

interface Position {
  key: string;
  ticker: string | null;
  name: string;
  bucket: AssetBucket;
  value: number;
  costValue: number;   // current value of lots that have a cost basis
  cost: number;        // cost basis of those lots
  single: boolean;
  accounts: string[];
}

interface Insights {
  total: number;
  buckets: { bucket: AssetBucket; value: number; count: number; top: string[] }[];
  positions: Position[];   // rolled up by ticker across accounts, value desc
  balanceOnly: number;     // value from accounts with no position detail
  unlisted: number;        // account balance not covered by its positions
  costCoverage: number;    // share of position value that has a cost basis
}

function buildInsights(accounts: Account[], holdingsMap: Record<string, Holding[]>): Insights {
  const byKey = new Map<string, Position>();
  const bucketTotals = new Map<AssetBucket, number>();
  let balanceOnly = 0;
  let unlisted = 0;

  const addBucket = (b: AssetBucket, v: number) => bucketTotals.set(b, (bucketTotals.get(b) ?? 0) + v);

  for (const acc of accounts) {
    const balance = Number(acc.current_balance ?? 0);
    const holdings = (holdingsMap[acc.id] ?? []).filter((h) => Number(h.current_value ?? 0) !== 0);
    const held = holdings.reduce((s, h) => s + Number(h.current_value ?? 0), 0);

    if (holdings.length === 0) {
      if (balance > 0) {
        balanceOnly += balance;
        addBucket(classifyAccount(acc), balance);
      }
      continue;
    }

    for (const h of holdings) {
      const value = Number(h.current_value ?? 0);
      const bucket = classifyHolding(h, acc);
      addBucket(bucket, value);
      const ticker = h.ticker_symbol?.toUpperCase().trim() || null;
      const key = ticker ?? `name:${(h.name ?? "").toLowerCase()}:${acc.id}`;
      const hasCost = h.cost_basis !== null && h.cost_basis !== "" && Number(h.cost_basis) > 0;
      const p = byKey.get(key) ?? {
        key, ticker, name: h.name ?? ticker ?? "Unnamed position", bucket,
        value: 0, costValue: 0, cost: 0, single: isSinglePosition(h, bucket), accounts: [],
      };
      p.value += value;
      if (hasCost) { p.costValue += value; p.cost += Number(h.cost_basis); }
      if (!p.accounts.includes(acc.name)) p.accounts.push(acc.name);
      byKey.set(key, p);
    }

    // Balance the institution reports beyond the listed positions — usually
    // uninvested cash that isn't itemised as a holding.
    const gap = balance - held;
    if (gap > Math.max(1, balance * 0.005)) {
      unlisted += gap;
      addBucket("cash", gap);
    }
  }

  const positions = Array.from(byKey.values()).sort((a, b) => b.value - a.value);
  const posValue = positions.reduce((s, p) => s + p.value, 0);
  const costValue = positions.reduce((s, p) => s + p.costValue, 0);
  const total = Array.from(bucketTotals.values()).reduce((s, v) => s + v, 0);

  const buckets = BUCKET_ORDER
    .map((bucket) => {
      const inBucket = positions.filter((p) => p.bucket === bucket);
      return {
        bucket,
        value: bucketTotals.get(bucket) ?? 0,
        count: inBucket.length,
        top: inBucket.slice(0, 3).map((p) => p.ticker ?? p.name),
      };
    })
    .filter((b) => b.value > 0.5);

  return {
    total, buckets, positions, balanceOnly, unlisted,
    costCoverage: posValue > 0 ? costValue / posValue : 0,
  };
}

// ─── UI ──────────────────────────────────────────────────────────────────────

type Fmt = (val: string | number | null | undefined, decimals?: number) => string;

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const sign = (v: number) => (v >= 0 ? "+" : "−");

function Card({ title, subtitle, children, className = "" }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl shadow border border-gray-100 flex flex-col ${className}`}>
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function AllocationCard({ ins, fmt }: { ins: Insights; fmt: Fmt }) {
  const max = Math.max(...ins.buckets.map((b) => b.value), 1);
  const notes: string[] = [];
  if (ins.unlisted > 0) notes.push(`${fmt(ins.unlisted)} of account balances isn't itemised as positions and is counted as cash.`);
  if (ins.balanceOnly > 0) notes.push(`${fmt(ins.balanceOnly)} sits in accounts with no position detail, classified from the account name.`);
  return (
    <Card title="Asset Allocation" subtitle="Across all accounts shown, by what you hold">
      <ul className="px-5 py-3 space-y-2.5">
        {ins.buckets.map((b) => {
          const share = ins.total > 0 ? b.value / ins.total : 0;
          const tip = [
            `${BUCKET_LABEL[b.bucket]}: ${fmt(b.value)} (${pct(share)})`,
            b.count > 0 ? `${b.count} position${b.count !== 1 ? "s" : ""}${b.top.length ? ` — ${b.top.join(", ")}${b.count > 3 ? "…" : ""}` : ""}` : "",
          ].filter(Boolean).join("\n");
          return (
            <li key={b.bucket} title={tip} className="group cursor-default">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-gray-700 font-medium truncate">{BUCKET_LABEL[b.bucket]}</span>
                <span className="shrink-0 tabular-nums text-gray-900 font-semibold">
                  {pct(share)}
                  <span className="ml-2 font-normal text-gray-400">{fmt(b.value)}</span>
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 group-hover:bg-blue-600 transition-colors"
                  style={{ width: `${Math.max((b.value / max) * 100, 1)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-5 pb-3 text-[11px] leading-relaxed text-gray-400">
        Classified from security type and fund names, so treat it as approximate.
        {notes.length > 0 && <> {notes.join(" ")}</>}
      </p>
    </Card>
  );
}

function TopHoldingsCard({ ins, fmt, pnlMode }: { ins: Insights; fmt: Fmt; pnlMode: "dollar" | "percent" }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? ins.positions : ins.positions.slice(0, 10);
  return (
    <Card title="Top Holdings" subtitle="Same ticker combined across accounts">
      {ins.positions.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-gray-400">No positions loaded yet</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                  <th className="text-left font-semibold px-5 py-2">Holding</th>
                  <th className="text-right font-semibold px-2 py-2">Value</th>
                  <th className="text-right font-semibold px-2 py-2">Weight</th>
                  <th className="text-right font-semibold px-5 py-2">Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const weight = ins.total > 0 ? p.value / ins.total : 0;
                  const gain = p.costValue - p.cost;
                  const gainPct = p.cost > 0 ? gain / p.cost : null;
                  const partial = p.costValue > 0 && p.costValue < p.value - 0.5;
                  return (
                    <tr key={p.key} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-2 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {p.ticker && <span className="font-mono font-semibold text-gray-800">{p.ticker}</span>}
                          <span className="text-gray-400 truncate max-w-[160px]" title={p.name}>{p.name}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5" title={p.accounts.join("\n")}>
                          {p.accounts.length === 1 ? p.accounts[0] : `${p.accounts.length} accounts`}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-900 font-medium">{fmt(p.value)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(weight)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">
                        {gainPct === null ? (
                          <span className="text-gray-300" title="No cost basis recorded">—</span>
                        ) : (
                          <span
                            className={gain >= 0 ? "text-emerald-600" : "text-red-600"}
                            title={partial ? "Cost basis is missing for some lots; gain covers only the lots that have one" : undefined}
                          >
                            {sign(gain)}{pnlMode === "dollar" ? fmt(Math.abs(gain)) : pct(Math.abs(gainPct))}
                            {partial && <span className="text-gray-400">*</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ins.positions.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="w-full px-5 py-2.5 text-xs font-medium text-blue-600 hover:bg-gray-50 border-t border-gray-100"
            >
              {showAll ? "Show top 10" : `Show all ${ins.positions.length} holdings`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

const HIGH = 0.10;
const WATCH = 0.05;

function ConcentrationCard({ ins, fmt }: { ins: Insights; fmt: Fmt }) {
  const top10 = ins.positions.slice(0, 10).reduce((s, p) => s + p.value, 0);
  const top10Share = ins.total > 0 ? top10 / ins.total : 0;
  const largest = ins.positions[0];
  const flagged = ins.positions
    .filter((p) => p.single && ins.total > 0 && p.value / ins.total >= WATCH)
    .map((p) => ({ ...p, share: p.value / ins.total }));
  const multiAccount = ins.positions.filter((p) => p.accounts.length > 1).length;

  return (
    <Card title="Concentration" subtitle={`Single stocks or coins at ${pct(WATCH, 0)}+ of the portfolio`}>
      <div className="grid grid-cols-2 gap-px bg-gray-100 border-b border-gray-100">
        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Top 10 positions</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">{pct(top10Share, 0)}</p>
          <p className="text-[10px] text-gray-400">of {ins.positions.length} total</p>
        </div>
        <div className="bg-white px-5 py-3 min-w-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Largest position</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">
            {largest && ins.total > 0 ? pct(largest.value / ins.total, 1) : "—"}
          </p>
          <p className="text-[10px] text-gray-400 truncate" title={largest?.name}>{largest ? (largest.ticker ?? largest.name) : ""}</p>
        </div>
      </div>
      {flagged.length === 0 ? (
        <div className="px-5 py-5 flex items-start gap-2.5">
          <svg className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-xs text-gray-600">
            No single stock or coin is above {pct(WATCH, 0)} of the portfolio. Diversified funds aren&apos;t counted.
          </p>
        </div>
      ) : (
        <ul>
          {flagged.map((p) => {
            const high = p.share >= HIGH;
            return (
              <li key={p.key} className="px-5 py-2.5 flex items-center justify-between gap-3 border-t border-gray-50 first:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className={`w-4 h-4 shrink-0 ${high ? "text-red-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-xs">
                      <span className="font-mono font-semibold text-gray-800">{p.ticker ?? p.name}</span>
                      <span className={`ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${high ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                        {high ? "High" : "Watch"}
                      </span>
                    </p>
                    <p className="text-[10px] text-gray-400 truncate" title={p.accounts.join("\n")}>
                      {p.accounts.length === 1 ? p.accounts[0] : `${p.accounts.length} accounts`}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold tabular-nums text-gray-900">{pct(p.share)}</p>
                  <p className="text-[10px] tabular-nums text-gray-400">{fmt(p.value)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-5 py-2.5 text-[11px] text-gray-400 border-t border-gray-50">
        {multiAccount > 0
          ? `${multiAccount} holding${multiAccount !== 1 ? "s are" : " is"} spread across more than one account.`
          : "No holding is spread across accounts."}
        {ins.costCoverage < 0.98 && ins.positions.length > 0 && ` Cost basis is recorded for ${pct(ins.costCoverage, 0)} of position value.`}
      </p>
    </Card>
  );
}

export default function PortfolioInsights({
  accounts, holdingsMap, fmt, pnlMode,
}: {
  accounts: Account[];
  holdingsMap: Record<string, Holding[]>;
  fmt: Fmt;
  pnlMode: "dollar" | "percent";
}) {
  const allLoaded = accounts.every((a) => holdingsMap[a.id] !== undefined);
  const ins = useMemo(() => buildInsights(accounts, holdingsMap), [accounts, holdingsMap]);

  if (accounts.length === 0) return null;
  if (!allLoaded) {
    return (
      <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-gray-400">
        Loading portfolio analysis…
      </div>
    );
  }
  if (ins.total <= 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">
      <AllocationCard ins={ins} fmt={fmt} />
      <TopHoldingsCard ins={ins} fmt={fmt} pnlMode={pnlMode} />
      <ConcentrationCard ins={ins} fmt={fmt} />
    </div>
  );
}
