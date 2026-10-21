"use client";

import type { UnusualCharge } from "@/lib/insights";

interface Props {
  fixed: number;
  flexible: number;
  unlabeled: { amount: number; count: number };
  totalSpending: number;
  unusual: UnusualCharge[];
  fmt: (value: number) => string;
  fmtDate: (value: string) => string;
  onReviewUnlabeled: () => void;
  onMerchantClick: (merchant: string) => void;
  merchantLabel: (t: UnusualCharge["txn"]) => string;
}

const CARD = "bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-4";

export default function InsightCards({
  fixed, flexible, unlabeled, totalSpending, unusual, fmt, fmtDate, onReviewUnlabeled, onMerchantClick, merchantLabel,
}: Props) {
  if (totalSpending <= 0) return null;
  const fixedPct = Math.round((fixed / totalSpending) * 100);
  const unlabeledPct = Math.round((unlabeled.amount / totalSpending) * 100);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      {/* Fixed vs flexible */}
      <div className={CARD}>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Fixed vs flexible</p>
        <p className="text-xs text-gray-400 mt-0.5 mb-3">Commitments vs spending you control</p>
        <div className="h-2.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden flex">
          <div className="bg-slate-500 h-full" style={{ width: `${fixedPct}%` }} />
          <div className="bg-amber-400 h-full" style={{ width: `${100 - fixedPct}%` }} />
        </div>
        <div className="flex justify-between mt-2.5 text-xs">
          <span className="text-gray-600 dark:text-gray-300" title="Housing, utilities, insurance, loan interest, childcare & activities, subscriptions, taxes and detected recurring charges">
            <span className="inline-block w-2 h-2 rounded-sm bg-slate-500 mr-1.5" />
            Fixed <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{fmt(fixed)}</span>
            <span className="text-gray-400 ml-1">{fixedPct}%</span>
          </span>
          <span className="text-gray-600 dark:text-gray-300">
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1.5" />
            Flexible <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{fmt(flexible)}</span>
            <span className="text-gray-400 ml-1">{100 - fixedPct}%</span>
          </span>
        </div>
      </div>

      {/* Needs a label */}
      <div className={CARD}>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Needs a label</p>
        <p className="text-xs text-gray-400 mt-0.5 mb-3">Uncategorized spending and cash withdrawals</p>
        {unlabeled.count === 0 ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">Everything is categorized ✓</p>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className={`text-xl font-bold tabular-nums ${unlabeledPct >= 5 ? "text-amber-600 dark:text-amber-400" : "text-gray-800 dark:text-gray-100"}`}>
                {fmt(unlabeled.amount)}
              </p>
              <p className="text-xs text-gray-400">{unlabeledPct}% of spending · {unlabeled.count} transaction{unlabeled.count === 1 ? "" : "s"}</p>
            </div>
            <button
              type="button"
              onClick={onReviewUnlabeled}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              Review
            </button>
          </div>
        )}
      </div>

      {/* Unusual charges */}
      <div className={CARD}>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Worth a look</p>
        <p className="text-xs text-gray-400 mt-0.5 mb-2">1.5× the usual amount, or a first-time merchant over {fmt(200)}</p>
        {unusual.length === 0 ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">Nothing unusual this period ✓</p>
        ) : (
          <ul className="space-y-1.5">
            {unusual.slice(0, 4).map((u) => (
              <li key={u.txn.id}>
                <button
                  type="button"
                  onClick={() => onMerchantClick(merchantLabel(u.txn))}
                  title="Show this merchant's transactions"
                  className="w-full flex items-baseline justify-between gap-2 text-left rounded-md -mx-1 px-1 hover:bg-gray-50 dark:hover:bg-slate-700/40"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{merchantLabel(u.txn)}</span>
                    <span className="block text-[10px] text-gray-400">
                      {fmtDate(u.txn.date)} · {u.reason === "new-merchant" ? "first time" : `usually ${fmt(u.usual ?? 0)} (${(u.amount / (u.usual || 1)).toFixed(1)}×)`}
                    </span>
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-100 shrink-0">{fmt(u.amount)}</span>
                </button>
              </li>
            ))}
            {unusual.length > 4 && <li className="text-[10px] text-gray-400">+{unusual.length - 4} more</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
