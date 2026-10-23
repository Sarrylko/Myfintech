"use client";

import React from "react";
import type { TaxProjectionResponse, TaxRentalRow } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import type { TaxTab } from "./OverviewTab";
import { Kpi, num, Panel } from "./shared";

const COLUMNS: { key: keyof TaxRentalRow; label: string; tone?: string }[] = [
  { key: "gross_rents", label: "Rents" },
  { key: "mgmt_fees", label: "Mgmt" },
  { key: "insurance", label: "Insurance" },
  { key: "property_tax", label: "Prop. tax" },
  { key: "hoa", label: "HOA" },
  { key: "repairs", label: "Repairs" },
  { key: "other_fixed", label: "Other" },
  { key: "noi", label: "NOI", tone: "text-blue-600" },
  { key: "mortgage_interest", label: "Interest" },
  { key: "depreciation", label: "Depreciation" },
  { key: "net_income", label: "Sch. E net", tone: "font-semibold" },
];

export default function RentalsTab({ data, year, onDownload, onNavigate }: {
  data: TaxProjectionResponse;
  year: number;
  onDownload: () => void;
  onNavigate: (tab: TaxTab) => void;
}) {
  const { fmt } = useCurrency();
  const rows = data.context.rentals;
  const inc = data.projection.income;
  const total = (k: keyof TaxRentalRow) => rows.reduce((s, r) => s + num(r[k] as string), 0);
  const cell = (v: number) => (v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v));
  const partYear = data.context.sources.year_fraction < 1;
  const suspended = num(inc.suspended_passive_out);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Rental properties" value={String(rows.length)} />
        <Kpi label="Gross rents" value={fmt(total("gross_rents"))} tone="good" sub={partYear ? "received + active leases" : undefined} />
        <Kpi label="Depreciation" value={fmt(total("depreciation"))} sub="non-cash deduction" />
        <Kpi
          label="Net on your return"
          value={cell(num(inc.rental))}
          tone={num(inc.rental) < 0 ? "good" : undefined}
          sub={suspended > 0 ? `${fmt(suspended)} of losses suspended (passive)` : `before limits ${cell(num(inc.rental_before_limits))}`}
        />
      </div>

      <Panel
        title={`Schedule E — ${year}${partYear ? " (projected)" : ""}`}
        note="Interest is estimated from loan terms and depreciation from purchase price, closing costs and land value."
        right={
          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition"
          >
            Download CSV for CPA
          </button>
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No US rental properties.</p>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-y border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-gray-700">Property</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-right font-semibold text-gray-700 whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.property_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800">{r.address}</p>
                      <p className="text-[11px] text-gray-400">
                        in service {r.placed_in_service ?? "—"}
                        {r.land_estimated && (
                          <button type="button" onClick={() => onNavigate("inputs")} className="ml-1.5 text-amber-600 hover:underline">
                            land assumed 20%
                          </button>
                        )}
                      </p>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 text-right tabular-nums ${c.tone ?? ""}`}>
                        {cell(num(r[c.key] as string))}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-blue-50 font-bold">
                  <td className="px-4 py-2.5">Total</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">{cell(total(c.key))}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {suspended > 0 && (
        <Panel title="Passive loss limit">
          <p className="text-sm text-gray-600">
            Rental losses are passive. With income above $100k the $25,000 allowance for active participants shrinks
            by 50¢ per dollar and is gone at $150k, so <span className="font-semibold">{fmt(suspended)}</span> of losses
            carries forward. Suspended losses offset future rental profit and are fully released when you sell the property.
          </p>
        </Panel>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-amber-900 mb-2">Notes for your CPA</h3>
        <ul className="space-y-1.5 text-sm text-amber-800 list-disc pl-5">
          <li><strong>Gross rents:</strong> payments received (cash basis){partYear ? "; the projection adds active leases for the rest of the year" : ""}.</li>
          <li><strong>Repairs</strong> are deducted this year; <strong>CapEx</strong> is depreciated over 27.5 years from the month it was placed in service.</li>
          <li><strong>Mortgage interest</strong> is estimated from each loan&apos;s balance, rate and payment — use Form 1098 for filing.</li>
          <li><strong>Depreciation</strong> is straight-line, mid-month convention, on price + closing costs less land; it doesn&apos;t include prior-year carryover losses.</li>
        </ul>
      </div>
    </div>
  );
}
