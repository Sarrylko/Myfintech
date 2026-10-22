"use client";

import React, { useState } from "react";
import type { TaxOpportunitiesResponse, TaxOpportunity, TaxScope } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { ConfidenceDot, daysUntil, fmtDay, num, ScopeBadge } from "./shared";

type Filter = "all" | TaxScope;

export default function OpportunitiesTab({ opps, onStatus, onTry }: {
  opps: TaxOpportunitiesResponse | null;
  onStatus: (id: string, status: TaxOpportunity["status"]) => void;
  onTry: (scenario: Record<string, number>) => void;
}) {
  const { fmt } = useCurrency();
  const [filter, setFilter] = useState<Filter>("all");
  const [showClosed, setShowClosed] = useState(false);

  if (!opps) return <p className="text-sm text-gray-400 text-center py-10">Loading opportunities…</p>;

  const list = opps.opportunities.filter((o) => filter === "all" || o.scope === filter);
  const open = list.filter((o) => o.status === "open");
  const closed = list.filter((o) => o.status !== "open");
  const counts = (s: Filter) => opps.opportunities.filter((o) => o.status === "open" && (s === "all" || o.scope === s)).length;

  const card = (o: TaxOpportunity) => {
    const urgent = o.deadline && daysUntil(o.deadline) <= 30 && daysUntil(o.deadline) >= 0;
    return (
      <div key={o.id} className={`bg-white rounded-xl border shadow-sm p-5 ${o.status !== "open" ? "opacity-60 border-gray-100" : "border-gray-100"}`}>
        <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ScopeBadge scope={o.scope} />
              <h3 className="text-sm font-semibold text-gray-900">{o.title}</h3>
              <ConfidenceDot level={o.confidence} />
              {o.status !== "open" && (
                <span className="text-[10px] uppercase font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{o.status}</span>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-2">{o.why}</p>
            <p className="text-sm text-gray-800 mt-2"><span className="font-semibold">Do: </span>{o.action}</p>
          </div>
          <div className="md:text-right shrink-0 md:w-44">
            {o.est_savings ? (
              <>
                <p className="text-[11px] text-gray-500 uppercase tracking-wide">Est. savings</p>
                <p className="text-xl font-bold text-emerald-600 tabular-nums">{fmt(num(o.est_savings))}</p>
              </>
            ) : o.tax_cost ? (
              <>
                <p className="text-[11px] text-gray-500 uppercase tracking-wide">Tax now</p>
                <p className="text-xl font-bold text-gray-700 tabular-nums">{fmt(num(o.tax_cost))}</p>
                <p className="text-[11px] text-gray-400">for tax-free growth later</p>
              </>
            ) : (
              <p className="text-xs text-gray-400">Not priced</p>
            )}
            {o.deadline && (
              <p className={`text-xs mt-1 ${urgent ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                Deadline {fmtDay(o.deadline)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {o.scenario && o.status === "open" && (
            <button type="button" onClick={() => onTry(o.scenario!)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              Try in What-if
            </button>
          )}
          {o.status === "open" ? (
            <>
              <button type="button" onClick={() => onStatus(o.id, "done")}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                Mark done
              </button>
              <button type="button" onClick={() => onStatus(o.id, "dismissed")}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                Not for me
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onStatus(o.id, "open")}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              Reopen
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {(["all", "personal", "business", "rental"] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition ${filter === f ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              {f} <span className="text-gray-400">{counts(f)}</span>
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">
          Open opportunities: <span className="font-bold text-emerald-600">{fmt(num(opps.total_est_savings))}</span> estimated savings
        </p>
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-6 text-center">Nothing open here.</p>
      ) : open.map(card)}

      {closed.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowClosed((v) => !v)} className="text-xs text-gray-500 hover:text-gray-700">
            {showClosed ? "Hide" : "Show"} {closed.length} done / dismissed
          </button>
          {showClosed && <div className="space-y-4 mt-3">{closed.map(card)}</div>}
        </div>
      )}

      <p className="text-xs text-gray-400">
        Savings are computed by re-running your projection with each move applied (federal + state). They&apos;re planning
        estimates — eligibility rules and your full situation matter, so review moves with your tax preparer.
      </p>
    </div>
  );
}
