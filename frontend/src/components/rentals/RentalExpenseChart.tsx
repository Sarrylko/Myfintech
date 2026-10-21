"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { ExpenseBreakdown } from "@/lib/api";

export type ChartRow = { name: string; Payments: number } & Record<string, number>;

interface RentalExpenseChartProps {
  chartData: ChartRow[];
  activeExpBars: { key: keyof ExpenseBreakdown; label: string; color: string }[];
  fmtTick: (v: number) => string;
  fmtM: (n: number | null | undefined) => string;
}

export default function RentalExpenseChart({ chartData, activeExpBars, fmtTick, fmtM }: RentalExpenseChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barCategoryGap="35%">
        <CartesianGrid strokeDasharray="4 4" stroke="#e4e8ed" strokeOpacity={0.5} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#7a8fa6" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtTick} tick={{ fontSize: 11, fill: "#7a8fa6" }} axisLine={false} tickLine={false} width={52} />
        <ChartTooltip
          formatter={(value: number, name: string) => [
            fmtM(value),
            name,
          ]}
          contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #c8d2db", boxShadow: "0 4px 12px rgba(0,51,102,0.08)" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* Payments bar — teal */}
        <Bar dataKey="Payments" name="Payments (Collected)" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={80} />
        {/* Stacked expense breakdown bars */}
        {activeExpBars.map((b, i) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.label}
            fill={b.color}
            stackId="exp"
            radius={i === activeExpBars.length - 1 ? [4, 4, 0, 0] : undefined}
            maxBarSize={80}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
