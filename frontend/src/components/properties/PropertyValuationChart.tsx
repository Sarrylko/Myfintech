"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface PropertyValuationChartProps {
  chartData: { date: string; value: number }[];
  fmt: (val: number) => string;
}

export default function PropertyValuationChart({ chartData, fmt }: PropertyValuationChartProps) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gradPropertyVal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.18} />
            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="#e4e8ed" strokeOpacity={0.5} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#7a8fa6" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: "#7a8fa6" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          width={52}
        />
        <Tooltip
          formatter={(v: number) => [fmt(v), "Value"]}
          contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #c8d2db", boxShadow: "0 4px 12px rgba(0,51,102,0.08)" }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#0ea5e9"
          strokeWidth={2}
          fill="url(#gradPropertyVal)"
          dot={{ r: 3, fill: "#0ea5e9", stroke: "white", strokeWidth: 1.5 }}
          activeDot={{ r: 5, stroke: "white", strokeWidth: 2, fill: "#0ea5e9" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
