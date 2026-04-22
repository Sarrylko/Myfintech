"use client";

import CountryGate from "@/components/CountryGate";
import { useState, useEffect } from "react";
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  listAccounts,
  listBudgets,
  Goal,
  GoalCreate,
  GoalType,
  Account,
  BudgetWithActual,
} from "@/lib/api";
import { useCurrency } from "@/lib/currency";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  savings: "Savings",
  debt_payoff: "Debt Payoff",
  investment: "Investment",
  custom: "Custom",
};

const GOAL_TYPE_ICONS: Record<GoalType, string> = {
  savings: "🏦",
  debt_payoff: "💳",
  investment: "📈",
  custom: "🎯",
};

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysLabel(n: number): string {
  if (n === 0) return "Due today";
  if (n < 0) return "Overdue";
  if (n === 1) return "1 day left";
  if (n < 30) return `${n} days left`;
  const months = Math.round(n / 30);
  return months === 1 ? "1 month left" : `${months} months left`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GoalProgressBar({ pct, isCompleted }: { pct: number; isCompleted: boolean }) {
  const clamped = Math.min(pct, 100);
  const barColor = isCompleted
    ? "bg-green-500"
    : pct >= 100
    ? "bg-green-500"
    : pct >= 75
    ? "bg-blue-500"
    : pct >= 40
    ? "bg-yellow-400"
    : "bg-gray-300";

  return (
    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function GoalCard({
  goal,
  onEdit,
  onDelete,
  onToggleComplete,
}: {
  goal: Goal;
  onEdit: (g: Goal) => void;
  onDelete: (id: string) => void;
  onToggleComplete: (g: Goal) => void;
}) {
  const { fmt } = useCurrency();
  const pct = parseFloat(goal.progress_percent);
  const progressAmount = parseFloat(goal.progress_amount);
  const targetAmount = parseFloat(goal.target_amount);
  const isOver = pct >= 100;

  const sourceLabel = goal.linked_account
    ? `Account: ${goal.linked_account.name}`
    : goal.linked_budget
    ? `Budget: ${goal.linked_budget.budget_type} ${goal.linked_budget.year}`
    : "Manual tracking";

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm p-5 flex flex-col gap-3 ${
        goal.is_completed ? "border-green-200 bg-green-50/30" : "border-gray-100"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl">{GOAL_TYPE_ICONS[goal.goal_type]}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900 truncate">{goal.name}</h3>
              {goal.is_completed && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  Completed ✓
                </span>
              )}
              {!goal.is_completed && goal.is_on_track && (
                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                  On track
                </span>
              )}
              {!goal.is_completed && !goal.is_on_track && !isOver && (
                <span className="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full font-medium">
                  Behind
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{GOAL_TYPE_LABELS[goal.goal_type]}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onToggleComplete(goal)}
            className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              goal.is_completed
                ? "border-gray-200 text-gray-500 hover:border-gray-300"
                : "border-green-200 text-green-600 hover:bg-green-50"
            }`}
          >
            {goal.is_completed ? "Reopen" : "Mark done"}
          </button>
          <button
            type="button"
            onClick={() => onEdit(goal)}
            className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-medium"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(goal.id)}
            className="text-xs px-2.5 py-1 rounded-lg border border-red-100 text-red-400 hover:bg-red-50 transition-colors font-medium"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Description */}
      {goal.description && (
        <p className="text-xs text-gray-500 -mt-1">{goal.description}</p>
      )}

      {/* Progress bar */}
      <div>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-sm font-semibold text-gray-800">
            {fmt(progressAmount)}
          </span>
          <span className="text-xs text-gray-400">
            of {fmt(targetAmount)} · {pct.toFixed(0)}%
          </span>
        </div>
        <GoalProgressBar pct={pct} isCompleted={goal.is_completed} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
        <span>{sourceLabel}</span>
        <span className={goal.days_remaining < 0 ? "text-red-500" : goal.days_remaining < 30 ? "text-yellow-500" : ""}>
          {goal.is_completed ? `Target: ${formatDate(goal.target_date)}` : daysLabel(goal.days_remaining)}
        </span>
      </div>
      <div className="text-xs text-gray-300">
        {formatDate(goal.start_date)} → {formatDate(goal.target_date)}
      </div>
    </div>
  );
}

// ─── Form Modal ───────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  description: string;
  goal_type: GoalType;
  target_amount: string;
  current_amount: string;
  start_date: string;
  target_date: string;
  linked_account_id: string;
  linked_budget_id: string;
  track_via: "manual" | "account" | "budget";
}

const today = new Date().toISOString().slice(0, 10);
const oneYearLater = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  goal_type: "savings",
  target_amount: "",
  current_amount: "",
  start_date: today,
  target_date: oneYearLater,
  linked_account_id: "",
  linked_budget_id: "",
  track_via: "manual",
};

function GoalFormModal({
  initialGoal,
  accounts,
  budgets,
  onSave,
  onClose,
}: {
  initialGoal: Goal | null;
  accounts: Account[];
  budgets: BudgetWithActual[];
  onSave: (data: GoalCreate & { is_completed?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (!initialGoal) return EMPTY_FORM;
    return {
      name: initialGoal.name,
      description: initialGoal.description ?? "",
      goal_type: initialGoal.goal_type,
      target_amount: initialGoal.target_amount,
      current_amount: initialGoal.current_amount ?? "",
      start_date: initialGoal.start_date,
      target_date: initialGoal.target_date,
      linked_account_id: initialGoal.linked_account_id ?? "",
      linked_budget_id: initialGoal.linked_budget_id ?? "",
      track_via: initialGoal.linked_account_id
        ? "account"
        : initialGoal.linked_budget_id
        ? "budget"
        : "manual",
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.target_amount || !form.start_date || !form.target_date) {
      setError("Name, target amount, start date, and target date are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload: GoalCreate = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        goal_type: form.goal_type,
        target_amount: form.target_amount,
        current_amount: form.track_via === "manual" && form.current_amount ? form.current_amount : undefined,
        start_date: form.start_date,
        target_date: form.target_date,
        linked_account_id: form.track_via === "account" ? form.linked_account_id || undefined : undefined,
        linked_budget_id: form.track_via === "budget" ? form.linked_budget_id || undefined : undefined,
      };
      await onSave(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save goal");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {initialGoal ? "Edit Goal" : "New Goal"}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className={labelCls}>Goal name *</label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. Emergency Fund"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className={labelCls}>Description (optional)</label>
            <input
              type="text"
              className={inputCls}
              placeholder="A short note about this goal"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          {/* Goal type */}
          <div>
            <label className={labelCls}>Goal type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["savings", "debt_payoff", "investment", "custom"] as GoalType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("goal_type", t)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    form.goal_type === t
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <span>{GOAL_TYPE_ICONS[t]}</span> {GOAL_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Target amount */}
          <div>
            <label className={labelCls}>Target amount *</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputCls}
              placeholder="0.00"
              value={form.target_amount}
              onChange={(e) => set("target_amount", e.target.value)}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="goal-start-date">Start date *</label>
              <input
                id="goal-start-date"
                type="date"
                title="Start date"
                className={inputCls}
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="goal-target-date">Target date *</label>
              <input
                id="goal-target-date"
                type="date"
                title="Target date"
                className={inputCls}
                value={form.target_date}
                onChange={(e) => set("target_date", e.target.value)}
              />
            </div>
          </div>

          {/* Track via */}
          <div>
            <label className={labelCls}>Track progress via</label>
            <div className="flex gap-2">
              {(["manual", "account", "budget"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set("track_via", v)}
                  className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors capitalize ${
                    form.track_via === v
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {v === "manual" ? "Manual" : v === "account" ? "Account balance" : "Budget spending"}
                </button>
              ))}
            </div>
          </div>

          {/* Manual current amount */}
          {form.track_via === "manual" && (
            <div>
              <label className={labelCls}>Current amount (optional)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                placeholder="0.00"
                value={form.current_amount}
                onChange={(e) => set("current_amount", e.target.value)}
              />
            </div>
          )}

          {/* Account picker */}
          {form.track_via === "account" && (
            <div>
              <label className={labelCls}>Linked account</label>
              <select
                title="Linked account"
                className={inputCls}
                value={form.linked_account_id}
                onChange={(e) => set("linked_account_id", e.target.value)}
              >
                <option value="">— select account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.institution_name ? `· ${a.institution_name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Budget picker */}
          {form.track_via === "budget" && (
            <div>
              <label className={labelCls}>Linked budget</label>
              <select
                title="Linked budget"
                className={inputCls}
                value={form.linked_budget_id}
                onChange={(e) => set("linked_budget_id", e.target.value)}
              >
                <option value="">— select budget —</option>
                {budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.category.name} · {b.budget_type} {b.month ? `${b.month}/` : ""}{b.year}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : initialGoal ? "Save changes" : "Create goal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const { fmt, activeCountryCode } = useCurrency();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<BudgetWithActual[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("active");

  async function load() {
    setLoading(true);
    const now = new Date();
    // Fetch independently so an error in one doesn't block the others
    const [gsResult, acctsResult, bdsResult] = await Promise.allSettled([
      listGoals(),
      listAccounts(),
      listBudgets(now.getMonth() + 1, now.getFullYear()),
    ]);
    if (gsResult.status === "fulfilled") setGoals(gsResult.value);
    if (acctsResult.status === "fulfilled") setAccounts(acctsResult.value);
    if (bdsResult.status === "fulfilled") setBudgets(bdsResult.value);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSave(data: GoalCreate) {
    if (editingGoal) {
      await updateGoal(editingGoal.id, data);
    } else {
      await createGoal({ ...data, country: activeCountryCode ?? "US" });
    }
    setShowModal(false);
    setEditingGoal(null);
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this goal?")) return;
    await deleteGoal(id);
    await load();
  }

  async function handleToggleComplete(goal: Goal) {
    await updateGoal(goal.id, { is_completed: !goal.is_completed });
    await load();
  }

  function openEdit(goal: Goal) {
    setEditingGoal(goal);
    setShowModal(true);
  }

  function openNew() {
    setEditingGoal(null);
    setShowModal(true);
  }

  const countryGoals = goals.filter((g) => g.country === activeCountryCode);

  const filtered = countryGoals.filter((g) => {
    if (filter === "active") return !g.is_completed;
    if (filter === "completed") return g.is_completed;
    return true;
  });

  // Summary stats
  const activeGoals = countryGoals.filter((g) => !g.is_completed);
  const completedGoals = countryGoals.filter((g) => g.is_completed);
  const totalTarget = activeGoals.reduce((s, g) => s + parseFloat(g.target_amount), 0);
  const totalProgress = activeGoals.reduce((s, g) => s + parseFloat(g.progress_amount), 0);
  const onTrackCount = activeGoals.filter((g) => g.is_on_track).length;

  return (
    <CountryGate allowedCountries={["US", "IN"]} featureName="Goals">
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Goals</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track your financial goals with a timeline</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <span>+</span> New goal
        </button>
      </div>

      {/* Summary cards */}
      {!loading && activeGoals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Active goals</p>
            <p className="text-2xl font-bold text-gray-800">{activeGoals.length}</p>
            <p className="text-xs text-gray-400 mt-1">{completedGoals.length} completed</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total target</p>
            <p className="text-2xl font-bold text-gray-800">{fmt(totalTarget)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total saved</p>
            <p className="text-2xl font-bold text-blue-600">{fmt(totalProgress)}</p>
            <p className="text-xs text-gray-400 mt-1">
              {totalTarget > 0 ? ((totalProgress / totalTarget) * 100).toFixed(0) : 0}% of target
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">On track</p>
            <p className="text-2xl font-bold text-green-600">{onTrackCount}</p>
            <p className="text-xs text-gray-400 mt-1">of {activeGoals.length} goals</p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {(["active", "all", "completed"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              filter === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Goals grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
          <span className="text-3xl">🎯</span>
          <p className="text-sm">
            {filter === "completed" ? "No completed goals yet." : "No goals yet — create your first one!"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleComplete={handleToggleComplete}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <GoalFormModal
          initialGoal={editingGoal}
          accounts={accounts}
          budgets={budgets}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingGoal(null); }}
        />
      )}
    </div>
    </CountryGate>
  );
}
