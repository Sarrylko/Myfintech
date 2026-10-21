"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReportType } from "@/lib/api";
import { REPORT_TYPE_LABELS } from "@/lib/reportTypes";
import type { CategoryMode } from "@/lib/transactionFilters";

export type { CategoryMode };

export interface CategoryGroupOption {
  group: string;
  count: number;
  items: { key: string; label: string; count: number }[];
}

interface Props {
  options: CategoryGroupOption[];
  filter: Record<string, CategoryMode>;
  onFilterChange: (next: Record<string, CategoryMode>) => void;
  /** Effective report type for a category key (override → default → by-sign). */
  reportTypeOf: (key: string) => ReportType;
  onReportTypeChange: (key: string, type: ReportType) => void;
}

const MODE_BTN =
  "w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center border transition";

function ModeButtons({
  mode,
  onSet,
}: {
  mode: CategoryMode | undefined;
  onSet: (m: CategoryMode | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        title="Only show this category"
        onClick={() => onSet(mode === "include" ? undefined : "include")}
        className={`${MODE_BTN} ${
          mode === "include"
            ? "bg-emerald-500 border-emerald-500 text-white"
            : "border-gray-200 dark:border-slate-600 text-gray-400 hover:border-emerald-400 hover:text-emerald-600"
        }`}
      >
        ✓
      </button>
      <button
        type="button"
        title="Hide this category"
        onClick={() => onSet(mode === "exclude" ? undefined : "exclude")}
        className={`${MODE_BTN} ${
          mode === "exclude"
            ? "bg-red-500 border-red-500 text-white"
            : "border-gray-200 dark:border-slate-600 text-gray-400 hover:border-red-400 hover:text-red-600"
        }`}
      >
        ✕
      </button>
    </div>
  );
}

function ReportTypeSelect({
  value,
  onChange,
}: {
  value: ReportType;
  onChange: (t: ReportType) => void;
}) {
  return (
    <select
      title="How this category counts in totals and charts"
      value={value}
      onChange={(e) => onChange(e.target.value as ReportType)}
      className={`text-[11px] rounded-md border px-1.5 py-0.5 bg-white dark:bg-slate-800 shrink-0 w-36 ${
        value === "cashflow"
          ? "border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400"
          : value === "savings"
            ? "border-violet-300 text-violet-700 dark:text-violet-300"
            : "border-amber-300 text-amber-700 dark:text-amber-300"
      }`}
    >
      {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((t) => (
        <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
      ))}
    </select>
  );
}

export default function CategoryFilter({
  options,
  filter,
  onFilterChange,
  reportTypeOf,
  onReportTypeChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const includeCount = Object.values(filter).filter((m) => m === "include").length;
  const excludeCount = Object.values(filter).filter((m) => m === "exclude").length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options
      .map((g) => {
        if (g.group.toLowerCase().includes(q)) return g;
        const items = g.items.filter((i) => i.label.toLowerCase().includes(q));
        return items.length ? { ...g, items } : null;
      })
      .filter((g): g is CategoryGroupOption => g !== null);
  }, [options, query]);

  function setMode(key: string, mode: CategoryMode | undefined) {
    const next = { ...filter };
    if (mode) next[key] = mode;
    else delete next[key];
    onFilterChange(next);
  }

  function toggleExpanded(group: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div className="relative md:w-52" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <span className="truncate">Categories</span>
        <span className="flex items-center gap-1">
          {includeCount > 0 && (
            <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 rounded px-1.5">
              {includeCount} in
            </span>
          )}
          {excludeCount > 0 && (
            <span className="text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded px-1.5">
              {excludeCount} out
            </span>
          )}
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </span>
      </button>

      {open && (
        <div className="absolute z-40 mt-1 left-0 w-[calc(100vw-2rem)] max-w-[30rem] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl">
          <div className="p-2.5 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Search categories…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-slate-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {(includeCount > 0 || excludeCount > 0) && (
              <button
                type="button"
                onClick={() => onFilterChange({})}
                className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 whitespace-nowrap"
              >
                Reset
              </button>
            )}
          </div>
          <div className="px-3 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-slate-700">
            <span>✓ only · ✕ hide</span>
            <span className="w-36">Counts as</span>
          </div>
          <ul className="max-h-96 overflow-y-auto py-1">
            {visible.length === 0 && (
              <li className="px-3 py-4 text-sm text-gray-400 text-center">No categories match</li>
            )}
            {visible.map((g) => {
              const isOpen = expanded.has(g.group) || query.trim() !== "";
              return (
                <li key={g.group}>
                  <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <ModeButtons mode={filter[g.group]} onSet={(m) => setMode(g.group, m)} />
                    <button
                      type="button"
                      onClick={() => g.items.length && toggleExpanded(g.group)}
                      className="flex-1 min-w-0 flex items-center gap-1 text-left text-sm text-gray-800 dark:text-gray-200"
                    >
                      {g.items.length > 0 && (
                        <svg className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      )}
                      <span className="truncate font-medium">{g.group}</span>
                      <span className="text-xs text-gray-400 shrink-0">{g.count}</span>
                    </button>
                    <ReportTypeSelect
                      value={reportTypeOf(g.group)}
                      onChange={(t) => onReportTypeChange(g.group, t)}
                    />
                  </div>
                  {isOpen && g.items.map((item) => (
                    <div key={item.key} className="flex items-center gap-2 pl-8 pr-3 py-1 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                      <ModeButtons mode={filter[item.key]} onSet={(m) => setMode(item.key, m)} />
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-600 dark:text-gray-300">
                        {item.label} <span className="text-xs text-gray-400">{item.count}</span>
                      </span>
                      <ReportTypeSelect
                        value={reportTypeOf(item.key)}
                        onChange={(t) => onReportTypeChange(item.key, t)}
                      />
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
