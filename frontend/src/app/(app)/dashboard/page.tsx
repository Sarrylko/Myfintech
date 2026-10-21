"use client";

import CountryGate from "@/components/CountryGate";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import {
  listAccounts,
  listBudgets,
  listLongTermBudgets,
  listAllTransactions,
  listProperties,
  listAllLoans,
  listNetWorthSnapshots,
  takeNetWorthSnapshot,
  getSankeyData,
  Account,
  BudgetWithActual,
  Transaction,
  Property,
  Loan,
  NetWorthSnapshot,
  SankeyData,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { useCurrency } from "@/lib/currency";
import { useForex } from "@/components/ForexProvider";
import { convertToUSD, fmtInCurrency } from "@/lib/forex";

const SankeyChart = dynamic(() => import("@/components/SankeyChart"), { ssr: false });
import PayrollInsights from "@/components/dashboard/PayrollInsights";
import NetWorthInsights from "@/components/dashboard/NetWorthInsights";
const CurrentSpendChart = dynamic(() => import("@/components/dashboard/CurrentSpendChart"), { ssr: false });
const FinancialHistorySection = dynamic(() => import("@/components/dashboard/FinancialHistoryChart"), { ssr: false });

function formatBudgetPeriodShort(b: BudgetWithActual, fmtDate: (d: string) => string): string {
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (b.budget_type === "annual") return `${b.year} (Full Year)`;
  if (b.budget_type === "quarterly" && b.start_date) {
    const q = Math.floor(new Date(b.start_date + "T00:00:00").getMonth() / 3) + 1;
    return `Q${q} ${b.year}`;
  }
  if (b.budget_type === "custom" && b.start_date && b.end_date) {
    return `${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}`;
  }
  return `${MONTH_NAMES[(b.month ?? 1) - 1]} ${b.year}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NetWorthCard({
  label,
  value,
  subtext,
  color = "text-gray-900",
  icon,
  breakdown,
  accent = "slate",
  hint,
}: {
  hint?: string;
  label: string;
  value: number;
  subtext?: string;
  color?: string;
  icon: React.ReactNode;
  breakdown?: { label: string; amount: string }[];
  accent?: "indigo" | "green" | "blue" | "amber" | "red" | "slate";
}) {
  const { fmt } = useCurrency();
  const cardStyles: Record<string, string> = {
    indigo: "bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/40 dark:to-slate-800 border-indigo-100 dark:border-indigo-800/30",
    green:  "bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-800 border-emerald-100 dark:border-emerald-800/30",
    blue:   "bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/40 dark:to-slate-800 border-blue-100 dark:border-blue-800/30",
    amber:  "bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/40 dark:to-slate-800 border-amber-100 dark:border-amber-800/30",
    red:    "bg-gradient-to-br from-red-50 to-white dark:from-red-950/40 dark:to-slate-800 border-red-100 dark:border-red-800/30",
    slate:  "bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700",
  };
  const iconStyles: Record<string, string> = {
    indigo: "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400",
    green:  "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400",
    blue:   "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400",
    amber:  "bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400",
    red:    "bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400",
    slate:  "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400",
  };
  return (
    <div className={`rounded-xl border p-4 ${cardStyles[accent]}`} title={hint}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`p-1.5 rounded-lg ${iconStyles[accent]}`}>{icon}</span>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color} dark:text-white tabular-nums`}>{fmt(value)}</p>
      {breakdown && breakdown.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {breakdown.map((b) => (
            <span key={b.label} className="text-xs text-gray-400 dark:text-gray-500">
              {b.label} {b.amount}
            </span>
          ))}
        </div>
      )}
      {subtext && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{subtext}</p>}
    </div>
  );
}

