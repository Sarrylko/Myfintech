"use client";

import type { PayrollPerson, SankeyData } from "@/lib/api";

/** IRS employee elective-deferral limit (traditional + Roth 401k), excluding catch-up */
const ELECTIVE_DEFERRAL_LIMIT: Record<number, number> = {
  2024: 23000,
  2025: 23500,
  2026: 24500,
};

function deferralLimit(year: number): number {
  if (ELECTIVE_DEFERRAL_LIMIT[year]) return ELECTIVE_DEFERRAL_LIMIT[year];
  const known = Object.keys(ELECTIVE_DEFERRAL_LIMIT).map(Number).sort((a, b) => a - b);
  return ELECTIVE_DEFERRAL_LIMIT[known[known.length - 1]];
}

/** Ratios for a payroll flow; spending-based ones are null when no spending was tracked */
function ratesOf(d: SankeyData | null): { tax: number | null; saving: number | null; spending: number | null; housing: number | null } {
  const p = d?.payroll;
  const gross = d?.gross_income ?? 0;
  if (!p || gross <= 0) return { tax: null, saving: null, spending: null, housing: null };
  // Spending-based rates need transactions for most of the period
  const tracked = p.expenses > 0 && p.months_with_data >= Math.ceil(p.period_months * 0.75);
  return {
    tax: p.taxes / gross,
    saving: tracked ? (p.payroll_investments + p.savings_transfers + p.loan_principal) / gross : null,
    spending: tracked && p.take_home > 0 ? p.expenses / p.take_home : null,
    housing: tracked && p.take_home > 0 ? p.housing / p.take_home : null,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Delta({ now, prev, goodWhenUp, year }: { now: number | null; prev: number | null; goodWhenUp: boolean; year: number }) {
  if (now === null || prev === null) return null;
  const diff = (now - prev) * 100;
  if (Math.abs(diff) < 0.05) return <span className="text-[10px] text-gray-400">same as {year}</span>;
  const good = goodWhenUp ? diff > 0 : diff < 0;
  return (
    <span className={`text-[10px] font-medium ${good ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)} pts vs {year}
    </span>
  );
}

function Kpi({ label, value, sub, hint, children }: { label: string; value: string; sub?: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-slate-700/40 px-3 py-2.5" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 tabular-nums">{sub}</p>}
      {children}
    </div>
  );
}

interface Props {
  data: SankeyData;
  previous: SankeyData | null;
  fmt: (value: number) => string;
}

/** Headline rates for the payroll flow, year-over-year changes and per-earner W-2 details. */
export default function PayrollInsights({ data, previous, fmt }: Props) {
  const p = data.payroll;
  const gross = data.gross_income ?? 0;
  if (!p || gross <= 0) return null;

  const now = ratesOf(data);
  const prev = ratesOf(previous);
  const prevYear = data.year - 1;
  const saved = p.payroll_investments + p.savings_transfers + p.loan_principal;
  const limit = deferralLimit(data.year);

  return (
    <div className="mb-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Kpi label="Effective tax rate" value={pct(now.tax ?? 0)} sub={`${fmt(p.taxes)} federal, state & FICA`}>
          <Delta now={now.tax} prev={prev.tax} goodWhenUp={false} year={prevYear} />
        </Kpi>
        <Kpi label="Take-home" value={fmt(p.take_home)} sub={`${pct(p.take_home / gross)} of gross`}
          hint="Gross pay minus taxes, benefits and payroll investing" />
        <Kpi label="Savings rate" value={now.saving === null ? "—" : pct(now.saving)} sub={`${fmt(saved)} saved`}
          hint="401k + ESOP + savings & investing transfers + loan principal, as a share of gross pay">
          <Delta now={now.saving} prev={prev.saving} goodWhenUp year={prevYear} />
        </Kpi>
        <Kpi label="Spending" value={now.spending === null ? "—" : pct(now.spending)} sub={`${fmt(p.expenses)} of take-home`}
          hint="Spending (loan payments count interest and escrow only) as a share of take-home pay">
          <Delta now={now.spending} prev={prev.spending} goodWhenUp={false} year={prevYear} />
        </Kpi>
        <Kpi label="Housing" value={now.housing === null ? "—" : pct(now.housing)} sub={`${fmt(p.housing)} of take-home`}
          hint="Housing spending as a share of take-home pay. Under ~30% is a common guideline.">
          <Delta now={now.housing} prev={prev.housing} goodWhenUp={false} year={prevYear} />
        </Kpi>
        {p.uncovered > 0 ? (
          <Kpi label="Beyond take-home" value={fmt(p.uncovered)} sub="funded by other income or savings"
            hint="Tracked spending and saving that exceeded W-2 take-home pay" />
        ) : (
          <Kpi label="Unallocated" value={fmt(p.unallocated)} sub={`${pct(p.unallocated / Math.max(p.take_home, 1))} of take-home`}
            hint="Take-home pay not seen leaving as spending or savings — usually cash building up in checking, or untracked accounts" />
        )}
      </div>

      {p.people.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-2 font-semibold">Earner ({data.year} W-2)</th>
                <th className="py-1.5 px-2 font-semibold text-right">Gross</th>
                <th className="py-1.5 px-2 font-semibold text-right">Tax rate</th>
                <th className="py-1.5 px-2 font-semibold text-right">401k (trad + Roth)</th>
                <th className="py-1.5 pl-2 font-semibold text-right" title={`IRS limit ${fmt(limit)}; catch-up contributions allowed from age 50 are extra`}>
                  Room left
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/60">
              {p.people.map((person: PayrollPerson) => {
                const taxes = person.federal_tax + person.state_tax + person.social_security + person.medicare;
                const k401 = person.traditional_401k + person.roth_401k;
                const room = limit - k401;
                const filled = Math.min(1, k401 / limit);
                return (
                  <tr key={person.user_id}>
                    <td className="py-2 pr-2">
                      <span className="font-medium text-gray-700 dark:text-gray-200">{person.name}</span>
                      {person.employer && <span className="text-gray-400"> · {person.employer}</span>}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmt(person.gross)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {person.gross > 0 ? pct(taxes / person.gross) : "—"}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden hidden sm:block">
                          <div className="h-full bg-emerald-500" style={{ width: `${filled * 100}%` }} />
                        </div>
                        <span className="tabular-nums text-gray-700 dark:text-gray-200">{fmt(k401)}</span>
                      </div>
                    </td>
                    <td className={`py-2 pl-2 text-right tabular-nums font-semibold ${room > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {room > 0 ? fmt(room) : "Maxed ✓"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
