"use client";

import { useEffect, useState } from "react";
import { useCurrency } from "@/lib/currency";
import {
  detectRecurring,
  confirmRecurring,
  listRecurring,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  logRecurringPayment,
  deleteRecurringPayment,
  RecurringCandidate,
  RecurringTransaction,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const FREQ_LABEL: Record<string, string> = {
  weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly",
  quarterly: "Quarterly", annual: "Annual",
};
const FREQ_COLOR: Record<string, string> = {
  weekly: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  biweekly: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  monthly: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  quarterly: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  annual: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

const TAGS = [
  { value: "home",          label: "Home",          icon: "🏠", color: "#6366f1" },
  { value: "personal",      label: "Personal",      icon: "👤", color: "#ec4899" },
  { value: "food",          label: "Food",          icon: "🍔", color: "#f59e0b" },
  { value: "transport",     label: "Transport",     icon: "🚗", color: "#3b82f6" },
  { value: "health",        label: "Health",        icon: "💊", color: "#10b981" },
  { value: "subscriptions", label: "Subscriptions", icon: "📱", color: "#06b6d4" },
  { value: "savings",       label: "Savings",       icon: "💰", color: "#14b8a6" },
  { value: "insurance",     label: "Insurance",     icon: "🛡️", color: "#64748b" },
  { value: "education",     label: "Education",     icon: "🎓", color: "#84cc16" },
  { value: "other",         label: "Other",         icon: "🔖", color: "#94a3b8" },
];
const TAG_MAP = Object.fromEntries(TAGS.map((t) => [t.value, t]));

const SPENDING_TYPES = [
  { value: "need",   label: "Need",   icon: "🔵", desc: "Non-negotiable", bg: "bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300" },
  { value: "want",   label: "Want",   icon: "🟡", desc: "Discretionary",  bg: "bg-yellow-50 border-yellow-300 text-yellow-700 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-300" },
  { value: "saving", label: "Saving", icon: "💚", desc: "Wealth-building", bg: "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300" },
];
const SPENDING_MAP = Object.fromEntries(SPENDING_TYPES.map((s) => [s.value, s]));

const FREQ_OPTIONS = ["weekly", "biweekly", "monthly", "quarterly", "annual"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toMonthly(rec: RecurringTransaction): number {
  const amt = Number(rec.amount);
  switch (rec.frequency) {
    case "weekly":    return amt * 52 / 12;
    case "biweekly":  return amt * 26 / 12;
    case "monthly":   return amt;
    case "quarterly": return amt / 3;
    case "annual":    return amt / 12;
    default:          return amt;
  }
}

function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate + "T00:00:00").getTime() - new Date().setHours(0,0,0,0);
  return Math.ceil(diff / 86400000);
}

function DueBadge({ isoDate }: { isoDate: string | null }) {
  const days = daysUntil(isoDate);
  if (days === null) return null;
  if (days < 0) return <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Overdue</span>;
  if (days === 0) return <span className="text-xs font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">Due today</span>;
  if (days <= 7)  return <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Due in {days}d</span>;
  return <span className="text-xs text-gray-400">{new Date(isoDate! + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>;
}

function FreqBadge({ freq }: { freq: string }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${FREQ_COLOR[freq] ?? "bg-gray-100 text-gray-600"}`}>
      {FREQ_LABEL[freq] ?? freq}
    </span>
  );
}

function SpendingPill({ type }: { type: string }) {
  const s = SPENDING_MAP[type];
  if (!s) return null;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${s.bg}`}>
      {s.icon} {s.label}
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

// ─── Log Payment Modal ────────────────────────────────────────────────────────

function LogPaymentModal({
  rec,
  onClose,
  onLogged,
}: {
  rec: RecurringTransaction;
  onClose: () => void;
  onLogged: (updated: RecurringTransaction) => void;
}) {
  const { fmt } = useCurrency();
  const today = new Date().toISOString().split("T")[0];
  const [amount, setAmount] = useState(rec.amount);
  const [paidDate, setPaidDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [createTxn, setCreateTxn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await logRecurringPayment(rec.id, {
        amount: parseFloat(amount),
        paid_date: paidDate,
        notes: notes || undefined,
        create_transaction: createTxn,
      });
      // Refresh the recurring item to get updated next_due_date + payment list
      const all = await listRecurring();
      const updated = all.find((r) => r.id === rec.id);
      if (updated) onLogged(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Log Payment</h3>
            <p className="text-xs text-gray-500 mt-0.5">{rec.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount Paid</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">$</span>
              <input
                type="number" step="0.01" min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Payment Date</label>
            <input
              type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes (optional)</label>
            <input
              type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. paid via credit card"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>
          <label className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 cursor-pointer">
            <input
              type="checkbox" checked={createTxn} onChange={(e) => setCreateTxn(e.target.checked)}
              className="w-4 h-4 accent-blue-600 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Add to transaction ledger</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">Creates a transaction so your spending totals stay accurate</p>
            </div>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
          <button
            type="button" onClick={handleSave}
            disabled={saving || !parseFloat(amount) || !paidDate}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {saving ? "Saving…" : `Log ${fmt(parseFloat(amount))} payment`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add/Edit Modal ───────────────────────────────────────────────────────────

function RecurringFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: RecurringTransaction;
  onClose: () => void;
  onSaved: (rec: RecurringTransaction) => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [frequency, setFrequency] = useState(initial?.frequency ?? "monthly");
  const [tag, setTag] = useState(initial?.tag ?? "other");
  const [spendingType, setSpendingType] = useState(initial?.spending_type ?? "want");
  const [nextDue, setNextDue] = useState(initial?.next_due_date ?? "");
  const [startDate, setStartDate] = useState(initial?.start_date ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!name.trim() || !parseFloat(amount as string)) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        amount: parseFloat(amount as string),
        frequency,
        tag,
        spending_type: spendingType,
        next_due_date: nextDue || undefined,
        start_date: startDate || undefined,
        notes: notes.trim() || undefined,
        is_active: isActive,
      };
      let rec: RecurringTransaction;
      if (isEdit && initial) {
        rec = await updateRecurring(initial.id, payload);
      } else {
        rec = await createRecurring(payload);
      }
      onSaved(rec);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white">{isEdit ? "Edit Recurring" : "Add Recurring"}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          {/* Name + Amount */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Netflix"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm">$</span>
                <input
                  type="number" step="0.01" min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Frequency */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Frequency</label>
            <div className="flex flex-wrap gap-2">
              {FREQ_OPTIONS.map((f) => (
                <button
                  key={f} type="button"
                  onClick={() => setFrequency(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    frequency === f
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700"
                  }`}
                >
                  {FREQ_LABEL[f]}
                </button>
              ))}
            </div>
          </div>

          {/* Life Area Tag */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Life Area</label>
            <div className="grid grid-cols-5 gap-2">
              {TAGS.map((t) => (
                <button
                  key={t.value} type="button"
                  onClick={() => setTag(t.value)}
                  title={t.label}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition ${
                    tag === t.value
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                      : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-500"
                  }`}
                >
                  <span className="text-lg leading-none">{t.icon}</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 text-center leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Spending Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Spending Type <span className="text-gray-400 font-normal">(50/30/20 rule)</span></label>
            <div className="grid grid-cols-3 gap-2">
              {SPENDING_TYPES.map((s) => (
                <button
                  key={s.value} type="button"
                  onClick={() => setSpendingType(s.value)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition ${
                    spendingType === s.value
                      ? `border-current ${s.bg}`
                      : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
                  }`}
                >
                  <span className="text-xl">{s.icon}</span>
                  <span className="text-sm font-semibold">{s.label}</span>
                  <span className="text-[10px] text-gray-500">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Next Due Date</label>
              <input
                type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date</label>
              <input
                type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
            <input
              type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>

          {isEdit && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Active (uncheck to pause)</span>
            </label>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
          <button
            type="button" onClick={handleSave}
            disabled={saving || !name.trim() || !parseFloat(amount as string)}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Recurring"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Candidate Row ────────────────────────────────────────────────────────────

function CandidateRow({
  candidate, checked, onCheck,
}: {
  candidate: RecurringCandidate; checked: boolean; onCheck: (key: string, val: boolean) => void;
}) {
  const { fmt, fmtDate } = useCurrency();
  return (
    <label className={`flex items-center gap-4 px-5 py-3 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 transition ${checked ? "bg-blue-50/50" : ""}`}>
      <input
        type="checkbox" checked={checked} onChange={(e) => onCheck(candidate.key, e.target.checked)}
        className="w-4 h-4 accent-blue-600 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{candidate.name}</p>
          <FreqBadge freq={candidate.frequency} />
        </div>
        <div className="flex items-center gap-4 mt-0.5 flex-wrap text-xs text-gray-400">
          <span>{candidate.occurrences} occurrences</span>
          <span>Last: {fmtDate(candidate.last_date)}</span>
          <span>Next ~{fmtDate(candidate.next_expected)}</span>
        </div>
      </div>
      <div className="shrink-0 text-right flex flex-col items-end gap-1">
        <p className="text-sm font-semibold text-gray-900">{fmt(parseFloat(candidate.amount as string))}</p>
        <ConfidenceBar value={candidate.confidence} />
      </div>
    </label>
  );
}

// ─── Saved Recurring Row ──────────────────────────────────────────────────────

function SavedRow({
  rec, onEdit, onToggle, onDelete, onLogPayment,
}: {
  rec: RecurringTransaction;
  onEdit: (r: RecurringTransaction) => void;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  onLogPayment: (r: RecurringTransaction) => void;
}) {
  const { fmt } = useCurrency();
  const tagMeta = TAG_MAP[rec.tag] ?? TAG_MAP.other;
  const spendMeta = SPENDING_MAP[rec.spending_type];

  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition ${!rec.is_active ? "opacity-50" : ""}`}>
      {/* Tag icon avatar */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
        style={{ backgroundColor: tagMeta.color + "22" }}
        title={tagMeta.label}
      >
        <span>{tagMeta.icon}</span>
      </div>

      {/* Name + badges */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{rec.name}</p>
          {!rec.is_active && (
            <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">Paused</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <FreqBadge freq={rec.frequency} />
          {spendMeta && <SpendingPill type={rec.spending_type} />}
          <DueBadge isoDate={rec.next_due_date} />
        </div>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0 mr-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{fmt(parseFloat(rec.amount))}</p>
        <p className="text-xs text-gray-400">{FREQ_LABEL[rec.frequency]}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onLogPayment(rec)}
          title="Log payment"
          className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 px-2.5 py-1.5 rounded-lg transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Log
        </button>
        <button
          type="button"
          onClick={() => onEdit(rec)}
          title="Edit"
          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onToggle(rec.id, !rec.is_active)}
          title={rec.is_active ? "Pause" : "Resume"}
          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
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
          type="button"
          onClick={() => onDelete(rec.id)}
          title="Delete"
          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RecurringPage() {
  const { fmt } = useCurrency();

  const [saved, setSaved] = useState<RecurringTransaction[]>([]);
  const [candidates, setCandidates] = useState<RecurringCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [detecting, setDetecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [spendFilter, setSpendFilter] = useState<"all" | "need" | "want" | "saving">("all");
  const [groupBy, setGroupBy] = useState<"tag" | "frequency">("tag");

  const [editModal, setEditModal] = useState<RecurringTransaction | "new" | null>(null);
  const [logModal, setLogModal] = useState<RecurringTransaction | null>(null);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  }

  useEffect(() => {
    listRecurring()
      .then(setSaved)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  // ── Detection ──

  async function handleDetect() {
    setDetecting(true);
    setError("");
    setCandidates(null);
    setSelected(new Set());
    try {
      const results = await detectRecurring();
      const savedKeys = new Set(saved.map((s) => `${s.name.toLowerCase()}|${s.frequency}`));
      const filtered = results.filter((c) => !savedKeys.has(`${c.name.toLowerCase()}|${c.frequency}`));
      setCandidates(filtered);
      if (filtered.length === 0) showSuccess("No new recurring patterns found.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetecting(false);
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
      showSuccess(`${newlySaved.length} recurring transaction${newlySaved.length !== 1 ? "s" : ""} saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setConfirming(false);
    }
  }

  // ── CRUD ──

  async function handleToggle(id: string, active: boolean) {
    try {
      const updated = await updateRecurring(id, { is_active: active });
      setSaved((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this recurring item?")) return;
    try {
      await deleteRecurring(id);
      setSaved((prev) => prev.filter((r) => r.id !== id));
      showSuccess("Deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function handleSaved(rec: RecurringTransaction) {
    setSaved((prev) => {
      const idx = prev.findIndex((r) => r.id === rec.id);
      return idx >= 0 ? prev.map((r) => (r.id === rec.id ? rec : r)) : [...prev, rec];
    });
    showSuccess(editModal === "new" ? "Recurring added." : "Recurring updated.");
  }

  // ── Summary ──

  const active = saved.filter((r) => r.is_active);
  const monthlyCommitted = active.reduce((s, r) => s + toMonthly(r), 0);
  const annualProjected = monthlyCommitted * 12;
  const needsMonthly = active.filter((r) => r.spending_type === "need").reduce((s, r) => s + toMonthly(r), 0);
  const wantsMonthly = active.filter((r) => r.spending_type === "want").reduce((s, r) => s + toMonthly(r), 0);
  const dueThisWeek = active.filter((r) => {
    const d = daysUntil(r.next_due_date);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  // ── Filtered + grouped ──

  const filtered = saved.filter((r) => spendFilter === "all" || r.spending_type === spendFilter);

  let groups: { key: string; label: string; icon?: string; items: RecurringTransaction[] }[] = [];
  if (groupBy === "tag") {
    for (const tag of TAGS) {
      const items = filtered.filter((r) => r.tag === tag.value);
      if (items.length > 0) groups.push({ key: tag.value, label: tag.label, icon: tag.icon, items });
    }
  } else {
    for (const freq of FREQ_OPTIONS) {
      const items = filtered.filter((r) => r.frequency === freq);
      if (items.length > 0) groups.push({ key: freq, label: FREQ_LABEL[freq], items });
    }
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Recurring & Subscriptions</h2>
          <p className="text-sm text-gray-500 mt-0.5">Your committed monthly cash flow — bills, subscriptions, and savings.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditModal("new")}
            className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-400 text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Manually
          </button>
          <button
            type="button"
            onClick={handleDetect}
            disabled={detecting}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {detecting ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 20v-5h-.581M5.072 9A8.001 8.001 0 0119.938 15M18.928 15A8.001 8.001 0 015.062 9" />
              </svg>
            )}
            {detecting ? "Analysing…" : "Auto-Detect"}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
      {successMsg && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">{successMsg}</div>}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Monthly Committed</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{fmt(monthlyCommitted)}</p>
          <p className="text-xs text-gray-400 mt-1">{active.length} active items</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Annual Projected</p>
          <p className="text-2xl font-bold text-purple-600">{fmt(annualProjected)}</p>
          <p className="text-xs text-gray-400 mt-1">Monthly × 12</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Needs vs Wants</p>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex">
              {monthlyCommitted > 0 && (
                <div className="bg-blue-500 h-full transition-all" style={{ width: `${(needsMonthly / monthlyCommitted) * 100}%` }} />
              )}
              {monthlyCommitted > 0 && (
                <div className="bg-yellow-400 h-full transition-all" style={{ width: `${(wantsMonthly / monthlyCommitted) * 100}%` }} />
              )}
            </div>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-blue-600">🔵 {monthlyCommitted > 0 ? Math.round(needsMonthly / monthlyCommitted * 100) : 0}% Needs</span>
            <span className="text-yellow-600">🟡 {monthlyCommitted > 0 ? Math.round(wantsMonthly / monthlyCommitted * 100) : 0}% Wants</span>
          </div>
        </div>
        <div className={`rounded-xl border shadow-sm p-5 ${dueThisWeek > 0 ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800" : "bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800"}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Due This Week</p>
          <p className={`text-2xl font-bold ${dueThisWeek > 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>{dueThisWeek}</p>
          <p className="text-xs text-gray-400 mt-1">items due in ≤ 7 days</p>
        </div>
      </div>

      {/* Detection Results */}
      {candidates !== null && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {candidates.length === 0 ? "No new patterns detected" : `${candidates.length} pattern${candidates.length !== 1 ? "s" : ""} detected`}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {candidates.length > 0 ? "Select the ones you want to track, then save." : "All patterns are already saved."}
              </p>
            </div>
            {candidates.length > 0 && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setSelected(selected.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.key)))} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                  {selected.size === candidates.length ? "Deselect All" : "Select All"}
                </button>
                <button type="button" onClick={handleConfirm} disabled={selected.size === 0 || confirming} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                  {confirming ? "Saving…" : `Save ${selected.size > 0 ? selected.size : ""} Selected`}
                </button>
                <button type="button" onClick={() => { setCandidates(null); setSelected(new Set()); }} className="text-sm text-gray-400 hover:text-gray-600">Dismiss</button>
              </div>
            )}
          </div>
          {candidates.length > 0 && candidates.map((c) => (
            <CandidateRow key={c.key} candidate={c} checked={selected.has(c.key)} onCheck={(key, val) => setSelected((prev) => { const n = new Set(prev); val ? n.add(key) : n.delete(key); return n; })} />
          ))}
        </div>
      )}

      {/* Saved List */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm">
        {/* Filter bar */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {(["all", "need", "want", "saving"] as const).map((f) => (
              <button
                key={f} type="button"
                onClick={() => setSpendFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${spendFilter === f ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
              >
                {f === "all" ? "All" : f === "need" ? "🔵 Needs" : f === "want" ? "🟡 Wants" : "💚 Savings"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Group by:</span>
            <button type="button" onClick={() => setGroupBy("tag")} className={`px-2 py-1 rounded-md transition ${groupBy === "tag" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>Life Area</button>
            <button type="button" onClick={() => setGroupBy("frequency")} className={`px-2 py-1 rounded-md transition ${groupBy === "frequency" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>Frequency</button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-gray-400 text-sm">{saved.length === 0 ? 'No recurring items yet. Click "Add Manually" or "Auto-Detect".' : "No items match the selected filter."}</p>
          </div>
        ) : (
          groups.map((group) => {
            const groupActive = group.items.filter((r) => r.is_active);
            const groupMonthly = groupActive.reduce((s, r) => s + toMonthly(r), 0);
            return (
              <div key={group.key}>
                <div className="px-5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {group.icon && <span className="mr-1.5">{group.icon}</span>}{group.label}
                    <span className="ml-2 text-xs font-normal text-gray-400">{group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
                  </span>
                  <span className="text-xs text-gray-500">{fmt(groupMonthly)}<span className="text-gray-400">/mo</span></span>
                </div>
                {group.items.map((rec) => (
                  <SavedRow
                    key={rec.id}
                    rec={rec}
                    onEdit={(r) => setEditModal(r)}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onLogPayment={(r) => setLogModal(r)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Modals */}
      {logModal && (
        <LogPaymentModal
          rec={logModal}
          onClose={() => setLogModal(null)}
          onLogged={(updated) => setSaved((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
        />
      )}
      {editModal !== null && (
        <RecurringFormModal
          initial={editModal === "new" ? undefined : editModal}
          onClose={() => setEditModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
