"use client";

import { useState } from "react";
import type { RecurringCharge } from "@/lib/insights";

interface Props {
  charges: RecurringCharge[];
  fmt: (value: number) => string;
  locale: string;
  onMerchantClick: (merchant: string) => void;
}

const CADENCE_LABEL: Record<RecurringCharge["cadence"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const COLLAPSED_ROWS = 8;

/** Detected recurring charges with yearly cost, new ones and price increases. */
export default function RecurringPanel({ charges, fmt, locale, onMerchantClick }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (charges.length === 0) return null;

  const yearlyTotal = charges.reduce((s, c) => s + c.yearly, 0);
  const newCount = charges.filter((c) => c.isNew).length;
  const increases = charges.filter((c) => c.priceIncrease);
  const rows = expanded ? charges : charges.slice(0, COLLAPSED_ROWS);
  const day = (d: Date) => d.toLocaleDateString(locale, { month: "short", day: "numeric" });

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Recurring charges</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Detected from repeating charges · {charges.length} active
            {newCount > 0 && <> · <span className="text-sky-600 dark:text-sky-400">{newCount} new</span></>}
            {increases.length > 0 && <> · <span className="text-red-600 dark:text-red-400">{increases.length} price increase{increases.length === 1 ? "" : "s"}</span></>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmt(yearlyTotal)}<span className="text-xs font-normal text-gray-400">/yr</span></p>
          <p className="text-[10px] text-gray-400 tabular-nums">≈ {fmt(yearlyTotal / 12)}/mo</p>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <th className="px-1 pb-2 font-semibold">Merchant</th>
              <th className="px-1 pb-2 font-semibold hidden sm:table-cell">How often</th>
              <th className="px-1 pb-2 font-semibold text-right">Amount</th>
              <th className="px-1 pb-2 font-semibold text-right hidden md:table-cell">Next</th>
              <th className="px-1 pb-2 font-semibold text-right">Per year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-700/60">
            {rows.map((c) => (
              <tr
                key={c.identity}
                onClick={() => onMerchantClick(c.merchant)}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40"
                title="Show this merchant's transactions"
              >
                <td className="px-1 py-2">
                  <span className="font-medium text-gray-700 dark:text-gray-200">{c.merchant}</span>
                  {c.isNew && <span className="ml-1.5 text-[10px] font-semibold text-sky-700 bg-sky-50 dark:bg-sky-900/40 dark:text-sky-300 rounded px-1">New</span>}
                  {c.priceIncrease && c.previous !== null && (
                    <span className="ml-1.5 text-[10px] font-semibold text-red-700 bg-red-50 dark:bg-red-900/40 dark:text-red-300 rounded px-1" title={`Was about ${fmt(c.previous)}`}>
                      ↑ {fmt(c.lastAmount - c.previous)}
                    </span>
                  )}
                </td>
                <td className="px-1 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{CADENCE_LABEL[c.cadence]}</td>
                <td className="px-1 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmt(c.lastAmount)}</td>
                <td className="px-1 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400 hidden md:table-cell">{day(c.nextDate)}</td>
                <td className="px-1 py-2 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmt(c.yearly)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {charges.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
        >
          {expanded ? "Show less" : `Show all ${charges.length}`}
        </button>
      )}
    </div>
  );
}
