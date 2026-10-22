"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer,
} from "recharts";
import { getDividendSummary, type Account, type DividendSummary, type UpcomingDividend } from "@/lib/api";

// Received income comes from dividend transactions; forward income is current
// shares × each security's trailing-12-month dividend per share, and the
// calendar repeats last year's ex-dates. The backend does the math.

type Fmt = (val: string | number | null | undefined, decimals?: number) => string;

const pct = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string, withYear: boolean): string {
  const [y, m] = key.split("-").map(Number);
  return withYear ? `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}` : MONTH_SHORT[m - 1];
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: React.ReactNode; tone?: "up" | "down";
}) {
  return (
    <div className="bg-white px-5 py-3 min-w-0">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${
        tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "text-gray-900"
      }`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

function IncomeChart({ data, range, fmt }: { data: DividendSummary; range: 12 | 24; fmt: Fmt }) {
  const rows = useMemo(() => {
    const all = data.monthly.map((m) => ({ month: m.month, amount: Number(m.amount) }));
    if (range === 24) return all.map((r) => ({ ...r, label: monthLabel(r.month, true) }));
    // 12-month view: this year's bar beside the same month a year earlier
    const prior = all.slice(0, 12);
    return all.slice(-12).map((r, i) => ({ ...r, prior: prior[i]?.amount ?? 0, label: monthLabel(r.month, true) }));
  }, [data, range]);

  const fmtTick = (v: number) => (v >= 1000 ? `${fmt(v / 1000, v % 1000 === 0 ? 0 : 1)}k` : fmt(v));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap={range === 12 ? "22%" : "18%"}>
        <CartesianGrid strokeDasharray="4 4" stroke="#e4e8ed" strokeOpacity={0.5} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7a8fa6" }} axisLine={false} tickLine={false} interval={range === 24 ? 2 : 0} />
        <YAxis tickFormatter={fmtTick} tick={{ fontSize: 10, fill: "#7a8fa6" }} axisLine={false} tickLine={false} width={52} />
        <ChartTooltip
          cursor={{ fill: "#f3f4f6" }}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
          formatter={(v: number, name: string) => [fmt(v, 2), name === "prior" ? "A year earlier" : "Received"]}
        />
        {range === 12 && <Bar dataKey="prior" fill="#cbd5e1" radius={[3, 3, 0, 0]} maxBarSize={22} />}
        <Bar dataKey="amount" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={range === 12 ? 22 : 18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PayersTable({ data, fmt }: { data: DividendSummary; fmt: Fmt }) {
  const [showAll, setShowAll] = useState(false);
  const payers = data.top_payers;
  const rows = showAll ? payers : payers.slice(0, 8);
  if (payers.length === 0) {
    return <p className="px-5 py-8 text-center text-xs text-gray-400">No dividend payers yet</p>;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400">
              <th className="text-left font-semibold px-5 py-2">Holding</th>
              <th className="text-right font-semibold px-2 py-2">Last 12 mo</th>
              <th className="text-right font-semibold px-2 py-2">Forward</th>
              <th className="text-right font-semibold px-2 py-2">Yield</th>
              <th className="text-right font-semibold px-5 py-2">On cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.key} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-2 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {p.ticker && <span className="font-mono font-semibold text-gray-800">{p.ticker}</span>}
                    <span className="text-gray-400 truncate max-w-[150px]" title={p.name}>{p.name}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {p.payments_ttm > 0 ? `${p.payments_ttm} payment${p.payments_ttm !== 1 ? "s" : ""}` : "None received yet"}
                    {!p.held && (p.forward_annual ? " · cash sweep / not a listed holding" : " · no longer held")}
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-900 font-medium">
                  {Number(p.received_ttm) !== 0 ? fmt(p.received_ttm, 2) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-700">
                  {p.forward_annual ? (
                    <span title={p.forward_source === "history"
                      ? "No market dividend data — based on what it paid you over the last 12 months"
                      : "Shares held × trailing 12-month dividend per share"}>
                      {fmt(p.forward_annual, 2)}
                      {p.forward_source === "history" && <span className="text-gray-400">*</span>}
                    </span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(p.yield)}</td>
                <td className="px-5 py-2 text-right tabular-nums text-gray-600">{pct(p.yield_on_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {payers.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="w-full px-5 py-2.5 text-xs font-medium text-blue-600 hover:bg-gray-50 border-t border-gray-100"
        >
          {showAll ? "Show top 8" : `Show all ${payers.length} payers`}
        </button>
      )}
    </>
  );
}

function UpcomingList({ items, fmt }: { items: UpcomingDividend[]; fmt: Fmt }) {
  const groups = useMemo(() => {
    const out: { month: string; total: number; items: UpcomingDividend[] }[] = [];
    for (const it of items) {
      const mk = it.date.slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.month !== mk) {
        g = { month: mk, total: 0, items: [] };
        out.push(g);
      }
      g.items.push(it);
      g.total += Number(it.amount);
    }
    return out;
  }, [items]);

  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-xs text-gray-400">No payments expected in the next 90 days</p>;
  }
  return (
    <div className="max-h-[320px] overflow-y-auto">
      {groups.map((g) => {
        const [y, m] = g.month.split("-").map(Number);
        return (
          <div key={g.month}>
            <div className="sticky top-0 bg-gray-50 px-5 py-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <span>{MONTH_SHORT[m - 1]} {y}</span>
              <span className="tabular-nums">{fmt(g.total, 2)}</span>
            </div>
            <ul>
              {g.items.map((it) => {
                const d = new Date(`${it.date}T00:00:00`);
                return (
                  <li key={`${it.ticker}-${it.date}`} className="px-5 py-2 flex items-center justify-between gap-3 border-t border-gray-50 first:border-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 shrink-0 text-center rounded-md border border-gray-200 py-0.5">
                        <p className="text-[9px] uppercase text-gray-400 leading-tight">{MONTH_SHORT[d.getMonth()]}</p>
                        <p className="text-sm font-bold text-gray-800 leading-tight tabular-nums">{d.getDate()}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-mono font-semibold text-gray-800">{it.ticker ?? it.name}</p>
                        <p className="text-[10px] text-gray-400 truncate" title={it.name}>{fmt(it.per_share, 4)}/share</p>
                      </div>
                    </div>
                    <p className="text-xs font-semibold tabular-nums text-gray-900 shrink-0">{fmt(it.amount, 2)}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function DividendIncome({ accounts, fmt }: { accounts: Account[]; fmt: Fmt }) {
  const [data, setData] = useState<DividendSummary | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<12 | 24>(12);
  const idsKey = accounts.map((a) => a.id).sort().join(",");

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    setError("");
    getDividendSummary(idsKey.split(","))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dividends"); });
    return () => { cancelled = true; };
  }, [idsKey]);

  if (accounts.length === 0) return null;
  if (error) {
    return (
      <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-red-600">
        Dividend income couldn&apos;t load: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-gray-400">
        Loading dividend income…
      </div>
    );
  }

  const ttm = Number(data.ttm_received);
  const forward = Number(data.forward_annual);
  if (ttm === 0 && forward === 0 && data.top_payers.length === 0) return null;

  const next90 = data.upcoming.reduce((s, u) => s + Number(u.amount), 0);
  const growth = data.yoy_growth;
  const partialHistory = data.history_start && new Date(data.history_start) > new Date(Date.now() - 700 * 86400_000);
  const missingMarket = data.symbols_looked_up - data.symbols_with_market_data;

  return (
    <div className="mb-5 bg-white rounded-xl shadow border border-gray-100">
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Dividend Income</h3>
          <p className="text-xs text-gray-400 mt-0.5">What the accounts shown have paid, and what they&apos;re on track to pay</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
          {([12, 24] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 rounded-md font-medium ${range === r ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}
            >
              {r} mo
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-gray-100 border-b border-gray-100">
        <Stat
          label="Received · 12 mo"
          value={fmt(ttm, 2)}
          sub={growth === null ? "No prior-year history" : <>
            <span className={growth >= 0 ? "text-emerald-600" : "text-red-600"}>{growth >= 0 ? "+" : "−"}{pct(Math.abs(growth), 1)}</span> vs prior 12 mo
          </>}
        />
        <Stat label="Forward annual" value={fmt(forward, 2)} sub={`≈ ${fmt(forward / 12, 2)} a month`} />
        <Stat label="Yield on value" value={pct(data.yield_on_value)} sub={`of ${fmt(data.portfolio_value)}`} />
        <Stat label="Yield on cost" value={pct(data.yield_on_cost)} sub="Holdings with cost basis" />
        <Stat label="Next 90 days" value={fmt(next90, 2)} sub={`${data.upcoming.length} expected payment${data.upcoming.length !== 1 ? "s" : ""}`} />
      </div>

      <div className="px-3 pt-4 pb-1">
        <IncomeChart data={data} range={range} fmt={fmt} />
        <div className="flex items-center gap-4 px-2 pb-2 text-[10px] text-gray-400">
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Received</span>
          {range === 12 && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300" />Same month a year earlier</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 border-t border-gray-100">
        <div className="lg:col-span-3 lg:border-r border-gray-100">
          <p className="px-5 pt-3 pb-1 text-xs font-semibold text-gray-900">Top dividend payers</p>
          <PayersTable data={data} fmt={fmt} />
        </div>
        <div className="lg:col-span-2 border-t lg:border-t-0 border-gray-100">
          <p className="px-5 pt-3 pb-1 text-xs font-semibold text-gray-900">
            Upcoming payments <span className="font-normal text-gray-400">· next 90 days, estimated</span>
          </p>
          <UpcomingList items={data.upcoming} fmt={fmt} />
        </div>
      </div>

      <p className="px-5 py-2.5 text-[11px] leading-relaxed text-gray-400 border-t border-gray-100">
        Received includes interest your brokers report as dividends. Forward income is shares held × the trailing
        12-month dividend per share; * marks holdings estimated from what they paid you instead.
        {data.mutual_funds_held > 0 && ` Mutual funds (${data.mutual_funds_held} held) are always estimated that way, because market data mixes their capital-gain distributions in with dividends; funds in accounts that don't report dividends show no forward income.`}
        Upcoming dates repeat last year&apos;s ex-dividend dates, so treat them as approximate.
        {missingMarket > 0 && ` ${missingMarket} ticker${missingMarket !== 1 ? "s" : ""} couldn't be looked up just now.`}
        {partialHistory && growth !== null && ` Dividend history starts ${new Date(data.history_start!).toLocaleDateString()}, so the prior year may be incomplete and growth overstated.`}
      </p>
    </div>
  );
}
