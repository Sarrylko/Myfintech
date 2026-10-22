"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer,
} from "recharts";
import { getInvestmentHistory, type Account, type Holding, type InvestmentHistory } from "@/lib/api";
import { BUCKET_LABEL, BUCKET_ORDER, classifyAccount, classifyHolding, type AssetBucket } from "./PortfolioInsights";

// Value history comes from the daily snapshot task, so it starts the day that
// task first ran. Contributions are deposits/withdrawals recorded as
// transfers; the backend does the return math. Allocation over time
// re-buckets the stored positions with the same rules as the allocation view.

type Fmt = (val: string | number | null | undefined, decimals?: number) => string;
type View = "total" | "account" | "bucket";

const RANGES: { label: string; days: number | undefined }[] = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "All", days: undefined },
];

const BUCKET_COLOR: Record<AssetBucket, string> = {
  us_stocks: "#2563eb",
  intl_stocks: "#7c3aed",
  bonds: "#0d9488",
  balanced: "#d97706",
  real_estate: "#db2777",
  cash: "#64748b",
  crypto: "#ea580c",
  other: "#a3a3a3",
};
const ACCOUNT_COLORS = ["#2563eb", "#0d9488", "#7c3aed", "#d97706", "#db2777", "#0891b2", "#65a30d", "#ea580c", "#64748b"];

