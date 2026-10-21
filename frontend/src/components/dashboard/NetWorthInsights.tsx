"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { getCategoryReportTypes } from "@/lib/api";
import type { Account, NetWorthSnapshot, ReportType, Transaction } from "@/lib/api";
import { explicitReportType } from "@/lib/reportTypes";

// Tax-advantaged / locked-up account subtypes (mirrors the Investments page)
const RETIREMENT_SUBTYPES = new Set([
  "401k", "401a", "403b", "457b", "457plan",
  "ira", "roth", "roth 401k",
  "sep ira", "simple ira",
  "pension", "529", "529 plan",
  "hsa", "keogh",
  "non-taxable brokerage account", "retirement",
  "profit sharing plan", "rdsp", "rrif", "rrsp", "sarsep", "tfsa",
]);

// Snapshots before this date also counted accounts outside the home country
// (and so are not comparable with the dashboard figure)
const COMPARABLE_SNAPSHOTS_SINCE = "2026-10-21";

const isInvestment = (a: Account) => ["investment", "brokerage"].includes(a.type);
const balanceOf = (a: Account) => parseFloat(a.current_balance ?? "0") || 0;

type Window = "1M" | "YTD" | "1Y";

interface Props {
  accounts: Account[];
  cash: number;
  /** Investments including 529 plans */
  investments: number;
  realEstate: number;
  liabilities: number;
  netWorth: number;
  snapshots: NetWorthSnapshot[];
  transactions: Transaction[];
  fmt: (value: number) => string;
  locale: string;
}

function windowStart(w: Window, now: Date): Date {
  if (w === "1M") return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  if (w === "YTD") return new Date(now.getFullYear(), 0, 1);
  return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
}

/** Average monthly spending over the last 3 full months (full loan payments included) */
function avgMonthlySpending(transactions: Transaction[], reportTypes: Record<string, ReportType>, now: Date): number | null {
  const months: number[] = [];
  for (let back = 1; back <= 3; back++) {
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
    let total = 0, seen = false;
    for (const t of transactions) {
      const d = new Date(`${t.date}T00:00:00`);
      if (d < start || d >= end) continue;
      seen = true;
      const amt = parseFloat(t.amount);
      if (amt <= 0 || t.is_ignored || t.pending || t.is_business || t.is_property_expense) continue;
      const type = explicitReportType(t.plaid_category, reportTypes) ?? (t.is_transfer ? "transfer" : "cashflow");
      if (type === "cashflow") total += amt;
    }
    if (seen) months.push(total);
  }
  return months.length ? months.reduce((s, v) => s + v, 0) / months.length : null;
}

