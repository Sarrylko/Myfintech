"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToken(): string {
  return localStorage.getItem("access_token") ?? "";
}

function fmt(value: number, showSign = false): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
  if (showSign && value < 0) return `-${formatted}`;
  return formatted;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatBudgetPeriodShort(b: BudgetWithActual): string {
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
}: {
  label: string;
  value: number;
  subtext?: string;
  color?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-gray-400">{icon}</span>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{fmt(value)}</p>
      {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
    </div>
  );
}

function MiniProgressBar({ pct, alertThreshold }: { pct: number; alertThreshold: number }) {
  const clamped = Math.min(pct, 100);
  let color = "bg-green-500";
  if (pct >= 100) color = "bg-red-500";
  else if (pct >= alertThreshold) color = "bg-yellow-400";
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

// ─── Budget Status Card ───────────────────────────────────────────────────────

function MonthlyBudgetSection({ budgets }: { budgets: BudgetWithActual[] }) {
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

  const totalBudgeted = budgets.reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalSpent = budgets.reduce((s, b) => s + parseFloat(b.actual_spent), 0);
  const overCount = budgets.filter((b) => parseFloat(b.remaining) < 0).length;
  const overallPct = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0;

  // Top 5 by spending percentage
  const top5 = [...budgets]
    .filter((b) => !b.category.is_income)
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
                <span className="text-xs text-gray-400 shrink-0">{formatBudgetPeriodShort(b)}</span>
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

function RecentTransactionsSection({ transactions }: { transactions: Transaction[] }) {
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
    <div className="divide-y divide-gray-50">
      {transactions.slice(0, 8).map((t) => {
        const amount = parseFloat(t.amount);
        const isIncome = amount < 0;
        return (
          <div key={t.id} className="flex items-center justify-between py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800 font-medium truncate">
                {t.merchant_name ?? t.name}
              </p>
              <p className="text-xs text-gray-400">{fmtDate(t.date)}</p>
            </div>
            <span className={`text-sm font-semibold ml-3 shrink-0 ${isIncome ? "text-green-600" : "text-gray-800"}`}>
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

function fmtAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function HistoryTooltip({ active, payload, label }: { active?: boolean; payload?: {name: string; value: number; color: string}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg p-3 text-xs min-w-[160px]">
      <p className="text-gray-500 font-medium mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4 mb-0.5">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-semibold text-gray-800">{fmtAxis(entry.value)}</span>
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
  const [timeRange, setTimeRange] = useState<TimeRange>("90D");
  const [visible, setVisible] = useState<Set<string>>(new Set(["net_worth", "total_debts"]));
  const [saving, setSaving] = useState(false);

  const rangeDays: Record<TimeRange, number> = { "30D": 30, "90D": 90, "1Y": 365, "All": 99999 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays[timeRange]);

  const filtered = snapshots
    .filter((s) => new Date(s.snapshot_date) >= cutoff)
    .map((s) => ({
      date: fmtDate(s.snapshot_date.substring(0, 10)),
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
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">Financial History</h3>
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
          <LineChart data={filtered} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={fmtAxis}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip content={<HistoryTooltip />} />
            {METRICS.filter(({ key }) => visible.has(key)).map(({ key, label, color }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={2}
                dot={filtered.length <= 30}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const today = new Date();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState<BudgetWithActual[]>([]);
  const [longTermBudgets, setLongTermBudgets] = useState<BudgetWithActual[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSnapshots = async (token: string) => {
    const res = await listNetWorthSnapshots(365 * 3, token).catch(() => []);
    setSnapshots(res);
  };

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    async function fetchAll() {
      const month = today.getMonth() + 1;
      const year = today.getFullYear();

      const [accRes, budRes, ltRes, txRes, propRes] = await Promise.allSettled([
        listAccounts(token),
        listBudgets(month, year, token),
        listLongTermBudgets(year, token),
        listAllTransactions(token, 10),
        listProperties(token),
      ]);

      if (accRes.status === "fulfilled") setAccounts(accRes.value);
      if (budRes.status === "fulfilled") setMonthlyBudgets(budRes.value);
      if (ltRes.status === "fulfilled") setLongTermBudgets(ltRes.value);
      if (txRes.status === "fulfilled") setTransactions(txRes.value);

      if (propRes.status === "fulfilled") {
        const props = propRes.value;
        setProperties(props);
        const loanResults = await Promise.allSettled(props.map((p) => listLoans(p.id, token)));
        setLoans(loanResults.flatMap((r) => r.status === "fulfilled" ? r.value : []));
      }

      await fetchSnapshots(token);
      setLoading(false);
    }

    fetchAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTakeSnapshot = async () => {
    const token = getToken();
    await takeNetWorthSnapshot(token);
    await fetchSnapshots(token);
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

  // Keep existing liabilities var for net worth (account-based, avoids double-counting linked loans)
  const accountLiabilities = visibleAccounts
    .filter((a) => ["credit", "loan"].includes(a.type))
    .reduce((s, a) => s + parseFloat(a.current_balance ?? "0"), 0);

  const realEstate = properties
    .reduce((s, p) => s + parseFloat(p.current_value ?? "0"), 0);

  const netWorth = cash + investments + realEstate - accountLiabilities;

  // ── Budget stats ───────────────────────────────────────────────────────────
  const monthName = today.toLocaleString("en-US", { month: "long" });

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
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
        />
        <NetWorthCard
          label="Cash & Banking"
          value={cash}
          icon={ICONS.cash}
          subtext={`${visibleAccounts.filter((a) => a.type === "depository").length} account${visibleAccounts.filter((a) => a.type === "depository").length !== 1 ? "s" : ""}`}
        />
        <NetWorthCard
          label="Investments"
          value={investments}
          icon={ICONS.invest}
          subtext={`${visibleAccounts.filter((a) => ["investment","brokerage"].includes(a.type)).length} account${visibleAccounts.filter((a) => ["investment","brokerage"].includes(a.type)).length !== 1 ? "s" : ""}`}
        />
        <NetWorthCard
          label="Real Estate"
          value={realEstate}
          icon={ICONS.realestate}
          subtext={`${properties.length} propert${properties.length !== 1 ? "ies" : "y"}`}
        />
        <NetWorthCard
          label="Liabilities"
          value={totalLiabilities}
          color="text-red-600"
          icon={ICONS.liabilities}
          subtext={`${creditAccounts.length} card${creditAccounts.length !== 1 ? "s" : ""} · ${loans.length} loan${loans.length !== 1 ? "s" : ""}`}
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
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">{monthName} Budgets</h3>
              <p className="text-xs text-gray-400">Monthly spending progress</p>
            </div>
            <Link href="/budgets" className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline">
              View all →
            </Link>
          </div>
          <MonthlyBudgetSection budgets={monthlyBudgets} />
        </div>

        {/* Long-term Budgets */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">Long-term Budgets</h3>
              <p className="text-xs text-gray-400">Annual, quarterly & custom</p>
            </div>
            <Link href="/budgets" className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline">
              View all →
            </Link>
          </div>
          <LongTermBudgetSection budgets={longTermBudgets} />
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">Recent Transactions</h3>
              <p className="text-xs text-gray-400">Latest activity</p>
            </div>
            <Link href="/transactions" className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline">
              View all →
            </Link>
          </div>
          <RecentTransactionsSection transactions={transactions} />
        </div>

        {/* Liabilities */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">Liabilities</h3>
              <p className="text-xs text-gray-400">Credit cards & mortgages</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-red-600">{fmt(totalLiabilities)}</p>
              <Link href="/accounts" className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline">
                Manage →
              </Link>
            </div>
          </div>
          <LiabilitiesSection
            creditAccounts={creditAccounts}
            loans={loans}
            properties={properties}
          />
        </div>

        {/* Quick Links — full width */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 mb-4">Quick Links</h3>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { href: "/accounts", label: "Accounts", desc: `${visibleAccounts.length} connected`, emoji: "🏦" },
              { href: "/budgets", label: "Budgets", desc: `${monthlyBudgets.length} this month`, emoji: "📊" },
              { href: "/transactions", label: "Transactions", desc: "View & categorize", emoji: "💳" },
              { href: "/investments", label: "Investments", desc: "Portfolio tracker", emoji: "📈" },
              { href: "/properties", label: "Real Estate", desc: `${properties.length} propert${properties.length !== 1 ? "ies" : "y"}`, emoji: "🏠" },
              { href: "/settings", label: "Settings", desc: "Manage your account", emoji: "⚙️" },
            ].map(({ href, label, desc, emoji }) => (
              <Link
                key={href}
                href={href}
                className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/40 transition group"
              >
                <span className="text-xl leading-none mt-0.5">{emoji}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800 group-hover:text-blue-700">{label}</p>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