const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? "—" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(d)}%`;

function shortDate(iso: string, withYear: boolean): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, withYear ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });
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

/** Bucket totals per day, built the same way as the current allocation view:
 * positions classified individually, balance beyond the listed positions
 * counted as cash, and accounts with no positions classified as a whole. */
function bucketRows(data: InvestmentHistory, accounts: Account[]) {
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const posByDate = new Map(data.positions.map((p) => [p.date, p.values]));
  const rows: Record<string, number | string>[] = [];

  for (const point of data.series) {
    const values = posByDate.get(point.date);
    // Days before positions were recorded can't be split by asset class
    if (!values) continue;
    const row: Record<string, number | string> = { date: point.date };
    const add = (b: AssetBucket, v: number) => { row[b] = ((row[b] as number) ?? 0) + v; };

    const held = new Map<string, number>();
    for (const [idx, raw] of values) {
      const sec = data.securities[idx];
      const acc = accById.get(sec.account_id);
      if (!acc) continue;
      const v = Number(raw);
      add(classifyHolding(sec as unknown as Holding, acc), v);
      held.set(sec.account_id, (held.get(sec.account_id) ?? 0) + v);
    }
    for (const [accId, raw] of Object.entries(point.accounts)) {
      const acc = accById.get(accId);
      if (!acc) continue;
      const balance = Number(raw);
      const h = held.get(accId);
      if (h === undefined) {
        if (balance > 0) add(classifyAccount(acc), balance);
      } else {
        const gap = balance - h;
        if (gap > Math.max(1, balance * 0.005)) add("cash", gap);
      }
    }
    rows.push(row);
  }
  return rows;
}

export default function PortfolioHistory({ accounts, fmt }: { accounts: Account[]; fmt: Fmt }) {
  const [data, setData] = useState<InvestmentHistory | null>(null);
  const [error, setError] = useState("");
  const [rangeIdx, setRangeIdx] = useState(2);
  const [view, setView] = useState<View>("total");
  const idsKey = accounts.map((a) => a.id).sort().join(",");
  const days = RANGES[rangeIdx].days;

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    setError("");
    getInvestmentHistory(idsKey.split(","), days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load history"); });
    return () => { cancelled = true; };
  }, [idsKey, days]);

  const accountIds = useMemo(() => {
    if (!data) return [];
    // Largest accounts first so the stack's bottom layers are the stable ones
    const latest = data.series[data.series.length - 1]?.accounts ?? {};
    return Object.keys(latest).sort((a, b) => Number(latest[b]) - Number(latest[a]));
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (view === "bucket") return bucketRows(data, accounts);
    return data.series.map((p) => {
      const row: Record<string, number | string> = { date: p.date, value: Number(p.value) };
      if (view === "account") for (const id of accountIds) row[id] = Number(p.accounts[id] ?? 0);
      return row;
    });
  }, [data, view, accounts, accountIds]);

  if (accounts.length === 0) return null;
  if (error) {
    return (
      <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-red-600">
        Portfolio history couldn&apos;t load: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mb-5 bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-gray-400">
        Loading portfolio history…
      </div>
    );
  }

  const s = data.summary;
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Closed account";
  const buckets = BUCKET_ORDER.filter((b) => rows.some((r) => Number(r[b] ?? 0) > 0.5));
  const layers: { key: string; label: string; color: string }[] =
    view === "account"
      ? accountIds.map((id, i) => ({ key: id, label: accName(id), color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }))
      : view === "bucket"
        ? buckets.map((b) => ({ key: b, label: BUCKET_LABEL[b], color: BUCKET_COLOR[b] }))
        : [{ key: "value", label: "Portfolio value", color: "#2563eb" }];

  const spanDays = s?.days ?? 0;
  const fmtTick = (v: number) =>
    Math.abs(v) >= 1_000_000 ? `${fmt(v / 1_000_000, 1)}M` : Math.abs(v) >= 1000 ? `${fmt(v / 1000, 0)}k` : fmt(v, 0);
  const growth = s ? Number(s.growth) : 0;
  const contributions = s ? Number(s.contributions) : 0;

  return (
    <div className="mb-5 bg-white rounded-xl shadow border border-gray-100">
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Portfolio History</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.history_start
              ? <>Daily value of the accounts shown, recorded since {shortDate(data.history_start, true)}</>
              : "Daily value of the accounts shown"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
            {([["total", "Total"], ["account", "By account"], ["bucket", "By asset class"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded-md font-medium ${view === v ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setRangeIdx(i)}
                className={`px-2.5 py-1 rounded-md font-medium ${rangeIdx === i ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-100 border-b border-gray-100">
          <Stat label="Value" value={fmt(s.end_value)} sub={`from ${fmt(s.start_value)} over ${spanDays} day${spanDays !== 1 ? "s" : ""}`} />
          <Stat
            label="Market growth"
            value={`${growth >= 0 ? "+" : "−"}${fmt(Math.abs(growth))}`}
            tone={growth > 0 ? "up" : growth < 0 ? "down" : undefined}
            sub={`${contributions >= 0 ? "+" : "−"}${fmt(Math.abs(contributions))} net contributions`}
          />
          <Stat
            label="Time-weighted return"
            value={pct(s.time_weighted_return, 2)}
            tone={(s.time_weighted_return ?? 0) > 0 ? "up" : (s.time_weighted_return ?? 0) < 0 ? "down" : undefined}
            sub="Excludes the effect of deposits"
          />
          <Stat
            label="From peak"
            value={s.drawdown < -0.0005 ? pct(s.drawdown, 1) : "At peak"}
            tone={s.drawdown < -0.0005 ? "down" : undefined}
            sub={`Peak ${fmt(s.all_time_high)} on ${shortDate(s.all_time_high_date, false)}`}
          />
        </div>
      )}

      {rows.length < 2 ? (
        <p className="px-5 py-10 text-center text-xs text-gray-400">
          {view === "bucket" && data.series.length >= 2
            ? "Asset-class history starts the day positions were first recorded. It fills in as daily snapshots accumulate."
            : "Not enough history yet. A snapshot is taken every day, so the chart fills in over the coming days."}
        </p>
      ) : (
        <div className="px-3 pt-4 pb-1">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#e4e8ed" strokeOpacity={0.5} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => shortDate(d, spanDays > 120)}
                tick={{ fontSize: 10, fill: "#7a8fa6" }} axisLine={false} tickLine={false} minTickGap={24}
              />
              <YAxis
                tickFormatter={fmtTick} tick={{ fontSize: 10, fill: "#7a8fa6" }} axisLine={false} tickLine={false} width={56}
                domain={view === "total" ? ["auto", "auto"] : [0, "auto"]}
              />
              <ChartTooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                labelFormatter={(d: string) => new Date(`${d}T00:00:00`).toLocaleDateString()}
                formatter={(v: number, key: string) => [fmt(v), layers.find((l) => l.key === key)?.label ?? key]}
              />
              {layers.map((l) => (
                <Area
                  key={l.key}
                  type="monotone"
                  dataKey={l.key}
                  stackId={view === "total" ? undefined : "1"}
                  stroke={l.color}
                  fill={l.color}
                  fillOpacity={view === "total" ? 0.12 : 0.55}
                  strokeWidth={view === "total" ? 2 : 1}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          {view !== "total" && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-[10px] text-gray-400">
              {layers.map((l) => (
                <span key={l.key} className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />{l.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="px-5 py-2.5 border-t border-gray-100 text-[10px] text-gray-400">
        Contributions are transfers in and out of these accounts. Securities moved in with no amount recorded count as growth.
      </p>
    </div>
  );
}
