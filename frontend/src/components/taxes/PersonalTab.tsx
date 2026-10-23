"use client";

import React from "react";
import type { TaxProjectionResponse } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { Line, num, Panel, pct } from "./shared";

// The projection laid out like a 1040: income → AGI → deductions → taxable
// income → tax → payments. Zero lines are hidden to keep it readable.

export default function PersonalTab({ data }: { data: TaxProjectionResponse }) {
  const { fmt } = useCurrency();
  const p = data.projection;
  const inc = p.income;
  const adj = p.adjustments;
  const d = p.deductions;
  const t = p.tax;
  const m = (v: string | number) => fmt(num(v));
  const signed = (v: string) => (num(v) < 0 ? `−${fmt(Math.abs(num(v)))}` : m(v));
  const show = (v: string) => Math.abs(num(v)) >= 1;
  const realized = data.context.investments.realized;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Panel title="Income → taxable income" note="Projected for the full year">
        <Line label="Wages (W-2 box 1)" value={m(inc.wages)} />
        {show(inc.other_ordinary) && <Line label="Bonus / RSU / other income" value={m(inc.other_ordinary)} />}
        {show(inc.roth_conversion) && <Line label="Roth conversion" value={m(inc.roth_conversion)} />}
        {show(inc.interest) && <Line label="Interest" value={m(inc.interest)} />}
        {show(inc.ordinary_dividends) && (
          <Line label="Dividends" value={m(inc.ordinary_dividends)} hint={`${m(inc.qualified_dividends)} qualified`} />
        )}
        {(show(inc.short_term_gains) || show(inc.long_term_gains)) && (
          <Line
            label="Capital gain / loss"
            value={signed(inc.capital_gain_or_loss)}
            hint={`ST ${signed(inc.short_term_gains)} · LT ${signed(inc.long_term_gains)}`}
          />
        )}
        {show(inc.business) && <Line label="Business income (Sch. C / K-1)" value={signed(inc.business)} />}
        {(show(inc.rental) || show(inc.rental_before_limits)) && (
          <Line
            label="Rental income (Sch. E)"
            value={signed(inc.rental)}
            hint={num(inc.rental) !== num(inc.rental_before_limits) ? `${signed(inc.rental_before_limits)} before passive limits` : undefined}
          />
        )}
        <Line label="Total income" value={m(inc.total)} strong />

        {show(adj.total) && (
          <>
            {show(adj.half_se_tax) && <Line label="½ self-employment tax" value={`−${m(adj.half_se_tax)}`} indent />}
            {show(adj.se_health_insurance) && <Line label="Self-employed health insurance" value={`−${m(adj.se_health_insurance)}`} indent />}
            {show(adj.business_retirement) && <Line label="SEP / Solo 401(k)" value={`−${m(adj.business_retirement)}`} indent />}
            {show(adj.other) && <Line label="IRA / HSA / other adjustments" value={`−${m(adj.other)}`} indent />}
          </>
        )}
        <Line label="Adjusted gross income (AGI)" value={m(p.agi)} strong />

        <Line
          label={d.itemizing ? "Itemized deductions" : "Standard deduction"}
          value={`−${m(d.itemizing ? d.itemized : d.standard)}`}
          hint={d.itemizing ? `vs ${m(d.standard)} standard` : `itemized would be ${m(d.itemized)}`}
        />
        {show(d.nonitemizer_charity) && <Line label="Charitable (non-itemizer)" value={`−${m(d.nonitemizer_charity)}`} />}
        {show(d.senior) && <Line label="Senior deduction (65+)" value={`−${m(d.senior)}`} />}
        {show(d.qbi) && <Line label="QBI deduction (§199A)" value={`−${m(d.qbi)}`} />}
        <Line label="Taxable income" value={m(p.taxable_income)} strong />
      </Panel>

      <div className="space-y-5">
        <Panel title="Tax → balance" note={`Marginal ${pct(p.rates.marginal_rate, 0)} · effective ${pct(p.rates.effective_rate)}`}>
          <Line label="Tax on ordinary income" value={m(t.ordinary)} />
          {show(t.capital_gains) && <Line label="Tax on gains & qualified dividends" value={m(t.capital_gains)} />}
          {show(t.credits) && <Line label="Child / dependent credits" value={`−${m(t.credits)}`} />}
          {show(t.self_employment) && <Line label="Self-employment tax" value={m(t.self_employment)} />}
          {show(t.other) && <Line label="Payroll tax (scenario)" value={m(t.other)} />}
          {show(t.niit) && <Line label="Net investment income tax (3.8%)" value={m(t.niit)} />}
          {show(t.additional_medicare) && <Line label="Additional Medicare tax (0.9%)" value={m(t.additional_medicare)} />}
          <Line label="Federal tax" value={m(t.federal_total)} strong />
          <Line label="Withheld (W-2)" value={`−${m(p.payments.federal_withheld)}`} indent />
          <Line label="Estimated payments" value={`−${m(p.payments.federal_estimated)}`} indent />
          <Line
            label={num(p.balance.federal) >= 0 ? "Federal balance due" : "Federal refund"}
            value={m(Math.abs(num(p.balance.federal)))}
            strong
          />
          <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
            <Line label={`State tax (${pct(t.state_rate, 2)} est.)`} value={m(t.state)} />
            <Line label="State paid" value={`−${m(p.payments.state_total)}`} indent />
            <Line label={num(p.balance.state) >= 0 ? "State balance due" : "State refund"} value={m(Math.abs(num(p.balance.state)))} strong />
          </div>
        </Panel>

        {d.itemizing || num(d.itemized) > 0 ? (
          <Panel title="Itemized deductions" note={d.itemizing ? "Itemizing beats the standard deduction" : "Below the standard deduction"}>
            <Line label="State & local taxes (SALT)" value={m(d.salt)} hint={`${m(d.salt_paid)} paid, cap ${m(d.salt_cap)}`} />
            <Line label="Home mortgage interest" value={m(d.mortgage_interest)} />
            <Line label="Charitable gifts" value={m(d.charitable)} />
            {show(d.medical) && <Line label="Medical (over 7.5% of AGI)" value={m(d.medical)} />}
            {show(d.other) && <Line label="Other" value={m(d.other)} />}
            <Line label="Total itemized" value={m(d.itemized)} strong />
          </Panel>
        ) : null}

        <Panel title="W-2 earners" note="From Settings → Salary (full-year figures)">
          {data.inputs.earners.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No W-2 figures entered.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="text-left font-medium py-1">Earner</th>
                    <th className="text-right font-medium py-1">Wages</th>
                    <th className="text-right font-medium py-1">Fed w/h</th>
                    <th className="text-right font-medium py-1">401(k)</th>
                    <th className="text-right font-medium py-1">HSA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.inputs.earners.map((e) => (
                    <tr key={e.name}>
                      <td className="py-1.5 text-gray-700">{e.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{m(e.wages)}</td>
                      <td className="py-1.5 text-right tabular-nums">{m(e.federal_withheld)}</td>
                      <td className="py-1.5 text-right tabular-nums">{m(num(e.k401_traditional) + num(e.k401_roth))}</td>
                      <td className="py-1.5 text-right tabular-nums">{m(e.hsa_payroll)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Realized investment gains" note={data.context.investments.history_start ? `Lot history from ${data.context.investments.history_start}` : undefined}>
          <Line label="Short-term" value={signed(realized.short_term.net)} />
          <Line label="Long-term" value={signed(realized.long_term.net)} />
          {show(realized.unknown_term.net) && <Line label="Unknown term (counted as short)" value={signed(realized.unknown_term.net)} />}
          <Line label="Net realized" value={signed(realized.net)} strong />
          <Line label="Unrealized gains in taxable accounts" value={m(data.context.investments.unrealized_gain)} muted />
        </Panel>
      </div>
    </div>
  );
}