/** Net worth change and what drove it, liquidity, emergency cushion and ratios. */
export default function NetWorthInsights({
  accounts, cash, investments, realEstate, liabilities, netWorth, snapshots, transactions, fmt, locale,
}: Props) {
  const [win, setWin] = useState<Window>("YTD");
  const [reportTypes, setReportTypes] = useState<Record<string, ReportType>>({});
  useEffect(() => { getCategoryReportTypes().then(setReportTypes).catch(() => {}); }, []);

  const now = useMemo(() => new Date(), []);

  const change = useMemo(() => {
    const sorted = snapshots
      .filter((s) => s.snapshot_date.slice(0, 10) >= COMPARABLE_SNAPSHOTS_SINCE)
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    if (sorted.length === 0) return null;
    const start = windowStart(win, now);
    // Latest snapshot on/before the window start, else the earliest one after it
    let base = sorted[0];
    for (const s of sorted) {
      if (new Date(s.snapshot_date) <= start) base = s;
      else break;
    }
    const baseDate = new Date(base.snapshot_date);
    const num = (v: string) => parseFloat(v) || 0;
    const parts = [
      { label: "Investments", value: investments - num(base.total_investments) },
      { label: "Real estate", value: realEstate - num(base.total_real_estate) },
      { label: "Cash", value: cash - num(base.total_cash) },
      // Paying debt down raises net worth
      { label: "Debt", value: num(base.total_debts) - liabilities },
    ];
    return {
      total: netWorth - num(base.net_worth),
      base: num(base.net_worth),
      since: baseDate,
      partial: baseDate > new Date(start.getTime() + 3 * 86_400_000),
      parts,
    };
  }, [snapshots, win, now, cash, investments, realEstate, liabilities, netWorth]);

  const liquid = useMemo(() => {
    const taxable = accounts
      .filter((a) => isInvestment(a) && !RETIREMENT_SUBTYPES.has((a.subtype ?? "").toLowerCase()))
      .reduce((s, a) => s + balanceOf(a), 0);
    const cardDebt = accounts.filter((a) => a.type === "credit").reduce((s, a) => s + balanceOf(a), 0);
    return { taxable, value: cash + taxable - cardDebt };
  }, [accounts, cash]);

  const monthlySpend = useMemo(() => avgMonthlySpending(transactions, reportTypes, now), [transactions, reportTypes, now]);
  const cushionMonths = monthlySpend && monthlySpend > 0 ? cash / monthlySpend : null;

  const assets = cash + investments + realEstate;
  const debtToAssets = assets > 0 ? liabilities / assets : 0;
  const realEstateShare = assets > 0 ? realEstate / assets : 0;
  const retirementShare = assets > 0 ? (investments - liquid.taxable) / assets : 0;

  const maxPart = change ? Math.max(1, ...change.parts.map((p) => Math.abs(p.value))) : 1;
  const sign = (v: number) => (v >= 0 ? "+" : "−");

  return (
    <Card>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Change and drivers */}
        <div className="lg:col-span-3">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Net worth change</h3>
              <p className="text-xs text-gray-400">What moved it, by component</p>
            </div>
            <div className="flex items-center gap-1">
              {(["1M", "YTD", "1Y"] as Window[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWin(w)}
                  className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${
                    win === w
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-700"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {!change ? (
            <p className="text-sm text-gray-400">No comparable snapshots yet. One is taken daily, or take one from Financial History below.</p>
          ) : (
            <>
              <p className={`text-2xl font-bold tabular-nums ${change.total >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {sign(change.total)}{fmt(Math.abs(change.total))}
                {change.base > 0 && (
                  <span className="text-sm font-semibold ml-2">
                    {sign(change.total)}{Math.abs((change.total / change.base) * 100).toFixed(1)}%
                  </span>
                )}
              </p>
              <p className="text-[11px] text-gray-400 mb-3">
                since {change.since.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
                {change.partial && " (earliest snapshot)"}
              </p>
              <ul className="space-y-1.5">
                {change.parts.map((p) => (
                  <li key={p.label} className="grid grid-cols-[88px_1fr_96px] items-center gap-2 text-xs">
                    <span className="text-gray-600 dark:text-gray-300">{p.label}</span>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-700 relative overflow-hidden">
                      <div
                        className={`absolute top-0 h-full ${p.value >= 0 ? "bg-emerald-500 left-1/2" : "bg-red-400 right-1/2"}`}
                        style={{ width: `${(Math.abs(p.value) / maxPart) * 50}%` }}
                      />
                    </div>
                    <span className={`text-right tabular-nums font-semibold ${p.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                      {sign(p.value)}{fmt(Math.abs(p.value))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-gray-400 mt-2">
                Investments include new contributions and market moves together.
              </p>
            </>
          )}
        </div>

        {/* Health ratios */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-2 content-start">
          <div className="rounded-lg bg-gray-50 dark:bg-slate-700/40 px-3 py-2.5 col-span-2"
            title="Cash + taxable brokerage − credit card balances. Excludes retirement accounts, 529s, HSAs and real estate.">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Liquid net worth</p>
            <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{fmt(liquid.value)}</p>
            <p className="text-[10px] text-gray-400">
              {netWorth > 0 ? `${((liquid.value / netWorth) * 100).toFixed(0)}% of net worth` : ""} · cash + taxable brokerage − cards
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-slate-700/40 px-3 py-2.5"
            title="Cash & banking ÷ average monthly spending over the last 3 full months. 3–6 months is a common target.">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Emergency cushion</p>
            <p className={`text-lg font-bold tabular-nums ${cushionMonths !== null && cushionMonths < 3 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>
              {cushionMonths === null ? "—" : `${cushionMonths.toFixed(1)} mo`}
            </p>
            <p className="text-[10px] text-gray-400">{monthlySpend ? `${fmt(monthlySpend)}/mo spending` : "no spending data"}</p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-slate-700/40 px-3 py-2.5" title="Liabilities ÷ total assets">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Debt to assets</p>
            <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{(debtToAssets * 100).toFixed(1)}%</p>
            <p className="text-[10px] text-gray-400">{fmt(liabilities)} owed</p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-slate-700/40 px-3 py-2.5 col-span-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Where assets sit</p>
            <div className="h-2.5 rounded-full overflow-hidden flex bg-gray-100 dark:bg-slate-700">
              <div className="bg-emerald-500" style={{ width: `${(assets > 0 ? (cash + liquid.taxable) / assets : 0) * 100}%` }} />
              <div className="bg-blue-500" style={{ width: `${retirementShare * 100}%` }} />
              <div className="bg-amber-400" style={{ width: `${realEstateShare * 100}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
              <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1" />Liquid {(assets > 0 ? ((cash + liquid.taxable) / assets) * 100 : 0).toFixed(0)}%</span>
              <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mr-1" />Retirement &amp; 529 {(retirementShare * 100).toFixed(0)}%</span>
              <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1" />Real estate {(realEstateShare * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
