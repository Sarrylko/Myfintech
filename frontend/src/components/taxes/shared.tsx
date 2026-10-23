"use client";

import React from "react";

// Shared building blocks for the Tax Center tabs. Money arrives from the API
// as decimal strings; `num` turns it into a number for math and formatting.

export const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

export const FILING_LABEL: Record<string, string> = {
  single: "Single",
  mfj: "Married filing jointly",
  mfs: "Married filing separately",
  hoh: "Head of household",
};

export const CLASS_LABEL: Record<string, string> = {
  schedule_c: "Sole prop / Schedule C",
  partnership: "Partnership (K-1)",
  s_corp: "S-corp (K-1)",
  c_corp: "C-corp",
};

export function Panel({ title, note, right, children, className = "" }: {
  title?: string; note?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2 flex-wrap">
          <div className="min-w-0">
            {title && <p className="text-sm font-semibold text-gray-800">{title}</p>}
            {note && <p className="text-xs text-gray-500 mt-0.5">{note}</p>}
          </div>
          {right}
        </div>
      )}
      <div className={title || right ? "px-5 pb-5" : "p-5"}>{children}</div>
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: {
  label: string; value: string; sub?: React.ReactNode; tone?: "good" | "bad" | "accent";
}) {
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600"
    : tone === "accent" ? "text-indigo-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 min-w-0">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

/** One line of a 1040-style statement. */
export function Line({ label, value, strong, indent, muted, hint }: {
  label: React.ReactNode; value: string; strong?: boolean; indent?: boolean; muted?: boolean; hint?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "border-t border-gray-200 mt-1 pt-2" : ""}`}>
      <span className={`text-sm ${indent ? "pl-4" : ""} ${strong ? "font-semibold text-gray-900" : muted ? "text-gray-400" : "text-gray-600"}`}>
        {label}
        {hint && <span className="ml-1.5 text-[11px] text-gray-400">{hint}</span>}
      </span>
      <span className={`text-sm tabular-nums ${strong ? "font-semibold text-gray-900" : muted ? "text-gray-400" : "text-gray-800"}`}>
        {value}
      </span>
    </div>
  );
}

export function ScopeBadge({ scope }: { scope: string }) {
  const cls = scope === "business" ? "bg-amber-50 text-amber-700"
    : scope === "rental" ? "bg-teal-50 text-teal-700" : "bg-indigo-50 text-indigo-700";
  return <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}>{scope}</span>;
}

export function ConfidenceDot({ level }: { level: "high" | "medium" | "low" }) {
  const cls = level === "high" ? "bg-emerald-500" : level === "medium" ? "bg-amber-400" : "bg-gray-300";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title={`${level} confidence`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cls}`} />{level}
    </span>
  );
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function daysUntil(iso: string): number {
  const d = new Date(`${iso}T00:00:00`).getTime();
  return Math.ceil((d - Date.now()) / 86_400_000);
}
