"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, ReferenceLine,
} from "recharts";

interface MonthlyTrendPoint {
  key: string;
  label: string;
  expenses: number;
  income: number;
}

interface NamedAmount {
  name: string;
  amount: number;
}

interface PersonBreakdown {
  id: string;
  name: string;
  income: number;
  expenses: number;
}

interface TransactionsChartsProps {
  monthlyTrend: MonthlyTrendPoint[];
  monthlyTrendAverages: { income: number; expenses: number };
  categorySpend: NamedAmount[];
  merchantSpend: NamedAmount[];
  personBreakdown: PersonBreakdown[];
  totalExpenses: number;
  fmt: (value: number) => string;
}

export default function TransactionsCharts({
  monthlyTrend,
  monthlyTrendAverages,
  categorySpend,
  merchantSpend,
  personBreakdown,
  totalExpenses,
  fmt,
}: TransactionsChartsProps) {
  return (
    <div className="flex flex-col gap-4">

      {/* Row 1: Monthly Cash Flow + Top Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Monthly Cash Flow */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Monthly Cash Flow</p>
              <p className="text-xs text-gray-400 mt-0.5">Income vs expenses over time</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-finance-500 inline-block" />Income</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />Expenses</span>
            </div>
          </div>
          {monthlyTrend.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyTrend} barSize={12} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="4 4" stroke="#e4e8ed" strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#7a8fa6" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} width={42} tick={{ fontSize: 11, fill: "#7a8fa6" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number, name: string) => [fmt(v), name.charAt(0).toUpperCase() + name.slice(1)]} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #c8d2db", boxShadow: "0 4px 12px rgba(0,51,102,0.08)" }} cursor={{ fill: "rgba(0,51,102,0.03)" }} />
                <Bar dataKey="income"   name="income"   fill="#007A33" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <ReferenceLine
                  y={monthlyTrendAverages.income}
                  stroke="#007A33"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{ value: `Avg ${fmt(monthlyTrendAverages.income)}`, position: "insideTopLeft", fontSize: 10, fill: "#007A33" }}
                />
                <ReferenceLine
                  y={monthlyTrendAverages.expenses}
                  stroke="#f43f5e"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{ value: `Avg ${fmt(monthlyTrendAverages.expenses)}`, position: "insideBottomLeft", fontSize: 10, fill: "#f43f5e" }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Spending Categories */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
          <div className="mb-4">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Top Spending</p>
            <p className="text-xs text-gray-400 mt-0.5">By category this period</p>
          </div>
          {categorySpend.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No expense data</p>
          ) : (
            <div className="space-y-3">
              {categorySpend.map(({ name, amount }, idx) => {
                const pct = Math.round((amount / totalExpenses) * 100);
                const barPct = Math.round((amount / categorySpend[0].amount) * 100);
                const barColors = [
                  "bg-gradient-to-r from-indigo-400 to-indigo-500",
                  "bg-gradient-to-r from-violet-400 to-violet-500",
                  "bg-gradient-to-r from-blue-400 to-blue-500",
                  "bg-gradient-to-r from-sky-400 to-sky-500",
                  "bg-gradient-to-r from-teal-400 to-teal-500",
                  "bg-gradient-to-r from-cyan-400 to-cyan-500",
                ];
                return (
                  <div key={name} className="group">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-4 h-4 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">{name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">{pct}%</span>
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0 tabular-nums ml-1">{fmt(amount)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden ml-6">
                      <div className={`h-full ${barColors[idx % barColors.length]} rounded-full transition-all duration-700 ease-out`} style={{ width: `${barPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Top Merchants by Spending */}
      {merchantSpend.length > 0 && (() => {
        const MERCHANT_COLORS = ["#003366", "#007A33", "#0ea5e9", "#8b5cf6", "#14b8a6", "#94a3b8"];
        const merchantTotal = merchantSpend.reduce((s, m) => s + m.amount, 0);
        return (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Top Merchants</p>
                <p className="text-xs text-gray-400 mt-0.5">Where your money goes — top 5 + everything else</p>
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{fmt(merchantTotal)} total</span>
            </div>
            <div className="flex flex-col lg:flex-row gap-6 items-center">
              {/* Donut chart */}
              <div className="shrink-0">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={merchantSpend}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={82}
                      paddingAngle={2}
                      dataKey="amount"
                      stroke="none"
                    >
                      {merchantSpend.map((_, i) => (
                        <Cell key={i} fill={MERCHANT_COLORS[i % MERCHANT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => [fmt(v), ""]}
                      contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Legend list */}
              <div className="flex-1 w-full space-y-2.5">
                {merchantSpend.map(({ name, amount }, idx) => {
                  const pct = Math.round((amount / merchantTotal) * 100);
                  const barPct = Math.round((amount / merchantSpend[0].amount) * 100);
                  const isOther = name === "Everything Else";
                  return (
                    <div key={name}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: MERCHANT_COLORS[idx % MERCHANT_COLORS.length] }} />
                        <span className={`text-xs font-medium truncate flex-1 ${isOther ? "text-gray-400 dark:text-gray-500 italic" : "text-gray-700 dark:text-gray-300"}`}>{name}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums shrink-0">{pct}%</span>
                        <span className={`text-xs font-semibold tabular-nums shrink-0 ml-1 ${isOther ? "text-gray-400 dark:text-gray-500" : "text-gray-700 dark:text-gray-300"}`}>{fmt(amount)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden ml-4">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${barPct}%`, backgroundColor: MERCHANT_COLORS[idx % MERCHANT_COLORS.length], opacity: isOther ? 0.5 : 1 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Row 3: Income & Spending by Person */}
      {personBreakdown.length > 1 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">By Person</p>
              <p className="text-xs text-gray-400 mt-0.5">Who's earning and spending this period</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-finance-500 inline-block" />Income</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />Expenses</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={personBreakdown} barSize={28} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="4 4" stroke="#e4e8ed" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#7a8fa6" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} width={42} tick={{ fontSize: 11, fill: "#7a8fa6" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number, name: string) => [fmt(v), name.charAt(0).toUpperCase() + name.slice(1)]} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #c8d2db", boxShadow: "0 4px 12px rgba(0,51,102,0.08)" }} cursor={{ fill: "rgba(0,51,102,0.03)" }} />
              <Bar dataKey="income"   name="income"   fill="#007A33" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">Joint/shared accounts are split proportionally by each person's income share.</p>
        </div>
      )}

    </div>
  );
}
