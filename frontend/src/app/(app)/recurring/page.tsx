"use client";

import { useEffect, useState } from "react";
import {
  detectRecurring,
  confirmRecurring,
  listRecurring,
  updateRecurring,
  deleteRecurring,
  RecurringCandidate,
  RecurringTransaction,
} from "@/lib/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val));
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

const FREQ_LABEL: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

const FREQ_COLOR: Record<string, string> = {
  weekly:    "bg-blue-100 text-blue-700",
  biweekly:  "bg-cyan-100 text-cyan-700",
  monthly:   "bg-green-100 text-green-700",
  quarterly: "bg-orange-100 text-orange-700",
  annual:    "bg-purple-100 text-purple-700",
};

function FreqBadge({ freq }: { freq: string }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${FREQ_COLOR[freq] ?? "bg-gray-100 text-gray-600"}`}>
      {FREQ_LABEL[freq] ?? freq}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 45 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">{pct}%</span>
    </div>
  );
}

// ─── Saved Recurring Row ──────────────────────────────────────────────────────

function SavedRow({
  rec,
  onToggle,
  onDelete,
}: {
  rec: RecurringTransaction;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0 ${!rec.is_active ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-sm font-semibold text-gray-500">
          {rec.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{rec.name}</p>
          {rec.merchant_name && rec.merchant_name !== rec.name && (
            <p className="text-xs text-gray-400 truncate">{rec.merchant_name}</p>
          )}
        </div>
        <FreqBadge freq={rec.frequency} />
        {!rec.is_active && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Paused</span>
        )}
      </div>
      <div className="flex items-center gap-4 shrink-0 ml-4">
        <p className="text-sm font-semibold text-gray-900">{fmt(rec.amount)}</p>
        <button
          onClick={() => onToggle(rec.id, !rec.is_active)}
          title={rec.is_active ? "Pause" : "Resume"}
          className="text-gray-400 hover:text-gray-700 transition"
        >
          {rec.is_active ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => onDelete(rec.id)}
          className="text-gray-300 hover:text-red-500 transition"
          title="Remove"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Candidate Row ────────────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  checked,
  onCheck,
}: {
  candidate: RecurringCandidate;
  checked: boolean;
  onCheck: (key: string, val: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-4 px-5 py-3 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 transition ${checked ? "bg-blue-50/50" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheck(candidate.key, e.target.checked)}
        className="w-4 h-4 accent-blue-600 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{candidate.name}</p>
          <FreqBadge freq={candidate.frequency} />
        </div>
        <div className="flex items-center gap-4 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-400">{candidate.occurrences} occurrences</span>
          <span className="text-xs text-gray-400">Last: {fmtDate(candidate.last_date)}</span>
          <span className="text-xs text-gray-400">Next ~{fmtDate(candidate.next_expected)}</span>
        </div>
      </div>
      <div className="shrink-0 text-right flex flex-col items-end gap-1">
        <p className="text-sm font-semibold text-gray-900">{fmt(candidate.amount)}</p>
        <ConfidenceBar value={candidate.confidence} />
      </div>
    </label>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RecurringPage() {
  const [saved, setSaved] = useState<RecurringTransaction[]>([]);
  const [candidates, setCandidates] = useState<RecurringCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detecting, setDetecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Load saved recurring on mount
  useEffect(() => {
    listRecurring()
      .then(setSaved)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  async function handleDetect() {
    setDetecting(true);
    setError("");
    setCandidates(null);
    setSelected(new Set());
    try {
      const results = await detectRecurring();
      // Filter out already-saved ones (match by name+frequency)
      const savedKeys = new Set(saved.map((s) => `${s.name.toLowerCase()}|${s.frequency}`));
      const filtered = results.filter(
        (c) => !savedKeys.has(`${c.name.toLowerCase()}|${c.frequency}`)
      );
      setCandidates(filtered);
      if (filtered.length === 0) {
        setSuccessMsg("No new recurring patterns found.");
        setTimeout(() => setSuccessMsg(""), 4000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  function handleCheck(key: string, val: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      val ? next.add(key) : next.delete(key);
      return next;
    });
  }

  function handleSelectAll() {
    if (!candidates) return;
    if (selected.size === candidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(candidates.map((c) => c.key)));
    }
  }

  async function handleConfirm() {
    if (!candidates || selected.size === 0) return;
    setConfirming(true);
    setError("");
    try {
      const toSave = candidates.filter((c) => selected.has(c.key));
      const newlySaved = await confirmRecurring(toSave);
      setSaved((prev) => [...prev, ...newlySaved]);
      setCandidates(null);
      setSelected(new Set());
      setSuccessMsg(`${newlySaved.length} recurring transaction${newlySaved.length !== 1 ? "s" : ""} saved.`);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setConfirming(false);
    }
  }

  async function handleToggle(id: string, active: boolean) {
    setLoadingId(id);
    try {
      const updated = await updateRecurring(id, { is_active: active });
      setSaved((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id: string) {
    setLoadingId(id);
    try {
      await deleteRecurring(id);
      setSaved((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setLoadingId(null);
    }
  }

  const activeCount = saved.filter((r) => r.is_active).length;
  const monthlyTotal = saved
    .filter((r) => r.is_active && r.frequency === "monthly")
    .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Recurring Transactions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Auto-detect subscriptions, bills, and regular payments from your transaction history.
          </p>
        </div>
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          {detecting ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Analysing…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 20v-5h-.581M5.072 9A8.001 8.001 0 0119.938 15M18.928 15A8.001 8.001 0 015.062 9" />
              </svg>
              Run Detection
            </>
          )}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}
      {successMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">{successMsg}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Active Recurring</p>
          <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
          <p className="text-xs text-gray-400 mt-1">{saved.length} total tracked</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Monthly Spend</p>
          <p className="text-2xl font-bold text-blue-600">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(monthlyTotal)}
          </p>
          <p className="text-xs text-gray-400 mt-1">From monthly-frequency items</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Annual Spend</p>
          <p className="text-2xl font-bold text-purple-600">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(monthlyTotal * 12)}
          </p>
          <p className="text-xs text-gray-400 mt-1">Monthly × 12 estimate</p>
        </div>
      </div>

      {/* Detection Results */}
      {candidates !== null && (
        <div className="bg-white rounded-xl shadow border border-gray-100 mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">
                {candidates.length === 0
                  ? "No new patterns detected"
                  : `${candidates.length} pattern${candidates.length !== 1 ? "s" : ""} detected`}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {candidates.length > 0
                  ? "Check the ones you want to track, then click Save."
                  : "All detected patterns are already saved, or no patterns were found."}
              </p>
            </div>
            {candidates.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSelectAll}
                  className="text-sm text-blue-600 hover:text-blue-800 transition font-medium"
                >
                  {selected.size === candidates.length ? "Deselect All" : "Select All"}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={selected.size === 0 || confirming}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                >
                  {confirming ? "Saving…" : `Save ${selected.size > 0 ? selected.size : ""} Selected`}
                </button>
                <button
                  onClick={() => { setCandidates(null); setSelected(new Set()); }}
                  className="text-sm text-gray-400 hover:text-gray-600 transition"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {candidates.length > 0 && (
            <>
              {/* Column headers */}
              <div className="grid grid-cols-[auto_1fr_auto] items-center px-5 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide font-medium gap-4">
                <span className="w-4" />
                <span>Merchant / Pattern</span>
                <span className="text-right">Amount &amp; Confidence</span>
              </div>
              <div>
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.key}
                    candidate={c}
                    checked={selected.has(c.key)}
                    onCheck={handleCheck}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Saved Recurring List */}
      <div className="bg-white rounded-xl shadow border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Saved Recurring</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {saved.length === 0
              ? "Run detection above to find and save your first recurring transactions."
              : `${saved.length} item${saved.length !== 1 ? "s" : ""} tracked`}
          </p>
        </div>

        {saved.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-gray-400 text-sm">No recurring transactions saved yet.</p>
            <p className="text-gray-400 text-xs mt-1">Click "Run Detection" to scan your history.</p>
          </div>
        ) : (
          <>
            {/* Group by frequency */}
            {(["weekly", "biweekly", "monthly", "quarterly", "annual"] as const).map((freq) => {
              const group = saved.filter((r) => r.frequency === freq);
              if (group.length === 0) return null;
              const groupTotal = group.filter((r) => r.is_active).reduce((s, r) => s + Number(r.amount), 0);
              return (
                <div key={freq}>
                  <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <FreqBadge freq={freq} />
                    <span className="text-xs text-gray-400">
                      {group.length} item{group.length !== 1 ? "s" : ""} · {fmt(groupTotal)} active
                    </span>
                  </div>
                  {group.map((rec) => (
                    <SavedRow
                      key={rec.id}
                      rec={rec}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
