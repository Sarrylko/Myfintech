"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
}

interface Props {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
}

const MAX_VISIBLE = 200;

export default function MultiSelectFilter({ label, options, selected, onChange, searchPlaceholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    // Selected options first so they're easy to untick
    return [...matches].sort((a, b) => Number(selectedSet.has(b.value)) - Number(selectedSet.has(a.value)));
  }, [options, query, selectedSet]);

  function toggle(value: string) {
    onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className="relative md:w-44" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-1">
          {selected.length > 0 && (
            <span className="text-[10px] font-semibold bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 rounded px-1.5">
              {selected.length}
            </span>
          )}
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </span>
      </button>

      {open && (
        <div className="absolute z-40 mt-1 left-0 w-[calc(100vw-2rem)] max-w-[20rem] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl">
          <div className="p-2.5 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
            <input
              autoFocus
              type="text"
              placeholder={searchPlaceholder ?? "Search…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-slate-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {selected.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                Reset
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {visible.length === 0 && <li className="px-3 py-4 text-sm text-gray-400 text-center">No matches</li>}
            {visible.slice(0, MAX_VISIBLE).map((o) => (
              <li key={o.value}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(o.value)}
                    onChange={() => toggle(o.value)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300">{o.label}</span>
                  {o.count !== undefined && <span className="text-xs text-gray-400 shrink-0">{o.count}</span>}
                </label>
              </li>
            ))}
            {visible.length > MAX_VISIBLE && (
              <li className="px-3 py-2 text-xs text-gray-400 text-center">
                {visible.length - MAX_VISIBLE} more — type to narrow down
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
