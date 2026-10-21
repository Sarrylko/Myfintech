"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useCurrency } from "@/lib/currency";
import type { ScenarioProjection } from "@/lib/api";

function ScenarioTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string | number }) {
  const { fmt: fmtRaw, fmtCompact } = useCurrency();
  function fmt(n: number, compact = false): string { return compact ? fmtCompact(n) : fmtRaw(n); }
  if (!active || !payload?.length) return null;
  // Filter out the invisible band-floor area; show only Expected and Target
  const visible = payload.filter(p => p.name === "Expected" || p.name === "Target");
  if (!visible.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 shadow-xl text-sm">
      <p className="text-slate-400 font-medium mb-2">Age {label}</p>
      {visible.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="text-white font-semibold">{fmt(p.value, true)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ScenarioChart({ data, retirementAge }: { data: ScenarioProjection[]; retirementAge: number }) {
  const chartData = data.map(d => ({
    ...d,
    bandTop: Math.max(0, d.optimistic - d.pessimistic),
  }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <defs>
          {/* Invisible floor — just pushes the stacked band up */}
          <linearGradient id="gradFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e293b" stopOpacity={0} />
            <stop offset="100%" stopColor="#1e293b" stopOpacity={0} />
          </linearGradient>
          {/* Visible band between pessimistic and optimistic */}
          <linearGradient id="gradBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="age" tick={{ fill: "#7a8fa6", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} tick={{ fill: "#7a8fa6", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
        <Tooltip content={<ScenarioTooltip />} />
        <ReferenceLine x={retirementAge} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3"
          label={{ value: `Retire ${retirementAge}`, fill: "#f59e0b", fontSize: 10, position: "insideTopRight" }} />
        {/* Target wealth dashed line */}
        <Area type="monotone" dataKey="required" stroke="#f59e0b" strokeWidth={1.5}
          strokeDasharray="5 3" fill="none" dot={false} name="Target" />
        {/* Band floor (pessimistic) — transparent fill, acts as base for stacking */}
        <Area type="monotone" dataKey="pessimistic" stroke="none"
          fill="url(#gradFloor)" dot={false} name="Poor Market" stackId="band" />
        {/* Band top (optimistic − pessimistic) — visible colored band */}
        <Area type="monotone" dataKey="bandTop" stroke="none"
          fill="url(#gradBand)" dot={false} name="Strong Market" stackId="band" />
        {/* Expected/median line drawn on top, no fill */}
        <Area type="monotone" dataKey="base" stroke="#818cf8" strokeWidth={2.5}
          fill="none" dot={false} name="Expected" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
