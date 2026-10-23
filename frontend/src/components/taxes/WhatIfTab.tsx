"use client";

import React, { useEffect, useRef, useState } from "react";
import { runTaxScenario, type TaxScenarioResponse } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { num, Panel, pct } from "./shared";

interface Lever {
  key: string;
  label: string;
  hint: string;
  max: number;
  step: number;
}

const GROUPS: { title: string; levers: Lever[] }[] = [
  {
    title: "Personal",
    levers: [
      { key: "extra_401k", label: "Extra 401(k) deferral", hint: "Traditional, through payroll", max: 35_000, step: 500 },
      { key: "extra_ira_deductible", label: "Deductible IRA", hint: "If eligible", max: 16_000, step: 500 },
      { key: "extra_hsa", label: "HSA contribution", hint: "Outside payroll", max: 10_000, step: 250 },
      { key: "roth_conversion", label: "Roth conversion", hint: "Adds ordinary income", max: 200_000, step: 1_000 },
      { key: "bonus", label: "Extra income / bonus", hint: "Ordinary income", max: 200_000, step: 1_000 },
      { key: "charitable_extra", label: "Extra charitable gifts", hint: "Cash", max: 50_000, step: 500 },
    ],
  },
  {
    title: "Investments",
    levers: [
      { key: "harvest_losses", label: "Harvest losses", hint: "Short-term losses realized", max: 100_000, step: 500 },
      { key: "realize_ltcg", label: "Realize long-term gains", hint: "e.g. to use the 0% band", max: 200_000, step: 1_000 },
    ],
  },
  {
    title: "Business",
    levers: [
      { key: "business_expense", label: "Equipment / expenses", hint: "Bonus depreciation, deducted now", max: 100_000, step: 1_000 },
      { key: "business_retirement", label: "SEP / Solo 401(k)", hint: "Employer contribution", max: 72_000, step: 500 },
      { key: "s_corp_salary", label: "S-corp owner salary", hint: "Models electing S-corp (sole props)", max: 200_000, step: 1_000 },
    ],
  },
  {
    title: "Payments",
    levers: [
      { key: "extra_estimated_federal", label: "Extra estimated payment", hint: "Federal", max: 100_000, step: 500 },
      { key: "extra_withholding", label: "Extra withholding", hint: "Raise the W-4", max: 50_000, step: 500 },
    ],
  },
];

export default function WhatIfTab({ year, preset }: { year: number; preset: Record<string, number> | null }) {
  const { fmt } = useCurrency();
  const [changes, setChanges] = useState<Record<string, number>>(preset ?? {});
  const [result, setResult] = useState<TaxScenarioResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (preset) setChanges(preset);
  }, [preset]);

  useEffect(() => {
    const id = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      const clean = Object.fromEntries(Object.entries(changes).filter(([, v]) => v > 0));
      runTaxScenario(year, clean)
        .then((r) => { if (id === seq.current) { setResult(r); setError(""); } })
        .catch((e) => { if (id === seq.current) setError(e instanceof Error ? e.message : "Scenario failed"); })
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [changes, year]);

  const set = (k: string, v: number) => setChanges((c) => ({ ...c, [k]: Math.max(0, v) }));
  const active = Object.values(changes).filter((v) => v > 0).length;
  const delta = result ? num(result.delta.total) : 0;

  const rows: { label: string; key: keyof TaxScenarioResponse["base"]; rate?: boolean }[] = [
    { label: "AGI", key: "agi" },
    { label: "Taxable income", key: "taxable_income" },
    { label: "Federal tax", key: "federal" },
    { label: "State tax", key: "state" },
    { label: "Total tax", key: "total" },
    { label: "Federal balance due (− refund)", key: "balance_federal" },
    { label: "Marginal rate", key: "marginal_rate", rate: true },
    { label: "Effective rate", key: "effective_rate", rate: true },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <div className="lg:col-span-3 space-y-5">
        {GROUPS.map((g) => (
          <Panel key={g.title} title={g.title}>
            <div className="space-y-4">
              {g.levers.map((l) => {
                const v = changes[l.key] ?? 0;
                return (
                  <div key={l.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor={`lever-${l.key}`} className="text-sm text-gray-700">
                        {l.label} <span className="text-xs text-gray-400">{l.hint}</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={l.step}
                        value={v || ""}
                        placeholder="0"
                        aria-label={`${l.label} amount`}
                        onChange={(e) => set(l.key, Number(e.target.value) || 0)}
                        className="w-28 text-right text-sm border border-gray-300 rounded-md px-2 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <input
                      id={`lever-${l.key}`}
                      type="range"
                      min={0}
                      max={Math.max(l.max, v)}
                      step={l.step}
                      value={v}
                      onChange={(e) => set(l.key, Number(e.target.value))}
                      className="w-full accent-indigo-600 mt-1"
                    />
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      <div className="lg:col-span-2">
        <div className="lg:sticky lg:top-4 space-y-4">
          <div className={`rounded-xl p-5 border ${delta < -0.5 ? "bg-emerald-50 border-emerald-200" : delta > 0.5 ? "bg-red-50 border-red-200" : "bg-white border-gray-100"}`}>
            <p className="text-xs uppercase tracking-wide text-gray-500">Change in total tax</p>
            <p className={`text-3xl font-bold tabular-nums mt-1 ${delta < -0.5 ? "text-emerald-700" : delta > 0.5 ? "text-red-700" : "text-gray-900"}`}>
              {delta < -0.5 ? "−" : delta > 0.5 ? "+" : ""}{fmt(Math.abs(delta))}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {active === 0 ? "Move a lever to compare." : `${active} change${active === 1 ? "" : "s"} applied`}
              {busy && " · updating…"}
            </p>
            {active > 0 && (
              <button type="button" onClick={() => setChanges({})} className="text-xs text-indigo-600 hover:text-indigo-800 mt-2">
                Reset
              </button>
            )}
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

          {result && (
            <Panel title="Before → after">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="text-left font-medium py-1" />
                    <th className="text-right font-medium py-1">Now</th>
                    <th className="text-right font-medium py-1">What-if</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const a = r.rate ? (result.base[r.key] as number) : num(result.base[r.key] as string);
                    const b = r.rate ? (result.scenario[r.key] as number) : num(result.scenario[r.key] as string);
                    const changed = Math.abs(a - b) > (r.rate ? 0.0001 : 0.5);
                    const f = (x: number) => (r.rate ? pct(x, r.key === "marginal_rate" ? 0 : 1) : (x < 0 ? `−${fmt(Math.abs(x))}` : fmt(x)));
                    return (
                      <tr key={r.key}>
                        <td className="py-1.5 text-gray-600">{r.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">{f(a)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${changed ? "font-semibold text-gray-900" : "text-gray-500"}`}>{f(b)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}
          <p className="text-xs text-gray-400">
            Each change re-runs the full projection — brackets, phase-outs, QBI, NIIT and the 0% gains band included.
          </p>
        </div>
      </div>
    </div>
  );
}
