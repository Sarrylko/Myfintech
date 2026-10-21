"use client";

import { useEffect, useRef, useState } from "react";
import { SavedTransactionView, getTransactionViews, saveTransactionViews } from "@/lib/api";

interface Props {
  /** The current filters as a URL query string */
  currentQuery: string;
  onApply: (query: string) => void;
}

export default function SavedViewsMenu({ currentQuery, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedTransactionView[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { getTransactionViews().then(setViews).catch(() => {}); }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = views.find((v) => v.query === currentQuery);

  async function persist(next: SavedTransactionView[]) {
    const prev = views;
    setViews(next);
    setError("");
    try {
      setViews(await saveTransactionViews(next));
    } catch (e) {
      setViews(prev);
      setError(e instanceof Error ? e.message : "Couldn't save views");
    }
  }

  function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = views.find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
    const next = existing
      ? views.map((v) => (v.id === existing.id ? { ...v, query: currentQuery } : v))
      // crypto.randomUUID needs a secure context; the app is also served over plain http
      : [...views, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: trimmed, query: currentQuery }];
    setName("");
    persist(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition text-sm font-medium"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
        <span className="max-w-[10rem] truncate">{active ? active.name : "Views"}</span>
      </button>

      {open && (
        <div className="absolute z-40 right-0 mt-1 w-[calc(100vw-2rem)] max-w-[18rem] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl">
          <ul className="max-h-72 overflow-y-auto py-1">
            {views.length === 0 && (
              <li className="px-3 py-3 text-xs text-gray-400">No saved views yet. Set up your filters, then name and save them below.</li>
            )}
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-1 px-1.5">
                <button
                  type="button"
                  onClick={() => { onApply(v.query); setOpen(false); }}
                  className={`flex-1 min-w-0 text-left text-sm px-2 py-1.5 rounded-md truncate hover:bg-gray-50 dark:hover:bg-slate-700/50 ${
                    v.id === active?.id ? "font-semibold text-primary-700 dark:text-primary-300" : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  title={`Delete "${v.name}"`}
                  onClick={() => persist(views.filter((x) => x.id !== v.id))}
                  className="w-6 h-6 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 text-xs"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => { e.preventDefault(); saveCurrent(); }}
            className="border-t border-gray-100 dark:border-slate-700 p-2.5 flex items-center gap-2"
          >
            <input
              type="text"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name current filters…"
              className="flex-1 min-w-0 border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-slate-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white disabled:opacity-40"
            >
              Save
            </button>
          </form>
          {error && <p className="px-3 pb-2.5 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
