"use client";

import React from "react";
import type { TaxOpportunity, TaxProjectionResponse } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import type { TaxTab } from "./OverviewTab";
import { CLASS_LABEL, Line, num, Panel, pct } from "./shared";

export default function BusinessTab({ data, opportunities, onNavigate }: {
  data: TaxProjectionResponse;
  opportunities: TaxOpportunity[];
  onNavigate: (tab: TaxTab) => void;
}) {
  const { fmt } = useCurrency();
  const m = (v: string | number) => fmt(num(v));
  const signed = (v: number) => (v < 0 ? `−${fmt(Math.abs(v))}` : fmt(v));
  const rows = new Map(data.projection.businesses.map((r) => [r.id, r]));
  const businesses = data.context.businesses;
  const frac = data.context.sources.year_fraction;

  if (businesses.length === 0) {
    return (
      <Panel title="No business activity found">
        <p className="text-sm text-gray-600">
          Business income comes from transactions on accounts linked to a business entity (or marked as business
          accounts). Link your business checking and cards to an entity on the Business page, then set how each
          entity is taxed on the{" "}
          <button type="button" className="text-indigo-600 underline" onClick={() => onNavigate("inputs")}>Inputs</button> tab.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      {businesses.map((b) => {
        const row = rows.get(b.id);
        const opps = opportunities.filter((o) => o.id.endsWith(`:${b.id}`) && o.status === "open");
        const net = num(b.projected_income) - num(b.projected_expenses);
        const topExpenses = b.expense_categories.slice(0, 6);
        const maxExpense = Math.max(1, ...topExpenses.map((e) => num(e.amount)));
        return (
          <Panel
            key={b.id}
            title={b.name}
            note={
              <>
                {CLASS_LABEL[b.classification] ?? b.classification}
                {b.classification_derived && <span className="text-amber-600"> (assumed — confirm on Inputs)</span>}
                {b.owner_share < 1 && <> · household owns {pct(b.owner_share, 0)}</>}
              </>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Profit & loss {frac < 1 ? "(projected full year)" : ""}</p>
                <Line label="Income" value={m(b.projected_income)} hint={frac < 1 ? `${m(b.income_ytd)} so far` : undefined} />
                <Line label="Expenses" value={`−${m(b.projected_expenses)}`} hint={frac < 1 ? `${m(b.expenses_ytd)} so far` : undefined} />
                {row && num(row.home_office) > 0 && <Line label="Home office" value={`−${m(row.home_office)}`} />}
                <Line label="Net profit" value={signed(net - num(row?.home_office ?? 0))} strong />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Tax impact</p>
                {row ? (
                  <>
                    <Line label="Flows to your return" value={signed(num(row.household_income))} />
                    <Line label="Self-employment tax" value={m(row.se_tax)} muted={num(row.se_tax) === 0} />
                    <Line label="QBI income" value={signed(num(row.qbi_income))} muted={num(row.qbi_income) === 0} />
                  </>
                ) : (
                  <p className="text-xs text-gray-400">C-corps are taxed separately; only salary and dividends reach you.</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Largest expense categories</p>
                {topExpenses.length === 0 ? (
                  <p className="text-xs text-gray-400">No expenses booked.</p>
                ) : topExpenses.map((e) => (
                  <div key={e.category} className="mb-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600 truncate">{e.category}</span>
                      <span className="tabular-nums text-gray-800">{m(e.amount)}</span>
                    </div>
                    <div className="h-1 bg-gray-100 rounded">
                      <div className="h-1 bg-amber-400 rounded" style={{ width: `${(num(e.amount) / maxExpense) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {opps.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-2">Opportunities for this business</p>
                <div className="flex flex-wrap gap-2">
                  {opps.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => onNavigate("opportunities")}
                      className="text-xs px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                    >
                      {o.title.split(" — ")[0]}
                      {o.est_savings && <span className="font-semibold"> · ~{fmt(num(o.est_savings))}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        );
      })}
      <p className="text-xs text-gray-400">
        Transfers, loan payments, tax payments and rental income/expenses on business accounts are left out of the
        P&amp;L (rentals are on the Rentals tab). Categorize business transactions accurately — they drive this view.
      </p>
    </div>
  );
}
