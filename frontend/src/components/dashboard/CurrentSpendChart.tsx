"use client";

import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { useCurrency } from "@/lib/currency";
import { linearTrend } from "@/lib/chartMath";
import type { Transaction } from "@/lib/api";

function buildSpendTimeline(transactions: Transaction[]) {
  const now = new Date();
  const thisYear = now.getFullYear(), thisMonth = now.getMonth();
  const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
  const lastYear = lastMonthDate.getFullYear(), lastMonth = lastMonthDate.getMonth();
  const daysInThis = new Date(thisYear, thisMonth + 1, 0).getDate();
  const daysInLast = new Date(lastYear, lastMonth + 1, 0).getDate();

  const thisMap: Record<number, number> = {};
  const lastMap: Record<number, number> = {};

  for (const t of transactions) {
    const amt = parseFloat(t.amount);
    if (amt <= 0 || t.is_ignored || t.pending) continue;
    const cat = (t.plaid_category ?? "").toLowerCase();
    if (cat.startsWith("transfer")) continue;
    const d = new Date(t.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth)
      thisMap[d.getDate()] = (thisMap[d.getDate()] || 0) + amt;
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth)
      lastMap[d.getDate()] = (lastMap[d.getDate()] || 0) + amt;
  }

  const maxDays = Math.max(daysInThis, daysInLast);
  const todayDay = now.getDate();
  let cumThis = 0, cumLast = 0;
  return Array.from({ length: maxDays }, (_, i) => {
    const day = i + 1;
    cumThis += thisMap[day] || 0;
    cumLast += lastMap[day] || 0;
    return {
      day,
      thisMonth: day <= todayDay ? parseFloat(cumThis.toFixed(2)) : null,
      lastMonth: day <= daysInLast ? parseFloat(cumLast.toFixed(2)) : null,
    };
  });
}

export default function CurrentSpendChart({ transactions }: { transactions: Transaction[] }) {
  const { fmt, locale } = useCurrency();
  const now = new Date();
  const todayDay = now.getDate();
  const data = buildSpendTimeline(transactions);

  // Compute trendline for this month's cumulative spend
  const thisMonthVals = data.map((d) => d.thisMonth);
  const trendVals = linearTrend(thisMonthVals);
  const chartData = data.map((d, i) => ({ ...d, trend: trendVals[i] }));

  const thisMonthSpend = data.find((d) => d.day === todayDay)?.thisMonth ?? data.filter((d) => d.thisMonth !== null).slice(-1)[0]?.thisMonth ?? 0;
  const lastMonthByToday = data[todayDay - 1]?.lastMonth ?? 0;
  const diff = thisMonthSpend - lastMonthByToday;
  const monthName = now.toLocaleString(locale, { month: "long" });
  const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString(locale, { month: "long" });

  // Pace: project end-of-month spend based on daily avg so far
  const avgPerDay = todayDay > 0 ? thisMonthSpend / todayDay : 0;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedTotal = avgPerDay * daysInMonth;

  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean; payload?: { value: number | null; name: string; color: string }[]; label?: number;
  }) => {
    if (!active || !payload?.length) return null;
    const visible = payload.filter((p) => p.value != null && p.name !== "trend");
    if (!visible.length) return null;
    return (
      <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl shadow-xl px-3.5 py-2.5 text-xs min-w-[160px]">
        <p className="text-gray-400 dark:text-gray-500 font-medium mb-2 pb-1.5 border-b border-gray-50 dark:border-slate-700">
          Day {label}
          {label === todayDay && <span className="ml-1.5 text-blue-500 font-semibold">· Today</span>}
        </p>
        {visible.map((p) => (
          <div key={p.name} className="flex justify-between items-center gap-4 mb-1">
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line react/forbid-dom-props */}
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              <span className="text-gray-500 dark:text-gray-400">
                {p.name === "thisMonth" ? monthName : lastMonthName}
              </span>
            </div>
            <span className="font-bold text-gray-900 dark:text-white tabular-nums">{fmt(p.value!)}</span>
          </div>
        ))}
        {visible.length === 2 && visible[0].value != null && visible[1].value != null && (
          <div className={`flex justify-between items-center gap-4 pt-1.5 mt-0.5 border-t border-gray-50 dark:border-slate-700 text-xs font-semibold ${
            visible[0].value - visible[1].value > 0 ? "text-amber-600" : "text-emerald-600"
          }`}>
            <span>Difference</span>
            <span className="tabular-nums">
              {visible[0].value - visible[1].value > 0 ? "▲" : "▼"} {fmt(Math.abs(visible[0].value - visible[1].value))}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="flex flex-col h-full">
      {/* Header row */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Current Spend</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
            {fmt(thisMonthSpend)}
          </p>
          {thisMonthSpend > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Pace: <span className="font-semibold text-gray-600 dark:text-gray-300">{fmt(projectedTotal)}</span> projected by month-end
            </p>
          )}
          {thisMonthSpend === 0 && (
            <p className="text-xs text-gray-400 mt-1">No transactions recorded for {monthName} yet</p>
          )}
        </div>
        {thisMonthSpend > 0 && diff !== 0 && lastMonthByToday > 0 && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full ${
            diff > 0 ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
          }`}>
            <span>{diff > 0 ? "▲" : "▼"}</span>
            <span>{fmt(Math.abs(diff))} {diff > 0 ? "more" : "less"} vs {lastMonthName}</span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="relative flex-1 min-h-0 mt-4 h-44">
        {thisMonthSpend === 0 && (
          <div className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none z-10">
            <p className="text-xs text-gray-300 bg-white/90 px-2 py-1 rounded">
              Sync accounts to see {monthName} spend
            </p>
          </div>
        )}
        {chartData.every((d) => !d.thisMonth && !d.lastMonth) ? (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            No transaction data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradThis" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#007A33" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#007A33" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradLast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#e4e8ed" strokeOpacity={0.5} vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#7a8fa6" }}
                tickLine={false}
                axisLine={false}
                ticks={[1, 7, 14, 21, 28]}
                tickFormatter={(d) => `${d}`}
              />
              <YAxis hide domain={["auto", "auto"]} />
              {/* Today vertical reference line */}
              <ReferenceLine
                x={todayDay}
                stroke="#007A33"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.4}
                label={{ value: "Today", position: "top", fontSize: 9, fill: "#007A33", fontWeight: 600 }}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: "#a0b3c4", strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.5 }}
              />
              <Area
                type="monotone"
                dataKey="lastMonth"
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="url(#gradLast)"
                dot={false}
                connectNulls
                name="lastMonth"
              />
              <Area
                type="monotone"
                dataKey="thisMonth"
                stroke="#007A33"
                strokeWidth={2}
                fill="url(#gradThis)"
                dot={false}
                connectNulls
                name="thisMonth"
                activeDot={{ r: 5, stroke: "white", strokeWidth: 2, fill: "#007A33" }}
              />
              {/* Trendline for this month */}
              <Line
                type="linear"
                dataKey="trend"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeOpacity={0.7}
                dot={false}
                activeDot={false}
                name="trend"
                legendType="none"
                tooltipType="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50 dark:border-slate-700">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 rounded bg-finance-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">{monthName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="2" className="overflow-visible"><line x1="0" y1="1" x2="20" y2="1" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">{lastMonthName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="2" className="overflow-visible"><line x1="0" y1="1" x2="20" y2="1" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.7" /></svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">Trend</span>
        </div>
      </div>
    </Card>
  );
}