function MiniProgressBar({ pct, alertThreshold }: { pct: number; alertThreshold: number }) {
  const clamped = Math.min(pct, 100);
  let color = "bg-gradient-to-r from-emerald-400 to-emerald-500";
  if (pct >= 100) color = "bg-gradient-to-r from-red-400 to-rose-500";
  else if (pct >= alertThreshold) color = "bg-gradient-to-r from-amber-400 to-orange-400";
  return (
    <div className="w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-700 ease-out`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

// ─── Budget Status Card ───────────────────────────────────────────────────────

function MonthlyBudgetSection({ budgets }: { budgets: BudgetWithActual[] }) {
  const { fmt } = useCurrency();
  if (budgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center">
        <p className="text-gray-400 text-sm mb-3">No budgets set up for this month</p>
        <Link
          href="/budgets"
          className="text-sm text-blue-600 hover:text-blue-700 font-medium border border-blue-200 px-4 py-1.5 rounded-lg hover:bg-blue-50 transition"
        >
          Set up budgets →
        </Link>
      </div>
    );
  }

  const expenseBudgets = budgets.filter((b) => !b.category.is_income);
  const totalBudgeted = expenseBudgets.reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalSpent = expenseBudgets.reduce((s, b) => s + parseFloat(b.actual_spent), 0);
  const overCount = expenseBudgets.filter((b) => parseFloat(b.remaining) < 0).length;
  const overallPct = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0;

  // Top 5 by spending percentage
  const top5 = [...expenseBudgets]
    .sort((a, b) => parseFloat(b.percent_used) - parseFloat(a.percent_used))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          <span className="font-semibold text-gray-800">{fmt(totalSpent)}</span> of {fmt(totalBudgeted)} spent
        </span>
        <span className={`font-semibold text-xs px-2 py-0.5 rounded-full ${
          overCount > 0 ? "bg-red-50 text-red-600" : overallPct >= 80 ? "bg-yellow-50 text-yellow-600" : "bg-green-50 text-green-600"
        }`}>
          {overCount > 0 ? `${overCount} over limit` : `${Math.round(overallPct)}% used`}
        </span>
      </div>
      <MiniProgressBar pct={overallPct} alertThreshold={80} />

      {/* Top categories */}
      <div className="space-y-2.5 mt-1">
        {top5.map((b) => {
          const pct = parseFloat(b.percent_used);
          const isOver = parseFloat(b.remaining) < 0;
          return (
            <div key={b.id} className="flex items-center gap-3">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white shrink-0"
                style={{ backgroundColor: b.category.color ?? "#94a3b8" }}
              >
                {b.category.icon ?? b.category.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-700 truncate">{b.category.name}</span>
                  <span className={`ml-2 shrink-0 font-medium ${isOver ? "text-red-600" : "text-gray-500"}`}>
                    {Math.round(pct)}%
                  </span>
                </div>
                <MiniProgressBar pct={pct} alertThreshold={b.alert_threshold} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Long-term Budgets Card ───────────────────────────────────────────────────

function LongTermBudgetSection({ budgets }: { budgets: BudgetWithActual[] }) {
  const { fmt, fmtDate } = useCurrency();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Only show currently active or relevant budgets:
  // - Annual: always show current year
  // - Quarterly: show if today is within start_date..end_date
  // - Custom: show if today is within or upcoming within 30 days
  const visible = budgets.filter((b) => {
    if (b.budget_type === "annual") return true;
    if (!b.start_date || !b.end_date) return false;
    const start = new Date(b.start_date + "T00:00:00");
    const end = new Date(b.end_date + "T00:00:00");
    const daysUntilStart = (start.getTime() - today.getTime()) / 86400000;
    return today <= end && daysUntilStart <= 30; // active or starting within 30 days
  });

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center">
        <p className="text-gray-400 text-sm mb-3">No active long-term budgets</p>
        <Link
          href="/budgets"
          className="text-sm text-blue-600 hover:text-blue-700 font-medium border border-blue-200 px-4 py-1.5 rounded-lg hover:bg-blue-50 transition"
        >
          Create long-term budget →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((b) => {
        const pct = parseFloat(b.percent_used);
        const isOver = parseFloat(b.remaining) < 0;
        const isActive = b.start_date
          ? new Date(b.start_date + "T00:00:00") <= today
          : true;
        return (
          <div key={b.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white shrink-0"
                style={{ backgroundColor: b.category.color ?? "#94a3b8" }}
              >
                {b.category.icon ?? b.category.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <span className="text-sm font-medium text-gray-800 truncate">{b.category.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{formatBudgetPeriodShort(b, fmtDate)}</span>
                {!isActive && (
                  <span className="text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded shrink-0">upcoming</span>
                )}
              </div>
              <span className={`text-xs font-semibold shrink-0 ${isOver ? "text-red-600" : "text-gray-500"}`}>
                {fmt(parseFloat(b.actual_spent))} / {fmt(parseFloat(b.amount))}
              </span>
            </div>
            <MiniProgressBar pct={pct} alertThreshold={b.alert_threshold} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Recent Transactions ──────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  housing: "#f59e0b", food: "#ef4444", transport: "#3b82f6",
  health: "#10b981", shopping: "#8b5cf6", entertainment: "#f97316",
  income: "#22c55e", savings: "#06b6d4", financial: "#6366f1",
  travel: "#0ea5e9", education: "#a855f7", insurance: "#64748b",
  utilities: "#14b8a6", taxes: "#dc2626", personal: "#ec4899",
};

function catColor(raw: string | null): string {
  if (!raw) return "#94a3b8";
  const lower = raw.toLowerCase();
  for (const [key, color] of Object.entries(CAT_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "#94a3b8";
}

function RecentTransactionsSection({ transactions }: { transactions: Transaction[] }) {
  const { fmt, locale } = useCurrency();
  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center">
        <p className="text-gray-400 text-sm">No transactions yet</p>
        <Link href="/accounts" className="mt-2 text-sm text-blue-600 hover:underline">
          Connect an account →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {transactions.slice(0, 8).map((t) => {
        const amount = parseFloat(t.amount);
        const isIncome = amount < 0;
        const label = t.merchant_name ?? t.name;
        const color = catColor(t.plaid_category);
        const catShort = t.plaid_category?.split(" > ")[0] ?? "";
        return (
          <div key={t.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50/80 dark:hover:bg-slate-700/40 transition">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: color + "18", color }}
            >
              {label.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">{label}</p>
              <p className="text-xs text-gray-400">
                {new Date(t.date + "T00:00:00").toLocaleDateString(locale, { month: "short", day: "numeric" })}
                {catShort && <span className="ml-1.5 text-gray-300 dark:text-gray-600">·</span>}
                {catShort && <span className="ml-1.5">{catShort}</span>}
              </p>
            </div>
            <span className={`text-sm font-semibold ml-2 shrink-0 tabular-nums ${isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-gray-800 dark:text-gray-200"}`}>
              {isIncome ? "+" : ""}{fmt(Math.abs(amount))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Liabilities Section ──────────────────────────────────────────────────────

function LiabilitiesSection({
  creditAccounts,
  loans,
  properties,
}: {
  creditAccounts: Account[];
  loans: Loan[];
  properties: Property[];
}) {
  const { fmt } = useCurrency();
  if (creditAccounts.length === 0 && loans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center">
        <p className="text-gray-400 text-sm mb-3">No liabilities tracked</p>
        <Link href="/accounts" className="text-sm text-blue-600 hover:text-blue-700 font-medium border border-blue-200 px-4 py-1.5 rounded-lg hover:bg-blue-50 transition">
          Add an account →
        </Link>
      </div>
    );
  }

  const propMap = new Map(properties.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      {/* Credit Cards */}
      {creditAccounts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Credit Cards</p>
          <div className="space-y-2.5">
            {creditAccounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">{a.name}</p>
                    {a.institution_name && (
                      <p className="text-xs text-gray-400 truncate">{a.institution_name}</p>
                    )}
                  </div>
                </div>
                <span className="text-sm font-semibold text-red-600 ml-3 shrink-0">
                  {fmt(parseFloat(a.current_balance ?? "0"))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mortgages & Property Loans */}
      {loans.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Mortgages & Loans</p>
          <div className="space-y-2.5">
            {loans.map((loan) => {
              const prop = propMap.get(loan.property_id);
              const label = loan.lender_name ?? loan.loan_type ?? "Mortgage";
              const sublabel = prop
                ? `${prop.address}${prop.city ? `, ${prop.city}` : ""}`
                : loan.loan_type;
              return (
                <div key={loan.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 font-medium truncate">{label}</p>
                      {sublabel && <p className="text-xs text-gray-400 truncate">{sublabel}</p>}
                    </div>
                  </div>
                  <div className="text-right ml-3 shrink-0">
                    <p className="text-sm font-semibold text-red-600">
                      {fmt(parseFloat(loan.current_balance ?? "0"))}
                    </p>
                    {loan.monthly_payment && (
                      <p className="text-xs text-gray-400">{fmt(parseFloat(loan.monthly_payment))}/mo</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sankey: Annual Payroll Flow ─────────────────────────────────────────────

const SANKEY_YEARS = [2024, 2025, 2026];

function SankeyDashboardSection() {
  const [annualYear, setAnnualYear] = useState<number>(new Date().getFullYear());
  const [data, setData] = useState<SankeyData | null>(null);
  const [previous, setPrevious] = useState<SankeyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fmt, locale } = useCurrency();

  useEffect(() => {
    setLoading(true);
    setError(null);
    // The previous year is only used for year-over-year rate changes
    Promise.all([
      getSankeyData({ annual: true, year: annualYear }),
      getSankeyData({ annual: true, year: annualYear - 1 }).catch(() => null),
    ])
      .then(([current, prior]) => {
        setData(current);
        setPrevious(prior?.sankey_type === "payroll" ? prior : null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [annualYear]);

  const periodLabel = (() => {
    if (!data?.period_start || !data.period_end) return null;
    const d = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" });
    return `${d(data.period_start)} – ${d(data.period_end)}, ${data.year}`;
  })();
  const savedTotal = data?.payroll
    ? data.payroll.payroll_investments + data.payroll.savings_transfers + data.payroll.loan_principal
    : 0;

  const btnBase =
    "text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors duration-150";
  const btnActive =
    "bg-indigo-600 border-indigo-600 text-white";
  const btnIdle =
    "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-700";

  return (
    <Card>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Annual Payroll Flow</h3>
          <p className="text-xs text-gray-400">
            Gross → Taxes → Investments → Expenses&ensp;·&ensp;
            <Link href="/settings/salary" className="text-indigo-500 hover:underline">Edit W-2 data</Link>
          </p>
          {periodLabel && !loading && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              {periodLabel}
              {data?.prorated && " · W-2 amounts prorated to date so pay and spending cover the same period"}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {SANKEY_YEARS.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setAnnualYear(y)}
              className={`${btnBase} ${annualYear === y ? btnActive : btnIdle}`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Summary totals */}
      {data && !loading && (
        <div className="flex items-center gap-4 mb-3 text-xs">
          {data.sankey_type === "payroll" && data.gross_income ? (
            <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
              Gross&nbsp;{fmt(data.gross_income)}
            </span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              Income&nbsp;{fmt(data.total_income)}
            </span>
          )}
          <span className="text-gray-300 dark:text-gray-600">→</span>
          <span className="text-red-500 dark:text-red-400 font-semibold">
            Expenses&nbsp;{fmt(data.total_expenses)}
          </span>
          {data.payroll ? (
            <>
              <span className="text-gray-300 dark:text-gray-600">·</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                Saved&nbsp;{fmt(savedTotal)}
              </span>
            </>
          ) : data.remaining > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">·</span>
              <span className="text-blue-600 dark:text-blue-400 font-semibold">
                Saved&nbsp;{fmt(data.remaining)}
              </span>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-80 text-sm text-gray-400">
          Loading…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center h-80 text-sm text-red-400">
          {error}
        </div>
      )}
      {data && !loading && <PayrollInsights data={data} previous={previous} fmt={fmt} />}
      {data && !loading && <SankeyChart data={data} />}
    </Card>
  );
}


// ─── Accounts Panel ───────────────────────────────────────────────────────────

function AccountsPanel({ accounts, onSync, syncing, lastUpdated }: {
  accounts: Account[];
  onSync: () => void;
  syncing: boolean;
  lastUpdated: Date | null;
}) {
  const { fmt } = useCurrency();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  const vis = accounts.filter((a) => !a.is_hidden);
  const sum = (arr: Account[]) => arr.reduce((s, a) => s + parseFloat(String(a.current_balance ?? 0)), 0);

  const checkingAccs = vis.filter((a) => a.type === "depository" && a.subtype !== "savings");
  const savingsAccs  = vis.filter((a) => a.type === "depository" && a.subtype === "savings");
  const creditAccs   = vis.filter((a) => a.type === "credit");
  const investAccs   = vis.filter((a) => ["investment", "brokerage"].includes(a.type) && (a.subtype ?? "").toLowerCase() !== "529");

  const checkingTotal = sum(checkingAccs);
  const savingsTotal  = sum(savingsAccs);
  const creditTotal   = sum(creditAccs);
  const investTotal   = sum(investAccs);
  const netCash       = checkingTotal + savingsTotal - creditTotal;


  function timeAgo(d: Date) {
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs !== 1 ? "s" : ""} ago`;
    return `${Math.round(hrs / 24)} days ago`;
  }

  const ACCOUNT_ICONS: Record<string, React.ReactNode> = {
    checking: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    credit: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    savings: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    invest: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    netcash: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  type RowDef = { key: string; label: string; total: number; accs: Account[]; iconKey: string; valueColor?: string; isNetCash?: boolean };
  const rows: RowDef[] = [
    { key: "checking", label: "Checking",     total: checkingTotal, accs: checkingAccs, iconKey: "checking" },
    { key: "credit",   label: "Card Balance", total: creditTotal,   accs: creditAccs,   iconKey: "credit",  valueColor: creditTotal > 0 ? "text-red-600" : "text-gray-900" },
    { key: "netcash",  label: "Net Cash",      total: netCash,       accs: [],           iconKey: "netcash", valueColor: netCash >= 0 ? "text-green-600" : "text-red-600", isNetCash: true },
    { key: "savings",  label: "Savings",       total: savingsTotal,  accs: savingsAccs,  iconKey: "savings" },
    { key: "invest",   label: "Investments",   total: investTotal,   accs: investAccs,   iconKey: "invest" },
  ];

  return (
    <Card padding="none" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 dark:border-slate-700">
        <h3 className="font-semibold text-gray-900 dark:text-white">Accounts</h3>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {lastUpdated && <span>{timeAgo(lastUpdated)}</span>}
          {lastUpdated && <span className="text-gray-200">|</span>}
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="text-blue-600 hover:text-blue-700 font-medium disabled:opacity-40 transition"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 divide-y divide-gray-50">
        {rows.map((row) => (
          <div key={row.key}>
            <button
              type="button"
              onClick={() => !row.isNetCash && row.accs.length > 0 && toggle(row.key)}
              className={`w-full flex items-center gap-3 px-5 py-3 text-left transition ${
                !row.isNetCash && row.accs.length > 0 ? "hover:bg-gray-50/60 cursor-pointer" : "cursor-default"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                row.key === "netcash" ? "bg-green-50 text-green-600" :
                row.key === "credit"  ? "bg-red-50 text-red-500" :
                row.key === "invest"  ? "bg-blue-50 text-blue-600" :
                "bg-gray-100 text-gray-500"
              }`}>
                {ACCOUNT_ICONS[row.iconKey]}
              </div>
              <span className="flex-1 text-sm text-gray-700 font-medium">{row.label}</span>
              <span className={`text-sm font-semibold tabular-nums ${row.valueColor ?? "text-gray-900"}`}>
                {fmt(row.total)}
              </span>
              {!row.isNetCash && row.accs.length > 0 ? (
                <svg className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${expanded[row.key] ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              ) : row.isNetCash ? (
                <span className="w-4 h-4 text-xs text-gray-300 shrink-0 flex items-center justify-center" title="Checking + Savings − Cards">ⓘ</span>
              ) : (
                <span className="w-4 shrink-0" />
              )}
            </button>

            {/* Expanded individual accounts */}
            {expanded[row.key] && row.accs.length > 0 && (
              <div className="bg-gray-50/50 border-t border-gray-50">
                {row.accs.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-2 pl-16">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{a.name}</p>
                      {a.mask && <p className="text-xs text-gray-400">••• {a.mask}</p>}
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-gray-700">
                      {fmt(parseFloat(String(a.current_balance ?? 0)))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { fmt, fmtCompact, locale, activeCountryCode } = useCurrency();
  const { rates: fxRates } = useForex();
  const today = new Date();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState<BudgetWithActual[]>([]);
  const [longTermBudgets, setLongTermBudgets] = useState<BudgetWithActual[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSnapshots = async () => {
    const res = await listNetWorthSnapshots(365 * 3).catch(() => []);
    setSnapshots(res);
  };

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    // The spend chart compares this month with last month and the emergency
    // cushion averages the last 3 full months, so load everything since the
    // 1st of 3 months ago (a fixed count cut months off)
    const windowStart = new Date(year, month - 4, 1);
    const sinceDate = `${windowStart.getFullYear()}-${String(windowStart.getMonth() + 1).padStart(2, "0")}-01`;

    const [accRes, budRes, ltRes, txRes, propRes, loanRes] = await Promise.allSettled([
      listAccounts(),
      listBudgets(month, year),
      listLongTermBudgets(year),
      listAllTransactions(5000, 0, sinceDate),
      listProperties(),
      listAllLoans(),
    ]);

    if (accRes.status === "fulfilled") setAccounts(accRes.value);
    if (budRes.status === "fulfilled") setMonthlyBudgets(budRes.value);
    if (ltRes.status === "fulfilled") setLongTermBudgets(ltRes.value);
    if (txRes.status === "fulfilled") setTransactions(txRes.value);
    if (propRes.status === "fulfilled") setProperties(propRes.value);
    if (loanRes.status === "fulfilled") setLoans(loanRes.value);

    await fetchSnapshots();
    setLastUpdated(new Date());
    if (!silent) setLoading(false);
    else setRefreshing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial load
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh when the tab regains focus, but only if data is >2 minutes stale
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const staleMs = lastUpdated ? Date.now() - lastUpdated.getTime() : Infinity;
      if (staleMs > 2 * 60 * 1000) fetchAll(true);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [fetchAll, lastUpdated]);

  const handleTakeSnapshot = async () => {
    await takeNetWorthSnapshot();
    await fetchSnapshots();
    setLastUpdated(new Date());
  };

  // ── Net worth calculation ──────────────────────────────────────────────────
  const visibleAccounts = useMemo(
    () => accounts.filter((a) => !a.is_hidden && a.country === activeCountryCode),
    [accounts, activeCountryCode],
  );

  const cash = useMemo(
    () => visibleAccounts
      .filter((a) => a.type === "depository")
      .reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0),
    [visibleAccounts],
  );

  const investments = useMemo(
    () => visibleAccounts
      .filter((a) => ["investment", "brokerage"].includes(a.type) && (a.subtype ?? "").toLowerCase() !== "529")
      .reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0),
    [visibleAccounts],
  );

  const { creditAccounts, totalLiabilities } = useMemo(() => {
    const creditAccounts = visibleAccounts.filter((a) => a.type === "credit");
    const creditCardDebt = creditAccounts.reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0);
    const mortgageDebt = loans.reduce((s, l) => s + parseFloat(l.current_balance ?? "0"), 0);
    return { creditAccounts, totalLiabilities: creditCardDebt + mortgageDebt };
  }, [visibleAccounts, loans]);

  const { visibleProperties, realEstateUSD, reBreakdown } = useMemo(() => {
    // Only count properties for the active country context
    const visibleProperties = properties.filter((p) => p.country === activeCountryCode);
    const realEstateByCurrency: Record<string, number> = {};
    let realEstateUSD = 0;
    for (const p of visibleProperties) {
      const val = parseFloat(p.current_value ?? "0");
      const cur = p.currency_code || "USD";
      realEstateByCurrency[cur] = (realEstateByCurrency[cur] ?? 0) + val;
      realEstateUSD += convertToUSD(val, cur, fxRates);
    }
    const reCurrencies = Object.keys(realEstateByCurrency);
    const reBreakdown = reCurrencies.length > 1
      ? reCurrencies.map((cur) => ({ label: cur, amount: fmtInCurrency(realEstateByCurrency[cur], cur) }))
      : undefined;
    return { visibleProperties, realEstateUSD, reBreakdown };
  }, [properties, activeCountryCode, fxRates, fmtInCurrency]);

  // 529 plans are shown apart from Investments but are still assets you own
  const college529 = useMemo(
    () => visibleAccounts
      .filter((a) => ["investment", "brokerage"].includes(a.type) && (a.subtype ?? "").toLowerCase() === "529")
      .reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0),
    [visibleAccounts],
  );

  // Same formula as the daily snapshot (api/app/services/networth_metrics.py)
  const netWorth = useMemo(
    () => cash + investments + college529 + realEstateUSD - totalLiabilities,
    [cash, investments, college529, realEstateUSD, totalLiabilities],
  );
  const netWorthHint =
    `Net worth = Cash ${fmt(cash)} + Investments ${fmt(investments)}` +
    (college529 > 0 ? ` + 529 plans ${fmt(college529)}` : "") +
    ` + Real estate ${fmt(realEstateUSD)} − Liabilities ${fmt(totalLiabilities)}`;

  // ── Budget stats ───────────────────────────────────────────────────────────
  const monthName = today.toLocaleString(locale, { month: "long" });

  const ICONS = {
    cash: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    invest: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    realestate: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    networth: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    liabilities: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Loading dashboard…
      </div>
    );
  }

  return (
    <CountryGate allowedCountries={["US"]} featureName="Dashboard">
    <div>
      {/* Header */}
      <PageHeader
        title="Dashboard"
        subtitle={today.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        action={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-400 hidden sm:block">
                Updated {lastUpdated.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            <button
              type="button"
              onClick={() => fetchAll(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
      />

      {/* Hero row — Current Spend + Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3">
          <CurrentSpendChart transactions={transactions} />
        </div>
        <div className="lg:col-span-2">
          <AccountsPanel
            accounts={accounts.filter((a) => a.country === activeCountryCode)}
            onSync={() => fetchAll(true)}
            syncing={refreshing}
            lastUpdated={lastUpdated}
          />
        </div>
      </div>

      {/* Net Worth Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <NetWorthCard
          label="Net Worth"
          value={netWorth}
          color={netWorth >= 0 ? "text-gray-900" : "text-red-600"}
          icon={ICONS.networth}
          subtext={college529 > 0
            ? `incl. ${fmt(college529)} in 529 plans`
            : `${visibleAccounts.length} account${visibleAccounts.length !== 1 ? "s" : ""}`}
          accent="indigo"
          hint={netWorthHint}
        />
        <NetWorthCard
          label="Cash & Banking"
          value={cash}
          icon={ICONS.cash}
          subtext={`${visibleAccounts.filter((a) => a.type === "depository").length} account${visibleAccounts.filter((a) => a.type === "depository").length !== 1 ? "s" : ""}`}
          accent="green"
        />
        <NetWorthCard
          label="Investments"
          value={investments}
          icon={ICONS.invest}
          subtext={`${visibleAccounts.filter((a) => ["investment","brokerage"].includes(a.type)).length} account${visibleAccounts.filter((a) => ["investment","brokerage"].includes(a.type)).length !== 1 ? "s" : ""}`}
          accent="blue"
        />
        <NetWorthCard
          label="Real Estate"
          value={realEstateUSD}
          icon={ICONS.realestate}
          subtext={`${visibleProperties.length} propert${visibleProperties.length !== 1 ? "ies" : "y"}`}
          breakdown={reBreakdown}
          accent="amber"
        />
        <NetWorthCard
          label="Liabilities"
          value={totalLiabilities}
          color="text-red-600"
          icon={ICONS.liabilities}
          subtext={`${creditAccounts.length} card${creditAccounts.length !== 1 ? "s" : ""} · ${loans.length} loan${loans.length !== 1 ? "s" : ""}`}
          accent="red"
        />
      </div>

      {/* Net worth change, liquidity and ratios */}
      <div className="mb-6">
        <NetWorthInsights
          accounts={visibleAccounts}
          cash={cash}
          investments={investments + college529}
          realEstate={realEstateUSD}
          liabilities={totalLiabilities}
          netWorth={netWorth}
          snapshots={snapshots}
          transactions={transactions}
          fmt={fmt}
          locale={locale}
        />
      </div>

      {/* Income & Expense Flow */}
      <div className="mt-6">
        <SankeyDashboardSection />
      </div>

      {/* Financial History */}
      <FinancialHistorySection
        snapshots={snapshots}
        onTakeSnapshot={handleTakeSnapshot}
      />

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Monthly Budget Status */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">{monthName} Budgets</h3>
              <p className="text-xs text-gray-400">Monthly spending progress</p>
            </div>
            <Link href="/budgets" className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
              View all →
            </Link>
          </div>
          <MonthlyBudgetSection budgets={monthlyBudgets} />
        </Card>

        {/* Long-term Budgets */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Long-term Budgets</h3>
              <p className="text-xs text-gray-400">Annual, quarterly & custom</p>
            </div>
            <Link href="/budgets" className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
              View all →
            </Link>
          </div>
          <LongTermBudgetSection budgets={longTermBudgets} />
        </Card>

        {/* Recent Transactions */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Recent Transactions</h3>
              <p className="text-xs text-gray-400">Latest activity</p>
            </div>
            <Link href="/transactions" className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
              View all →
            </Link>
          </div>
          <RecentTransactionsSection transactions={transactions} />
        </Card>

        {/* Liabilities */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Liabilities</h3>
              <p className="text-xs text-gray-400">Credit cards & mortgages</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-red-600">{fmt(totalLiabilities)}</p>
              <Link href="/accounts" className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                Manage →
              </Link>
            </div>
          </div>
          <LiabilitiesSection
            creditAccounts={creditAccounts}
            loans={loans}
            properties={properties}
          />
        </Card>

        {/* Quick Links — full width */}
        <Card className="lg:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Quick Links</h3>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { href: "/settings?tab=accounts", label: "Accounts", desc: `${visibleAccounts.length} connected`, emoji: "🏦", bg: "from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/20" },
              { href: "/budgets", label: "Budgets", desc: `${monthlyBudgets.length} this month`, emoji: "📊", bg: "from-emerald-50 to-green-50 dark:from-emerald-900/30 dark:to-green-900/20" },
              { href: "/transactions", label: "Transactions", desc: "View & categorize", emoji: "💳", bg: "from-violet-50 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/20" },
              { href: "/investments", label: "Investments", desc: "Portfolio tracker", emoji: "📈", bg: "from-cyan-50 to-sky-50 dark:from-cyan-900/30 dark:to-sky-900/20" },
              { href: "/properties", label: "Real Estate", desc: `${properties.length} propert${properties.length !== 1 ? "ies" : "y"}`, emoji: "🏠", bg: "from-amber-50 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/20" },
              { href: "/settings", label: "Settings", desc: "Manage your account", emoji: "⚙️", bg: "from-slate-50 to-gray-50 dark:from-slate-700/40 dark:to-gray-700/20" },
            ].map(({ href, label, desc, emoji, bg }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-2 p-3.5 rounded-xl border border-gray-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700 hover:shadow-md transition group bg-white dark:bg-slate-800"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${bg} flex items-center justify-center text-xl leading-none`}>
                  {emoji}
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 group-hover:text-blue-700 dark:group-hover:text-blue-400">{label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </Card>

      </div>
    </div>
    </CountryGate>
  );
}
