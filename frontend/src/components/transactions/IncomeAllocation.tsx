"use client";

interface Props {
  income: number;
  spending: number;
  /** Net contributions to savings/investment categories */
  contributions: number;
  /** Estimated loan principal paid */
  principal: number;
  fmt: (value: number) => string;
}

/** One stacked bar: where this period's income went. */
export default function IncomeAllocation({ income, spending, contributions, principal, fmt }: Props) {
  if (income <= 0 && spending <= 0) return null;

  const remainder = income - spending - contributions - principal;
  const segments = [
    { key: "spending", label: "Spending", value: spending, color: "bg-rose-500" },
    { key: "saved", label: "Saved & invested", value: Math.max(0, contributions), color: "bg-violet-500" },
    { key: "principal", label: "Loan principal", value: principal, color: "bg-indigo-400" },
    { key: "kept", label: "Kept as cash", value: Math.max(0, remainder), color: "bg-emerald-500" },
  ].filter((seg) => seg.value > 0.5);
  // Scale to whichever is larger, so overspending shows the bar running past income
  const scale = Math.max(income, segments.reduce((sum, seg) => sum + seg.value, 0)) || 1;
  const pctOfIncome = (v: number) => (income > 0 ? `${Math.round((v / income) * 100)}%` : "");

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-4 mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Where your income went</p>
        <p className="text-xs text-gray-400 tabular-nums">{fmt(income)} income</p>
      </div>

      <div className="relative h-3 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden flex">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={`${seg.color} h-full first:rounded-l-full last:rounded-r-full`}
            style={{ width: `${(seg.value / scale) * 100}%` }}
            title={`${seg.label}: ${fmt(seg.value)} ${pctOfIncome(seg.value)}`}
          />
        ))}
        {income > 0 && income < scale && (
          // Marks where income ran out
          <div className="absolute top-0 bottom-0 w-0.5 bg-gray-900 dark:bg-white" style={{ left: `${(income / scale) * 100}%` }} />
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
        {segments.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className={`w-2.5 h-2.5 rounded-sm ${seg.color}`} />
            {seg.label}
            <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{fmt(seg.value)}</span>
            <span className="text-gray-400 tabular-nums">{pctOfIncome(seg.value)}</span>
          </span>
        ))}
        {remainder < -0.5 && (
          <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-gray-900 dark:bg-white" />
            Drew <span className="font-semibold tabular-nums">{fmt(-remainder)}</span> from cash or savings
          </span>
        )}
      </div>
    </div>
  );
}
