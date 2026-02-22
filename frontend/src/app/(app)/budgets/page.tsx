"use client";

import { useState, useEffect, useRef } from "react";
import {
  listBudgets,
  createBudgetsBulk,
  updateBudget,
  deleteBudget,
  copyBudgetsFromLastMonth,
  listCustomCategories,
  seedDefaultCategories,
  BudgetWithActual,
  BudgetUpdate,
  CustomCategory,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function navigateMonth(month: number, year: number, dir: -1 | 1) {
  let m = month + dir;
  let y = year;
  if (m > 12) { m = 1; y++; }
  if (m < 1) { m = 12; y--; }
  return { month: m, year: y };
}

function fmt(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.abs(n)
  );
}

function getToken(): string {
  return localStorage.getItem("access_token") ?? "";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardAmountEntry {
  categoryId: string;
  amount: string;
  rolloverEnabled: boolean;
  alertThreshold: number;
  showAdvanced: boolean;
}

interface WizardState {
  step: 1 | 2 | 3 | 4;
  month: number;
  year: number;
  selectedCategoryIds: Set<string>;
  amounts: WizardAmountEntry[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  subtext,
  valueColor,
}: {
  label: string;
  value: number;
  subtext?: string;
  valueColor: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{fmt(value)}</p>
      {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
    </div>
  );
}

function ProgressBar({ pct, alertThreshold }: { pct: number; alertThreshold: number }) {
  const clamped = Math.min(pct, 100);
  let barColor = "bg-green-500";
  if (pct >= 100) barColor = "bg-red-500";
  else if (pct >= alertThreshold) barColor = "bg-yellow-400";

  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function BudgetRow({
  budget,
  onEdit,
  onDelete,
}: {
  budget: BudgetWithActual;
  onEdit: (b: BudgetWithActual) => void;
  onDelete: (id: string) => void;
}) {
  const pct = parseFloat(budget.percent_used);
  const remaining = parseFloat(budget.remaining);
  const isOver = remaining < 0;
  const isAtAlert = pct >= budget.alert_threshold && !isOver;

  return (
    <div className={`flex items-center gap-4 px-5 py-4 border-b border-gray-50 last:border-0 ${isOver ? "bg-red-50/40" : ""}`}>
      {/* Category icon + name */}
      <div className="flex items-center gap-3 w-44 shrink-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white shrink-0"
          style={{ backgroundColor: budget.category.color ?? "#94a3b8" }}
        >
          {budget.category.icon ? budget.category.icon : budget.category.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{budget.category.name}</p>
          {isAtAlert && (
            <p className="text-xs text-yellow-600 flex items-center gap-1">⚠ {budget.alert_threshold}% threshold</p>
          )}
          {budget.rollover_enabled && (
            <p className="text-xs text-blue-500">↻ Rollover on</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex-1 min-w-0">
        <ProgressBar pct={pct} alertThreshold={budget.alert_threshold} />
      </div>

      {/* Amounts */}
      <div className="text-right w-40 shrink-0">
        <p className="text-sm font-semibold text-gray-900">
          {fmt(budget.actual_spent)}{" "}
          <span className="font-normal text-gray-400">/ {fmt(budget.amount)}</span>
        </p>
        <p className={`text-xs ${isOver ? "text-red-600 font-medium" : "text-gray-400"}`}>
          {isOver ? `${fmt(Math.abs(remaining))} over budget` : `${fmt(remaining)} remaining`}
        </p>
      </div>

      {/* Percent */}
      <div className="w-12 text-right shrink-0">
        <span className={`text-sm font-semibold ${isOver ? "text-red-600" : pct >= budget.alert_threshold ? "text-yellow-600" : "text-gray-500"}`}>
          {Math.round(pct)}%
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onEdit(budget)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition"
          title="Edit budget"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={() => onDelete(budget.id)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500 transition"
          title="Delete budget"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function BudgetGroup({
  title,
  budgets,
  onEdit,
  onDelete,
}: {
  title: string;
  budgets: BudgetWithActual[];
  onEdit: (b: BudgetWithActual) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-4">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      {budgets.map((b) => (
        <BudgetRow key={b.id} budget={b} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-16 text-center">
      <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
        </svg>
      </div>
      <p className="text-gray-700 font-semibold text-lg mb-1">No budgets set up yet</p>
      <p className="text-gray-400 text-sm mb-6">Create monthly budgets by category to track your spending goals.</p>
      <button
        onClick={onCreateClick}
        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
      >
        + Create Budget
      </button>
    </div>
  );
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition p-1 rounded">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Wizard Steps ─────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  const steps = ["Period", "Categories", "Amounts", "Review"];
  return (
    <div className="flex items-center justify-center gap-1 mb-6">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition ${i + 1 < step ? "bg-blue-600 text-white" : i + 1 === step ? "bg-blue-600 text-white ring-4 ring-blue-100" : "bg-gray-100 text-gray-400"}`}>
            {i + 1 < step ? "✓" : i + 1}
          </div>
          <span className={`text-xs hidden sm:inline ${i + 1 === step ? "text-blue-600 font-medium" : "text-gray-400"}`}>{label}</span>
          {i < steps.length - 1 && <div className="w-4 h-px bg-gray-200 mx-1" />}
        </div>
      ))}
    </div>
  );
}

function WizardStep1({ wizard, setWizard, onNext }: { wizard: WizardState; setWizard: React.Dispatch<React.SetStateAction<WizardState>>; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Which month would you like to budget for?</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
          <select
            value={wizard.month}
            onChange={(e) => setWizard((p) => ({ ...p, month: Number(e.target.value) }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
          <input
            type="number"
            value={wizard.year}
            onChange={(e) => setWizard((p) => ({ ...p, year: Number(e.target.value) }))}
            min={2020}
            max={2035}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <button onClick={onNext} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
          Next →
        </button>
      </div>
    </div>
  );
}

function WizardStep2({
  wizard, setWizard, categories, existingCategoryIds, onBack, onNext, onSeedCategories, seeding,
}: {
  wizard: WizardState;
  setWizard: React.Dispatch<React.SetStateAction<WizardState>>;
  categories: CustomCategory[];
  existingCategoryIds: Set<string>;
  onBack: () => void;
  onNext: () => void;
  onSeedCategories: () => void;
  seeding: boolean;
}) {
  const expenseCategories = categories.filter((c) => !c.is_income);
  const incomeCategories = categories.filter((c) => c.is_income);

  function toggleCategory(catId: string) {
    setWizard((prev) => {
      const next = new Set(prev.selectedCategoryIds);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return { ...prev, selectedCategoryIds: next };
    });
  }

  function CategoryChip({ cat }: { cat: CustomCategory }) {
    const alreadySet = existingCategoryIds.has(cat.id);
    const selected = wizard.selectedCategoryIds.has(cat.id);
    return (
      <button
        disabled={alreadySet}
        onClick={() => toggleCategory(cat.id)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition text-left ${alreadySet ? "opacity-40 cursor-not-allowed border-gray-100 bg-gray-50" : selected ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-blue-300 bg-white"}`}
      >
        <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs text-white" style={{ backgroundColor: cat.color ?? "#94a3b8" }}>
          {cat.icon ?? cat.name.charAt(0)}
        </div>
        <span className="truncate flex-1">{cat.name}</span>
        {alreadySet && <span className="text-xs text-gray-400 shrink-0">Set</span>}
        {selected && !alreadySet && <span className="text-blue-600 text-xs shrink-0">✓</span>}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Select categories to budget for <strong>{MONTH_NAMES[wizard.month - 1]} {wizard.year}</strong>.
      </p>
      {expenseCategories.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Expenses</p>
          <div className="grid grid-cols-2 gap-2">
            {expenseCategories.map((cat) => <CategoryChip key={cat.id} cat={cat} />)}
          </div>
        </div>
      )}
      {incomeCategories.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Income</p>
          <div className="grid grid-cols-2 gap-2">
            {incomeCategories.map((cat) => <CategoryChip key={cat.id} cat={cat} />)}
          </div>
        </div>
      )}
      {categories.length === 0 && (
        <div className="text-center py-8 space-y-3">
          <p className="text-gray-500 font-medium">No categories yet</p>
          <p className="text-sm text-gray-400">Add common spending categories to get started quickly.</p>
          <button
            onClick={onSeedCategories}
            disabled={seeding}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {seeding ? "Adding categories…" : "✨ Add Common Categories"}
          </button>
          <p className="text-xs text-gray-400">15 expense + 5 income categories will be added</p>
        </div>
      )}
      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 transition">← Back</button>
        <button
          onClick={onNext}
          disabled={wizard.selectedCategoryIds.size === 0}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function WizardStep3({
  wizard, setWizard, categories, onBack, onNext,
}: {
  wizard: WizardState;
  setWizard: React.Dispatch<React.SetStateAction<WizardState>>;
  categories: CustomCategory[];
  onBack: () => void;
  onNext: () => void;
}) {
  const catMap = new Map(categories.map((c) => [c.id, c]));

  function updateEntry(catId: string, field: keyof WizardAmountEntry, value: unknown) {
    setWizard((prev) => ({
      ...prev,
      amounts: prev.amounts.map((a) => a.categoryId === catId ? { ...a, [field]: value } : a),
    }));
  }

  const hasAnyAmount = wizard.amounts.some((a) => parseFloat(a.amount) > 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Set a monthly limit for each selected category.</p>
      {wizard.amounts.map((entry) => {
        const cat = catMap.get(entry.categoryId);
        if (!cat) return null;
        return (
          <div key={entry.categoryId} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-white shrink-0" style={{ backgroundColor: cat.color ?? "#94a3b8" }}>
                {cat.icon ?? cat.name.charAt(0)}
              </div>
              <span className="flex-1 text-sm font-medium text-gray-800 truncate">{cat.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={entry.amount}
                  onChange={(e) => updateEntry(entry.categoryId, "amount", e.target.value)}
                  placeholder="0"
                  className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={() => updateEntry(entry.categoryId, "showAdvanced", !entry.showAdvanced)}
                className="text-xs text-gray-400 hover:text-blue-600 transition shrink-0 whitespace-nowrap"
              >
                {entry.showAdvanced ? "▲ Less" : "▼ Advanced"}
              </button>
            </div>
            {entry.showAdvanced && (
              <div className="px-4 pb-4 pt-3 bg-gray-50 border-t border-gray-100 space-y-3">
                <label className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-gray-700 font-medium">Roll over unspent amount</span>
                    <p className="text-xs text-gray-400">Carry remainder to next month</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={entry.rolloverEnabled}
                    onChange={(e) => updateEntry(entry.categoryId, "rolloverEnabled", e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-700 font-medium">Alert threshold</span>
                    <span className="font-semibold text-blue-600">{entry.alertThreshold}% used</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={entry.alertThreshold}
                    onChange={(e) => updateEntry(entry.categoryId, "alertThreshold", Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>50%</span><span>75%</span><span>100%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 transition">← Back</button>
        <button
          onClick={onNext}
          disabled={!hasAnyAmount}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          Review →
        </button>
      </div>
    </div>
  );
}

function WizardStep4({
  wizard, categories, saving, onBack, onSave,
}: {
  wizard: WizardState;
  categories: CustomCategory[];
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const validEntries = wizard.amounts.filter((a) => parseFloat(a.amount) > 0);
  const total = validEntries.reduce((s, e) => s + parseFloat(e.amount), 0);

  if (validEntries.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 text-sm">No amounts entered. Go back and set budget amounts.</p>
        <button onClick={onBack} className="mt-4 text-sm text-blue-600 hover:underline">← Back</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Review your budgets for <strong>{MONTH_NAMES[wizard.month - 1]} {wizard.year}</strong>
      </p>
      <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
        {validEntries.map((entry) => {
          const cat = catMap.get(entry.categoryId);
          return (
            <div key={entry.categoryId} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs text-white shrink-0" style={{ backgroundColor: cat?.color ?? "#94a3b8" }}>
                  {cat?.icon ?? cat?.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{cat?.name}</p>
                  <div className="flex gap-2 mt-0.5">
                    {entry.rolloverEnabled && (
                      <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">↻ Rollover</span>
                    )}
                    <span className="text-xs text-gray-400">Alert at {entry.alertThreshold}%</span>
                  </div>
                </div>
              </div>
              <p className="text-sm font-semibold text-gray-900">{fmt(parseFloat(entry.amount))}</p>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-gray-500">Total: <span className="font-semibold text-gray-800">{fmt(total)}</span></p>
      </div>
      <div className="flex justify-between pt-1">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 transition">← Back</button>
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-6 py-2 rounded-lg transition"
        >
          {saving ? "Saving…" : `Save ${validEntries.length} Budget${validEntries.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({
  budget, saving, onClose, onSave,
}: {
  budget: BudgetWithActual;
  saving: boolean;
  onClose: () => void;
  onSave: (data: BudgetUpdate) => void;
}) {
  const [amount, setAmount] = useState(parseFloat(budget.amount).toString());
  const [rollover, setRollover] = useState(budget.rollover_enabled);
  const [threshold, setThreshold] = useState(budget.alert_threshold);

  return (
    <ModalShell title={`Edit — ${budget.category.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Monthly Budget</label>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0"
              step="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <label className="flex items-center justify-between text-sm py-2">
          <div>
            <span className="text-gray-700 font-medium">Roll over unspent amount</span>
            <p className="text-xs text-gray-400">Carry remainder to next month</p>
          </div>
          <input
            type="checkbox"
            checked={rollover}
            onChange={(e) => setRollover(e.target.checked)}
            className="w-4 h-4 accent-blue-600"
          />
        </label>
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-700 font-medium">Alert threshold</span>
            <span className="font-semibold text-blue-600">{threshold}% used</span>
          </div>
          <input
            type="range"
            min="50"
            max="100"
            step="5"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
          <button
            onClick={() => onSave({ amount: parseFloat(amount), rollover_enabled: rollover, alert_threshold: threshold })}
            disabled={saving || !parseFloat(amount)}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BudgetsPage() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [budgets, setBudgets] = useState<BudgetWithActual[]>([]);
  const [categories, setCategories] = useState<CustomCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [showWizard, setShowWizard] = useState(false);
  const [wizard, setWizard] = useState<WizardState>({
    step: 1,
    month: today.getMonth() + 1,
    year: today.getFullYear(),
    selectedCategoryIds: new Set(),
    amounts: [],
  });

  const [editingBudget, setEditingBudget] = useState<BudgetWithActual | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccessMsg(""), 4000);
  }

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError("");
    Promise.all([listBudgets(month, year, token), listCustomCategories(token)])
      .then(([b, c]) => { setBudgets(b); setCategories(c); })
      .catch((e) => setError(e.message ?? "Failed to load budgets"))
      .finally(() => setLoading(false));
  }, [month, year]);

  const expenseBudgets = budgets.filter((b) => !b.category.is_income);
  const incomeBudgets = budgets.filter((b) => b.category.is_income);
  const existingCategoryIds = new Set(budgets.map((b) => b.category_id));

  const totalBudgeted = budgets.reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalSpent = budgets.reduce((s, b) => s + parseFloat(b.actual_spent), 0);
  const totalRemaining = totalBudgeted - totalSpent;
  const overBudgetCount = budgets.filter((b) => parseFloat(b.remaining) < 0).length;

  function openWizard() {
    setWizard({ step: 1, month, year, selectedCategoryIds: new Set(), amounts: [] });
    setShowWizard(true);
  }

  function wizardNext() {
    setWizard((prev) => {
      if (prev.step === 2) {
        const existingAmounts = new Map(prev.amounts.map((a) => [a.categoryId, a]));
        const newAmounts: WizardAmountEntry[] = Array.from(prev.selectedCategoryIds).map(
          (id) => existingAmounts.get(id) ?? { categoryId: id, amount: "", rolloverEnabled: false, alertThreshold: 80, showAdvanced: false }
        );
        return { ...prev, step: 3, amounts: newAmounts };
      }
      return { ...prev, step: (prev.step + 1) as WizardState["step"] };
    });
  }

  function wizardBack() {
    setWizard((prev) => ({ ...prev, step: (prev.step - 1) as WizardState["step"] }));
  }

  async function handleWizardSave() {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setError("");
    const validEntries = wizard.amounts.filter((a) => parseFloat(a.amount) > 0);
    try {
      const newBudgets = await createBudgetsBulk(
        {
          budgets: validEntries.map((e) => ({
            category_id: e.categoryId,
            amount: parseFloat(e.amount),
            month: wizard.month,
            year: wizard.year,
            rollover_enabled: e.rolloverEnabled,
            alert_threshold: e.alertThreshold,
          })),
        },
        token
      );
      if (wizard.month === month && wizard.year === year) {
        setBudgets((prev) => [...prev, ...newBudgets]);
      }
      setShowWizard(false);
      showSuccess(`${newBudgets.length} budget${newBudgets.length !== 1 ? "s" : ""} created.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save budgets");
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSave(data: BudgetUpdate) {
    if (!editingBudget) return;
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const updated = await updateBudget(editingBudget.id, data, token);
      setBudgets((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setEditingBudget(null);
      showSuccess("Budget updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update budget");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this budget?")) return;
    const token = getToken();
    if (!token) return;
    try {
      await deleteBudget(id, token);
      setBudgets((prev) => prev.filter((b) => b.id !== id));
      showSuccess("Budget deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete budget");
    }
  }

  async function handleCopyFromLastMonth() {
    const token = getToken();
    if (!token) return;
    setError("");
    try {
      const copied = await copyBudgetsFromLastMonth(month, year, token);
      if (copied.length === 0) {
        setError("All previous month budgets already exist for this month.");
        return;
      }
      setBudgets((prev) => [...prev, ...copied]);
      showSuccess(`Copied ${copied.length} budget${copied.length !== 1 ? "s" : ""} from last month.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to copy budgets";
      setError(msg.includes("No budgets found") ? "No budgets found for the previous month." : msg);
    }
  }

  async function handleSeedCategories() {
    const token = getToken();
    if (!token) return;
    setSeeding(true);
    try {
      const created = await seedDefaultCategories(token);
      if (created.length === 0) {
        showSuccess("All common categories already exist.");
      } else {
        setCategories((prev) => [...prev, ...created].sort((a, b) => a.name.localeCompare(b.name)));
        showSuccess(`Added ${created.length} common categories.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add categories");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-900">Budgets</h2>
          <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <button
              onClick={() => { const n = navigateMonth(month, year, -1); setMonth(n.month); setYear(n.year); }}
              className="px-3 py-2 hover:bg-gray-50 text-gray-500 hover:text-blue-600 transition text-lg leading-none"
            >‹</button>
            <span className="text-sm font-semibold px-3 min-w-[140px] text-center text-gray-700">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              onClick={() => { const n = navigateMonth(month, year, 1); setMonth(n.month); setYear(n.year); }}
              className="px-3 py-2 hover:bg-gray-50 text-gray-500 hover:text-blue-600 transition text-lg leading-none"
            >›</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyFromLastMonth}
            className="text-sm text-gray-600 border border-gray-200 bg-white px-3 py-2 rounded-lg hover:bg-gray-50 shadow-sm transition"
          >
            Copy from Last Month
          </button>
          <button
            onClick={openWizard}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition"
          >
            + Create Budget
          </button>
        </div>
      </div>

      {/* Banners */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
          {successMsg}
        </div>
      )}

      {/* Summary cards */}
      {budgets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <SummaryCard label="Total Budgeted" value={totalBudgeted} valueColor="text-gray-900" />
          <SummaryCard
            label="Total Spent"
            value={totalSpent}
            valueColor={overBudgetCount > 0 ? "text-red-600" : "text-gray-900"}
            subtext={overBudgetCount > 0 ? `${overBudgetCount} category${overBudgetCount !== 1 ? "s" : ""} over budget` : undefined}
          />
          <SummaryCard
            label="Remaining"
            value={Math.abs(totalRemaining)}
            valueColor={totalRemaining < 0 ? "text-red-600" : "text-green-600"}
            subtext={totalRemaining < 0 ? "over total budget" : "left to spend"}
          />
        </div>
      )}

      {/* Budget list */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center text-gray-400">
          Loading budgets…
        </div>
      ) : budgets.length === 0 ? (
        <EmptyState onCreateClick={openWizard} />
      ) : (
        <>
          {expenseBudgets.length > 0 && (
            <BudgetGroup title="Expense Budgets" budgets={expenseBudgets} onEdit={setEditingBudget} onDelete={handleDelete} />
          )}
          {incomeBudgets.length > 0 && (
            <BudgetGroup title="Income Budgets" budgets={incomeBudgets} onEdit={setEditingBudget} onDelete={handleDelete} />
          )}
        </>
      )}

      {/* Wizard */}
      {showWizard && (
        <ModalShell title={`Create Budget — Step ${wizard.step} of 4`} onClose={() => setShowWizard(false)}>
          <StepIndicator step={wizard.step} />
          {wizard.step === 1 && <WizardStep1 wizard={wizard} setWizard={setWizard} onNext={wizardNext} />}
          {wizard.step === 2 && (
            <WizardStep2
              wizard={wizard}
              setWizard={setWizard}
              categories={categories}
              existingCategoryIds={wizard.month === month && wizard.year === year ? existingCategoryIds : new Set()}
              onBack={wizardBack}
              onNext={wizardNext}
              onSeedCategories={handleSeedCategories}
              seeding={seeding}
            />
          )}
          {wizard.step === 3 && <WizardStep3 wizard={wizard} setWizard={setWizard} categories={categories} onBack={wizardBack} onNext={wizardNext} />}
          {wizard.step === 4 && <WizardStep4 wizard={wizard} categories={categories} saving={saving} onBack={wizardBack} onSave={handleWizardSave} />}
        </ModalShell>
      )}

      {/* Edit Modal */}
      {editingBudget && (
        <EditModal budget={editingBudget} saving={saving} onClose={() => setEditingBudget(null)} onSave={handleEditSave} />
      )}
    </div>
  );
}
