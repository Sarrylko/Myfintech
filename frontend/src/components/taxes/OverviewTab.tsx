"use client";

import React from "react";
import type { TaxOpportunitiesResponse, TaxProjectionResponse } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { ConfidenceDot, daysUntil, FILING_LABEL, fmtDay, Kpi, num, Panel, pct, ScopeBadge } from "./shared";

export type TaxTab = "overview" | "personal" | "business" | "rentals" | "opportunities" | "whatif" | "inputs"
  | "documents" | "picture";

const BRACKET_COLORS = ["#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3"];

function BracketBar({ data }: { data: TaxProjectionResponse["projection"] }) {
  const { fmt, fmtCompact } = useCurrency();
  const income = num(data.bracket.ordinary_taxable);
  const brackets = data.bracket.brackets.map((b, i, all) => ({
    rate: b.rate,
    floor: i === 0 ? 0 : num(all[i - 1].ceiling),
    ceiling: b.ceiling == null ? null : num(b.ceiling),
  }));
  const current = brackets.findIndex((b) => b.ceiling == null || income < b.ceiling);
  // Show through the bracket above the current one
  const shownTop = brackets[Math.min(current + 1, brackets.length - 1)];
  const max = Math.max(shownTop.ceiling ?? shownTop.floor * 1.3, income * 1.1, 1);
  const shown = brackets.filter((b) => b.floor < max);
  const room = data.bracket.room == null ? null : num(data.bracket.room);

  return (
    <div>
      <div className="relative h-9 rounded-lg overflow-hidden flex">
        {shown.map((b, i) => {
          const width = ((Math.min(b.ceiling ?? max, max) - b.floor) / max) * 100;
          return (
            <div
              key={b.rate}
              className="h-full flex items-center justify-center text-[11px] font-semibold text-indigo-950/80 border-r border-white/70 last:border-r-0"
              style={{ width: `${width}%`, background: BRACKET_COLORS[i] ?? BRACKET_COLORS[6] }}
              title={`${pct(b.rate, 0)}: ${fmt(b.floor)} – ${b.ceiling ? fmt(b.ceiling) : "and up"}`}
            >
              {width > 6 ? pct(b.rate, 0) : ""}
            </div>
          );
        })}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-gray-900"
          style={{ left: `${Math.min(99.5, (income / max) * 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-gray-400 tabular-nums">
        <span>$0</span>
        <span>{fmtCompact(max)}</span>
      </div>
      <p className="text-sm text-gray-700 mt-2">
        Ordinary taxable income of <span className="font-semibold">{fmt(income)}</span> sits in the{" "}
        <span className="font-semibold">{pct(data.rates.marginal_rate, 0)}</span> bracket
        {room != null && data.rates.next_rate != null && (
          <> — <span className="font-semibold">{fmt(room)}</span> more before {pct(data.rates.next_rate, 0)}</>
        )}.
      </p>
      <p className="text-xs text-gray-500 mt-1">
        Long-term gains and qualified dividends are taxed at {pct(data.rates.ltcg_rate, 0)} at this income
        {num(data.bracket.room_in_0_ltcg) > 0 && <> ({fmt(num(data.bracket.room_in_0_ltcg))} still fits in the 0% band)</>}.
      </p>
    </div>
  );
}

export default function OverviewTab({ data, opps, onNavigate }: {
  data: TaxProjectionResponse;
  opps: TaxOpportunitiesResponse | null;
  onNavigate: (tab: TaxTab) => void;
}) {
  const { fmt } = useCurrency();
  const p = data.projection;
  const ctx = data.context;
  const balance = num(p.balance.federal);
  const stateBalance = num(p.balance.state);
  const top = (opps?.opportunities ?? []).filter((o) => o.status === "open").slice(0, 3);
  const sh = p.safe_harbor;
  const partYear = ctx.sources.year_fraction < 1;

  return (
    <div className="space-y-5">
      {ctx.gaps.length > 0 && (
        <button
          type="button"
          onClick={() => onNavigate("inputs")}
          className="w-full text-left bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 hover:bg-amber-100/60 transition"
        >
          <p className="text-sm font-semibold text-amber-900">
            {ctx.gaps.length} input{ctx.gaps.length === 1 ? "" : "s"} would sharpen this estimate →
          </p>
          <p className="text-xs text-amber-800 mt-0.5 truncate">{ctx.gaps.slice(0, 3).map((g) => g.message).join(" · ")}</p>
        </button>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Projected tax" value={fmt(num(p.tax.total))}
             sub={`${fmt(num(p.tax.federal_total))} federal · ${fmt(num(p.tax.state))} state`} />
        <Kpi label="Federal paid so far" value={fmt(num(p.payments.federal_total))}
             sub={`${fmt(num(p.payments.federal_withheld))} withheld · ${fmt(num(p.payments.federal_estimated))} estimated`} />
        <Kpi label={balance >= 0 ? "Federal balance due" : "Federal refund"} value={fmt(Math.abs(balance))}
             tone={balance > 500 ? "bad" : balance < 0 ? "good" : undefined}
             sub={`State: ${stateBalance >= 0 ? "owe" : "refund"} ${fmt(Math.abs(stateBalance))}`} />
        <Kpi label="Effective rate" value={pct(p.rates.effective_rate)} sub="federal tax ÷ total income" />
        <Kpi label="Marginal rate" value={pct(p.rates.marginal_rate, 0)}
             sub={`+ ${pct(p.tax.state_rate, 1)} state`} tone="accent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <Panel
          className="lg:col-span-3"
          title="Where you sit in the brackets"
          note={`${p.year} ${FILING_LABEL[p.filing_status] ?? p.filing_status}${p.table_year !== p.year ? ` · using ${p.table_year} tables` : ""}`}
        >
          <BracketBar data={p} />
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Underpayment safe harbor"
          note={sh.basis}
          right={
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sh.met ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {sh.met ? "On track" : `Short ${fmt(num(sh.shortfall))}`}
            </span>
          }
        >
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-500">Paid {fmt(num(sh.paid))}</span>
            <span className="text-gray-500">Needed {fmt(num(sh.required))}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full ${sh.met ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min(100, (num(sh.paid) / Math.max(1, num(sh.required))) * 100)}%` }}
            />
          </div>
          {!sh.met && sh.quarterly.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-xs font-semibold text-gray-600">Suggested estimated payments</p>
              {sh.quarterly.map((q) => (
                <div key={q.due} className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {fmtDay(q.due)}
                    <span className="text-xs text-gray-400 ml-1.5">in {daysUntil(q.due)} days</span>
                  </span>
                  <span className="font-semibold tabular-nums">{fmt(num(q.suggested))}</span>
                </div>
              ))}
              <p className="text-[11px] text-gray-400 pt-1">
                Or raise W-4 withholding — it counts as paid evenly through the year.
              </p>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Top moves before year-end"
        note={opps ? `${fmt(num(opps.total_est_savings))} of estimated savings across open opportunities` : "Loading…"}
        right={
          <button type="button" onClick={() => onNavigate("opportunities")}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            See all →
          </button>
        }
      >
        {top.length === 0 ? (
          <p className="text-sm text-gray-400 italic">{opps ? "No open opportunities." : "Loading…"}</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {top.map((o) => (
              <div key={o.id} className="py-3 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ScopeBadge scope={o.scope} />
                    <p className="text-sm font-semibold text-gray-800">{o.title}</p>
                    <ConfidenceDot level={o.confidence} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{o.action}</p>
                </div>
                <div className="text-right shrink-0">
                  {o.est_savings ? (
                    <p className="text-sm font-bold text-emerald-600 tabular-nums">saves ~{fmt(num(o.est_savings))}</p>
                  ) : o.tax_cost ? (
                    <p className="text-sm font-semibold text-gray-600 tabular-nums">costs {fmt(num(o.tax_cost))} now</p>
                  ) : null}
                  {o.deadline && <p className="text-[11px] text-gray-400">by {fmtDay(o.deadline)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="How this estimate was built" note={partYear
        ? `Flows so far are scaled to a full year (${pct(ctx.sources.year_fraction, 0)} of ${p.year} has elapsed); realized gains count as booked.`
        : `Full-year figures for ${p.year}.`}>
        <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-4">
          <li>
            Wages and withholding from {ctx.sources.w2_year ? `${ctx.sources.w2_year} W-2 figures in Settings → Salary` : "no W-2 figures yet"}
            {ctx.sources.w2_year && ctx.sources.w2_year !== p.year ? " (last year's, as an estimate)" : ""}.
          </li>
          <li>Gains from your investment lots (FIFO); dividends and interest from taxable accounts.</li>
          <li>Rentals from Schedule E: rents received plus active leases, estimated mortgage interest and depreciation.</li>
          <li>Businesses from transactions on each entity&apos;s linked accounts.</li>
          <li>
            Estimated payments from {ctx.sources.estimated_payments.federal === "profile" ? "your profile" : `${ctx.sources.estimated_payments.transactions.length} "Taxes" transaction(s)`};
            home mortgage interest from {ctx.sources.mortgage_interest}; property tax from {ctx.sources.property_tax}.
          </li>
          {p.assumptions.map((a) => <li key={a}>{a}</li>)}
          <li>State tax is a rough estimate at the state&apos;s top rate. This is a planning estimate, not a filing.</li>
        </ul>
      </Panel>
    </div>
  );
}
