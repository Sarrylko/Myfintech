"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { RefreshCw } from "lucide-react";
import {
  listAccounts,
  listBudgets,
  listLongTermBudgets,
  listAllTransactions,
  listProperties,
  listLoans,
  listNetWorthSnapshots,
  takeNetWorthSnapshot,
  Account,
  BudgetWithActual,
  Transaction,
  Property,
  Loan,
  NetWorthSnapshot,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { useCurrency } from "@/lib/currency";
import { useForex } from "@/components/ForexProvider";
import { convertToUSD, fmtInCurrency } from "@/lib/forex";

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

// ─── Spend timeline helper ────────────────────────────────────────────────────

function buildSpendTimeline(transactions: Transaction[]) {
  const now = new Date();
  const thisYear = now.getFullYear(), thisMonth = now.getMonth();
  const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
  const lastYear = lastMonthDate.getFullYear(), lastMonth = lastMonthDate.getMonth();
  const daysInThis = new Date(thisYear, thisMonth + 1, 0).getDate();
  const daysInLast = new Date(lastYear, lastMonth + 1, 0).getDate();

  const thisMap: Record<number, number> = {};
  const lastMap: Record<number, number> = {};

  for (const t of transactions) {
    const amt = parseFloat(t.amount);
    if (amt <= 0 || t.is_ignored || t.pending) continue;
    const cat = (t.plaid_category ?? "").toLowerCase();
    if (cat.startsWith("transfer")) continue;
    const d = new Date(t.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth)
      thisMap[d.getDate()] = (thisMap[d.getDate()] || 0) + amt;
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth)
      lastMap[d.getDate()] = (lastMap[d.getDate()] || 0) + amt;
  }

  const maxDays = Math.max(daysInThis, daysInLast);
  const todayDay = now.getDate();
  let cumThis = 0, cumLast = 0;
  return Array.from({ length: maxDays }, (_, i) => {
    const day = i + 1;
    cumThis += thisMap[day] || 0;
    cumLast += lastMap[day] || 0;
    return {
      day,
      thisMonth: day <= todayDay ? parseFloat(cumThis.toFixed(2)) : null,
      lastMonth: day <= daysInLast ? parseFloat(cumLast.toFixed(2)) : null,
    };
  });
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
}: {
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
    <div className={`rounded-xl border p-4 ${cardStyles[accent]}`}>
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

// ─── Financial History Chart ──────────────────────────────────────────────────

type TimeRange = "30D" | "90D" | "1Y" | "All";

const METRICS = [
  { key: "net_worth",        label: "Net Worth",    color: "#6366f1" },
  { key: "total_cash",       label: "Cash",         color: "#22c55e" },
  { key: "total_investments",label: "Investments",  color: "#3b82f6" },
  { key: "total_real_estate",label: "Real Estate",  color: "#f59e0b" },
  { key: "total_debts",      label: "Liabilities",  color: "#ef4444" },
] as const;

function HistoryTooltip({ active, payload, label }: { active?: boolean; payload?: {name: string; value: number; color: string}[]; label?: string }) {
  const { fmtCompact } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl shadow-xl p-3.5 text-xs min-w-[170px]">
      <p className="text-gray-400 dark:text-gray-500 font-medium mb-2.5 pb-2 border-b border-gray-50 dark:border-slate-700">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between items-center gap-4 mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-600 dark:text-gray-400">{entry.name}</span>
          </div>
          <span className="font-bold text-gray-900 dark:text-white tabular-nums">{fmtCompact(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function FinancialHistorySection({
  snapshots,
  onTakeSnapshot,
}: {
  snapshots: NetWorthSnapshot[];
  onTakeSnapshot: () => Promise<void>;
}) {
  const { fmtCompact, locale } = useCurrency();
  const [timeRange, setTimeRange] = useState<TimeRange>("90D");
  const [visible, setVisible] = useState<Set<string>>(new Set(["net_worth", "total_debts"]));
  const [saving, setSaving] = useState(false);

  const rangeDays: Record<TimeRange, number> = { "30D": 30, "90D": 90, "1Y": 365, "All": 99999 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays[timeRange]);

  const filtered = snapshots
    .filter((s) => new Date(s.snapshot_date) >= cutoff)
    .map((s) => ({
      date: new Date(s.snapshot_date.substring(0, 10) + "T00:00:00").toLocaleDateString(locale, { month: "short", day: "numeric" }),
      net_worth:         parseFloat(s.net_worth),
      total_cash:        parseFloat(s.total_cash),
      total_investments: parseFloat(s.total_investments),
      total_real_estate: parseFloat(s.total_real_estate),
      total_debts:       parseFloat(s.total_debts),
    }));

  function toggleMetric(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }

  async function handleSnapshot() {
    setSaving(true);
    try { await onTakeSnapshot(); } finally { setSaving(false); }
  }

  return (
    <Card className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Financial History</h3>
          <p className="text-xs text-gray-400">Daily snapshots of your key metrics</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Time range tabs */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
            {(["30D", "90D", "1Y", "All"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  timeRange === r
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {/* Take Snapshot button */}
          <button
            onClick={handleSnapshot}
            disabled={saving}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Take Snapshot"}
          </button>
        </div>
      </div>

      {/* Metric toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {METRICS.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => toggleMetric(key)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition ${
              visible.has(key)
                ? "border-transparent text-white"
                : "border-gray-200 text-gray-400 bg-white"
            }`}
            style={visible.has(key) ? { backgroundColor: color } : undefined}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: visible.has(key) ? "white" : color }}
            />
            {label}
          </button>
        ))}
      </div>

      {/* Chart */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <p className="text-gray-400 text-sm mb-3">No historical data yet</p>
          <p className="text-gray-400 text-xs">
            Click <span className="font-medium text-blue-600">Take Snapshot</span> to start tracking.
            After that, the daily task captures data automatically at 7 AM UTC.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={filtered} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <defs>
              {METRICS.map(({ key, color }) => (
                <linearGradient key={key} id={`grad-hist-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.12} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={fmtCompact}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip content={<HistoryTooltip />} />
            {METRICS.filter(({ key }) => visible.has(key)).map(({ key, label, color }) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={2.5}
                fill={`url(#grad-hist-${key})`}
                dot={filtered.length <= 30}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

// ─── Current Spend Chart ──────────────────────────────────────────────────────

function CurrentSpendChart({ transactions }: { transactions: Transaction[] }) {
  const { fmt, locale } = useCurrency();
  const now = new Date();
  const data = buildSpendTimeline(transactions);
  const thisMonthSpend = data[data.length - 1]?.thisMonth ?? 0;
  const lastMonthByToday = data[now.getDate() - 1]?.lastMonth ?? 0;
  const diff = thisMonthSpend - lastMonthByToday;
  const monthName = now.toLocaleString(locale, { month: "long" });
  const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString(locale, { month: "long" });

  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean; payload?: { value: number | null; name: string; color: string }[]; label?: number;
  }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="text-gray-500 mb-1">Day {label}</p>
        {payload.map((p) => p.value != null && (
          <p key={p.name} className={`font-medium ${p.name === "thisMonth" ? "text-blue-500" : "text-slate-400"}`}>
            {p.name === "thisMonth" ? monthName : lastMonthName}: {fmt(p.value)}
          </p>
        ))}
        {payload[0]?.value != null && payload[1]?.value != null && (
          <p className="text-gray-400 mt-1 border-t border-gray-100 pt-1">
            Δ {fmt(payload[0].value - payload[1].value)}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card className="flex flex-col h-full">
      {/* Header row */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Current Spend</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white tabular-nums">
            {fmt(thisMonthSpend)}
          </p>
          {thisMonthSpend === 0 && (
            <p className="text-xs text-gray-400 mt-1">No transactions recorded for {monthName} yet</p>
          )}
        </div>
        {thisMonthSpend > 0 && diff !== 0 && lastMonthByToday > 0 && (
          <div className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full ${
            diff > 0 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
          }`}>
            <span>{diff > 0 ? "▲" : "▼"}</span>
            <span>{fmt(Math.abs(diff))} {diff > 0 ? "more" : "less"} than {lastMonthName}</span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="relative flex-1 min-h-0 mt-4 h-40">
        {thisMonthSpend === 0 && (
          <div className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none z-10">
            <p className="text-xs text-gray-300 bg-white/90 px-2 py-1 rounded">
              Sync accounts to see {monthName} spend
            </p>
          </div>
        )}
        {data.every((d) => !d.thisMonth && !d.lastMonth) ? (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            No transaction data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradThis" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradLast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.08} />
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                ticks={[1, 8, 16, 24]}
                tickFormatter={(d) => `${d}`}
              />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#e5e7eb", strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="lastMonth"
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="url(#gradLast)"
                dot={false}
                connectNulls
                name="lastMonth"
              />
              <Area
                type="monotone"
                dataKey="thisMonth"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#gradThis)"
                dot={false}
                connectNulls
                name="thisMonth"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-blue-500 rounded" />
          <span className="text-xs text-gray-500">{monthName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="2" className="overflow-visible"><line x1="0" y1="1" x2="20" y2="1" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          <span className="text-xs text-gray-500">{lastMonthName}</span>
        </div>
      </div>
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
  const investAccs   = vis.filter((a) => ["investment", "brokerage"].includes(a.type));

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
  const { fmt, fmtCompact, locale, currency } = useCurrency();
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

    const [accRes, budRes, ltRes, txRes, propRes] = await Promise.allSettled([
      listAccounts(),
      listBudgets(month, year),
      listLongTermBudgets(year),
      listAllTransactions(500),
      listProperties(),
    ]);

    if (accRes.status === "fulfilled") setAccounts(accRes.value);
    if (budRes.status === "fulfilled") setMonthlyBudgets(budRes.value);
    if (ltRes.status === "fulfilled") setLongTermBudgets(ltRes.value);
    if (txRes.status === "fulfilled") setTransactions(txRes.value);

    if (propRes.status === "fulfilled") {
      const props = propRes.value;
      setProperties(props);
      const loanResults = await Promise.allSettled(props.map((p) => listLoans(p.id)));
      setLoans(loanResults.flatMap((r) => r.status === "fulfilled" ? r.value : []));
    }

    await fetchSnapshots();
    setLastUpdated(new Date());
    if (!silent) setLoading(false);
    else setRefreshing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial load
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh when the tab regains focus (e.g. user returns from accounts/budgets page)
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") fetchAll(true);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [fetchAll]);

  const handleTakeSnapshot = async () => {
    await takeNetWorthSnapshot();
    await fetchSnapshots();
    setLastUpdated(new Date());
  };

  // ── Net worth calculation ──────────────────────────────────────────────────
  const visibleAccounts = accounts.filter((a) => !a.is_hidden);

  const cash = visibleAccounts
    .filter((a) => a.type === "depository")
    .reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0);

  const investments = visibleAccounts
    .filter((a) => ["investment", "brokerage"].includes(a.type))
    .reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0);

  const creditAccounts = visibleAccounts.filter((a) => a.type === "credit");
  const creditCardDebt = creditAccounts.reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0);
  const mortgageDebt = loans.reduce((s, l) => s + parseFloat(l.current_balance ?? "0"), 0);
  const totalLiabilities = creditCardDebt + mortgageDebt;

  // Group properties by currency and convert to USD using live FX rates
  const realEstateByCurrency: Record<string, number> = {};
  let realEstateUSD = 0;
  for (const p of properties) {
    const val = parseFloat(p.current_value ?? "0");
    const cur = p.currency_code || "USD";
    realEstateByCurrency[cur] = (realEstateByCurrency[cur] ?? 0) + val;
    realEstateUSD += convertToUSD(val, cur, fxRates);
  }
  const reCurrencies = Object.keys(realEstateByCurrency);
  // Show breakdown when any property currency differs from household currency
  const reBreakdown = reCurrencies.some((cur) => cur !== currency)
    ? reCurrencies.map((cur) => ({
        label: cur,
        amount: fmtInCurrency(realEstateByCurrency[cur], cur),
      }))
    : undefined;

  const netWorth = cash + investments + realEstateUSD - totalLiabilities;

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
            accounts={accounts}
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
          subtext={`${visibleAccounts.length} account${visibleAccounts.length !== 1 ? "s" : ""}`}
          accent="indigo"
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
          subtext={`${properties.length} propert${properties.length !== 1 ? "ies" : "y"}`}
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
  );
}
