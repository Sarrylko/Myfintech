"use client";

import { useState } from "react";
import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { useCurrency } from "@/lib/currency";
import { linearTrend } from "@/lib/chartMath";
import type { NetWorthSnapshot } from "@/lib/api";

type TimeRange = "30D" | "90D" | "1Y" | "All";

const METRICS = [
  { key: "net_worth",        label: "Net Worth",    color: "#003366" },
  { key: "total_cash",       label: "Cash",         color: "#007A33" },
  { key: "total_investments",label: "Investments",  color: "#0ea5e9" },
  { key: "total_real_estate",label: "Real Estate",  color: "#f59e0b" },
  { key: "total_debts",      label: "Liabilities",  color: "#f43f5e" },
] as const;

function HistoryTooltip({ active, payload, label }: { active?: boolean; payload?: {name: string; value: number; color: string}[]; label?: string }) {
  const { fmtCompact } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl shadow-xl p-3.5 text-xs min-w-[170px]">
      <p className="text-gray-400 dark:text-gray-500 font-medium mb-2.5 pb-2 border-b border-gray-50 dark:border-slate-700">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between items-center gap-4 mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-600 dark:text-gray-400">{entry.name}</span>
          </div>
          <span className="font-bold text-gray-900 dark:text-white tabular-nums">{fmtCompact(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function FinancialHistoryChart({
  snapshots,
  onTakeSnapshot,
}: {
  snapshots: NetWorthSnapshot[];
  onTakeSnapshot: () => Promise<void>;
}) {
  const { fmtCompact, locale } = useCurrency();
  const [timeRange, setTimeRange] = useState<TimeRange>("90D");
  const [visible, setVisible] = useState<Set<string>>(new Set(["net_worth", "total_debts"]));
  const [showTrend, setShowTrend] = useState(true);
  const [saving, setSaving] = useState(false);

  const rangeDays: Record<TimeRange, number> = { "30D": 30, "90D": 90, "1Y": 365, "All": 99999 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays[timeRange]);

  const rawFiltered = snapshots.filter((s) => new Date(s.snapshot_date) >= cutoff);

  const filtered = rawFiltered.map((s) => ({
    date: new Date(s.snapshot_date.substring(0, 10) + "T00:00:00").toLocaleDateString(locale, { month: "short", day: "numeric" }),
    net_worth:         parseFloat(s.net_worth),
    total_cash:        parseFloat(s.total_cash),
    total_investments: parseFloat(s.total_investments),
    total_real_estate: parseFloat(s.total_real_estate),
    total_debts:       parseFloat(s.total_debts),
  }));

  // Compute linear regression trend for each visible metric
  const trendData = filtered.map((row, i) => {
    const out: Record<string, number | null> = { ...row };
    for (const { key } of METRICS) {
      const vals = filtered.map((r) => (r as Record<string, number>)[key] ?? null);
      const trend = linearTrend(vals);
      out[`${key}_trend`] = trend[i];
    }
    return out;
  });

  // Net worth change over the period
  const firstNW = filtered[0]?.net_worth ?? 0;
  const lastNW  = filtered[filtered.length - 1]?.net_worth ?? 0;
  const nwChange = lastNW - firstNW;
  const nwChangePct = firstNW !== 0 ? (nwChange / Math.abs(firstNW)) * 100 : 0;

  function toggleMetric(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }

  async function handleSnapshot() {
    setSaving(true);
    try { await onTakeSnapshot(); } finally { setSaving(false); }
  }

  return (
    <Card className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Financial History</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-gray-400">Daily snapshots · {filtered.length} data points</p>
            {filtered.length >= 2 && (
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                nwChange >= 0
                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
              }`}>
                {nwChange >= 0 ? "▲" : "▼"} {fmtCompact(Math.abs(nwChange))} ({Math.abs(nwChangePct).toFixed(1)}%) this period
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Trendline toggle */}
          <button
            onClick={() => setShowTrend((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
              showTrend
                ? "bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-900/20 dark:border-violet-700 dark:text-violet-400"
                : "border-gray-200 text-gray-400 bg-white dark:bg-slate-800 dark:border-slate-600"
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
            </svg>
            Trendlines
          </button>
          {/* Time range tabs */}
          <div className="flex bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs">
            {(["30D", "90D", "1Y", "All"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  timeRange === r
                    ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {/* Take Snapshot button */}
          <button
            onClick={handleSnapshot}
            disabled={saving}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Take Snapshot"}
          </button>
        </div>
      </div>

      {/* Metric toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {METRICS.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => toggleMetric(key)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition font-medium ${
              visible.has(key)
                ? "border-transparent text-white shadow-sm"
                : "border-gray-200 dark:border-slate-600 text-gray-400 dark:text-gray-500 bg-white dark:bg-slate-800"
            }`}
            style={visible.has(key) ? { backgroundColor: color } : undefined}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: visible.has(key) ? "rgba(255,255,255,0.8)" : color }}
            />
            {label}
          </button>
        ))}
      </div>

      {/* Chart */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-50 dark:bg-slate-700 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-gray-300 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm mb-2">No historical data yet</p>
          <p className="text-gray-400 text-xs max-w-xs">
            Click <span className="font-medium text-blue-600">Take Snapshot</span> to start tracking.
            After that, the daily task captures data automatically at 7 AM UTC.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={290}>
          <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              {METRICS.map(({ key, color }) => (
                <linearGradient key={key} id={`grad-hist-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="80%" stopColor={color} stopOpacity={0.03} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="4 4"
              stroke="#e4e8ed"
              strokeOpacity={0.5}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#7a8fa6" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              padding={{ left: 8, right: 8 }}
            />
            <YAxis
              tickFormatter={fmtCompact}
              tick={{ fontSize: 11, fill: "#7a8fa6" }}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip
              content={<HistoryTooltip />}
              cursor={{ stroke: "#a0b3c4", strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.6 }}
            />
            {/* Area fills */}
            {METRICS.filter(({ key }) => visible.has(key)).map(({ key, label, color }) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-hist-${key})`}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "white", fill: color }}
              />
            ))}
            {/* Trendlines — dashed overlay */}
            {showTrend && METRICS.filter(({ key }) => visible.has(key)).map(({ key, label, color }) => (
              <Line
                key={`${key}_trend`}
                type="linear"
                dataKey={`${key}_trend`}
                name={`${label} trend`}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeOpacity={0.65}
                dot={false}
                activeDot={false}
                legendType="none"
                tooltipType="none"
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Trendline legend hint */}
      {filtered.length >= 2 && showTrend && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-50 dark:border-slate-700">
          <svg width="18" height="6" className="overflow-visible shrink-0">
            <line x1="0" y1="3" x2="18" y2="3" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.65" />
          </svg>
          <span className="text-xs text-gray-400 dark:text-gray-500">Dashed lines show linear trend for each metric</span>
        </div>
      )}
    </Card>
  );
}
