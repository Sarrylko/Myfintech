"use client";

import CountryGate from "@/components/CountryGate";
import { useCallback, useEffect, useState } from "react";
import { useCurrency } from "@/lib/currency";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  getRetirementProfile,
  getRetirementProjection,
  getRetirementAccounts,
  getRetirementYearlyPlan,
  updateRetirementAccountSelection,
  upsertRetirementProfile,
  getRefreshStatus,
  type RetirementProjection,
  type RetirementAccountInfo,
  type ScenarioProjection,
  type IncomeSource,
  type YearlyPlanRow,
  type YearlyPlanResponse,
} from "@/lib/api";

// ─── Probability Gauge (donut) ───────────────────────────────────────────────

function ProbabilityGauge({ value }: { value: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(99, Math.max(0, value));
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? "#22c55e" : pct >= 55 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={128} height={128} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={64} cy={64} r={r} fill="none" stroke="#1e293b" strokeWidth={12} />
        <circle cx={64} cy={64} r={r} fill="none" stroke={color} strokeWidth={12}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div className="absolute text-center">
        <p className="text-2xl font-extrabold text-white leading-none">{pct.toFixed(0)}%</p>
        <p className="text-xs text-slate-400 mt-0.5">success</p>
      </div>
    </div>
  );
}

// ─── Custom chart tooltip ────────────────────────────────────────────────────

function ScenarioTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string | number }) {
  const { fmt: fmtRaw, fmtCompact } = useCurrency();
  function fmt(n: number, compact = false): string { return compact ? fmtCompact(n) : fmtRaw(n); }
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 shadow-xl text-sm">
      <p className="text-slate-400 font-medium mb-2">Age {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-slate-300 capitalize">{p.name}:</span>
          <span className="text-white font-semibold">{fmt(p.value, true)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Income Card ─────────────────────────────────────────────────────────────

const incomeIcons: Record<string, string> = { portfolio: "📈", social_security: "🏛", rental: "🏘", real_estate: "🏠" };
const incomeColors: Record<string, string> = { portfolio: "bg-blue-500", social_security: "bg-emerald-500", rental: "bg-violet-500", real_estate: "bg-amber-500" };

function IncomeCard({ source, total }: { source: IncomeSource; total: number }) {
  const { fmt: fmtRaw, fmtCompact } = useCurrency();
  function fmt(n: number, compact = false): string { return compact ? fmtCompact(n) : fmtRaw(n); }
  const barPct = total > 0 ? Math.min(100, (source.annual_amount / total) * 100) : 0;
  return (
    <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xl mr-2">{incomeIcons[source.source_type] ?? "💰"}</span>
          <p className="text-slate-300 text-sm font-medium mt-1">{source.label}</p>
        </div>
        <p className="text-white text-lg font-bold">{fmt(source.annual_amount, true)}<span className="text-slate-400 text-xs font-normal">/yr</span></p>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${incomeColors[source.source_type] ?? "bg-slate-500"}`}
          style={{ width: `${barPct}%`, transition: "width 0.8s ease" }} />
      </div>
      <p className="text-slate-500 text-xs mt-1">{barPct.toFixed(0)}% of total income</p>
    </div>
  );
}

// ─── Account Selection Panel ─────────────────────────────────────────────────

const TAX_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  tax_deferred: { label: "Tax-Deferred", color: "text-blue-400", bg: "bg-blue-900/40 border-blue-800/60" },
  tax_exempt:   { label: "Tax-Exempt (Roth)", color: "text-emerald-400", bg: "bg-emerald-900/40 border-emerald-800/60" },
  taxable:      { label: "Taxable", color: "text-amber-400", bg: "bg-amber-900/30 border-amber-800/60" },
  non_investment: { label: "Non-Investment", color: "text-slate-500", bg: "bg-slate-700/30 border-slate-700" },
};

function AccountSelectionPanel({
  onSelectionChanged,
}: {
  onSelectionChanged: () => void;
}) {
  const { fmtCompact } = useCurrency();
  const [accounts, setAccounts] = useState<RetirementAccountInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAuto, setIsAuto] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    getRetirementAccounts().then((data) => {
      setAccounts(data);
      // is_manual_mode comes directly from the backend (true if profile has explicit selection saved)
      const inManualMode = data.length > 0 && data[0].is_manual_mode;
      setIsAuto(!inManualMode);
      setSelected(new Set(data.filter((a) => a.is_selected).map((a) => a.id)));
      setLoading(false);
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(ids: string[] | null) {
    setSaving(true);
    try {
      await updateRetirementAccountSelection(ids);
      onSelectionChanged();
    } finally {
      setSaving(false);
    }
  }

  function toggleAuto() {
    if (!isAuto) {
      // Switch to auto: clear manual selection
      setIsAuto(true);
      save(null);
    } else {
      // Switch to manual: pre-select what auto would pick
      const autoIds = (accounts ?? []).filter((a) => a.is_auto_included).map((a) => a.id);
      setIsAuto(false);
      setSelected(new Set(autoIds));
      save(autoIds);
    }
  }

  function toggleAccount(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    save(Array.from(next));
  }

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!accounts) return null;

  // Group by institution
  const byInstitution: Record<string, RetirementAccountInfo[]> = {};
  for (const acc of accounts) {
    const inst = acc.institution_name || "Other";
    if (!byInstitution[inst]) byInstitution[inst] = [];
    byInstitution[inst].push(acc);
  }

  const selectedAccounts = accounts.filter((a) => isAuto ? a.is_auto_included : selected.has(a.id));
  const selectedTotal = selectedAccounts.reduce((s, a) => s + a.current_balance, 0);
  const investmentAccounts = accounts.filter((a) => a.tax_treatment !== "non_investment");

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Retirement Accounts</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Choose which accounts count toward your retirement projection
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saving && <div className="w-3.5 h-3.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />}
          {/* Auto / Manual toggle */}
          <div className="flex items-center gap-2 bg-slate-700/60 rounded-lg p-1">
            <button
              type="button"
              onClick={() => !isAuto && toggleAuto()}
              className={`px-3 py-1 rounded text-xs font-medium transition ${isAuto ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
            >
              Auto
            </button>
            <button
              type="button"
              onClick={() => isAuto && toggleAuto()}
              className={`px-3 py-1 rounded text-xs font-medium transition ${!isAuto ? "bg-slate-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
            >
              Manual
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Mode description */}
        {isAuto ? (
          <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-800/40 rounded-xl p-3 mb-5 text-xs text-blue-300">
            <span className="mt-0.5">ℹ️</span>
            <span>
              Auto mode includes all 401k, IRA, Roth, and recognized retirement accounts.
              Switch to <strong>Manual</strong> to hand-pick which accounts to include.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 bg-slate-700/40 border border-slate-600/50 rounded-xl p-3 mb-5 text-xs text-slate-300">
            <span className="mt-0.5">✏️</span>
            <span>
              Manual mode — select exactly which accounts to include in your projection.
              You can include taxable brokerage or bank accounts if you plan to use them in retirement.
            </span>
          </div>
        )}

        {investmentAccounts.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-4">
            No investment or brokerage accounts found. Connect your accounts to get started.
          </p>
        ) : (
          <div className="space-y-5">
            {Object.entries(byInstitution).map(([institution, accs]) => {
              const investmentAccsInGroup = accs.filter((a) => a.tax_treatment !== "non_investment");
              if (investmentAccsInGroup.length === 0) return null;
              return (
                <div key={institution}>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{institution}</p>
                  <div className="space-y-2">
                    {accs.map((acc) => {
                      const taxInfo = TAX_LABELS[acc.tax_treatment];
                      const isChecked = isAuto ? acc.is_auto_included : selected.has(acc.id);
                      const isDisabled = isAuto;
                      return (
                        <label
                          key={acc.id}
                          className={`flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition
                            ${isChecked
                              ? `${taxInfo.bg} border-opacity-100`
                              : "bg-slate-700/30 border-slate-700 opacity-50"}
                            ${isDisabled ? "cursor-default" : "hover:border-slate-500"}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isDisabled}
                            onChange={() => !isDisabled && toggleAccount(acc.id)}
                            className="w-4 h-4 rounded accent-blue-500 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-white truncate">{acc.name}</p>
                              {acc.subtype && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${taxInfo.bg} ${taxInfo.color}`}>
                                  {acc.subtype.toUpperCase()}
                                </span>
                              )}
                              {acc.is_auto_included && !isAuto && (
                                <span className="text-[10px] text-slate-500">auto</span>
                              )}
                            </div>
                            <p className={`text-xs mt-0.5 ${taxInfo.color}`}>{taxInfo.label}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-white font-semibold text-sm">{fmtCompact(acc.current_balance)}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary footer */}
        {selectedAccounts.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-700 flex items-center justify-between">
            <div className="flex gap-4 text-xs">
              <span className="text-slate-400">
                {selectedAccounts.length} account{selectedAccounts.length !== 1 ? "s" : ""} selected
              </span>
              <span className="text-slate-600">·</span>
              <div className="flex gap-2">
                {["tax_deferred","tax_exempt","taxable"].map((t) => {
                  const bal = selectedAccounts.filter((a) => a.tax_treatment === t).reduce((s, a) => s + a.current_balance, 0);
                  if (bal === 0) return null;
                  const info = TAX_LABELS[t];
                  return (
                    <span key={t} className={`${info.color}`}>{info.label.split(" ")[0]}: {fmtCompact(bal)}</span>
                  );
                })}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Total included</p>
              <p className="text-white font-bold text-base">{fmtCompact(selectedTotal)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Profile Form ────────────────────────────────────────────────────────────

interface ProfileFormData {
  birth_year: string;
  retirement_age: string;
  life_expectancy_age: string;
  desired_annual_income: string;
  social_security_estimate: string;
  expected_return_rate: string;
  inflation_rate: string;
  annual_contribution: string;
  annual_contribution_401k: string;
  annual_contribution_roth: string;
  safe_withdrawal_rate: string;
  include_spouse: boolean;
  spouse_birth_year: string;
  spouse_retirement_age: string;
  spouse_life_expectancy_age: string;
  spouse_social_security_estimate: string;
  spouse_annual_contribution: string;
  spouse_annual_contribution_401k: string;
  spouse_annual_contribution_roth: string;
  yearly_income: string;
  spouse_yearly_income: string;
  monthly_essential_expenses: string;
  monthly_non_essential_expenses: string;
}

const currentYear = new Date().getFullYear();

function ProfileForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<ProfileFormData>;
  onSave: (data: ProfileFormData) => Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<ProfileFormData>({
    birth_year: initial?.birth_year ?? String(currentYear - 40),
    retirement_age: initial?.retirement_age ?? "65",
    life_expectancy_age: initial?.life_expectancy_age ?? "90",
    desired_annual_income: initial?.desired_annual_income ?? "80000",
    social_security_estimate: initial?.social_security_estimate ?? "",
    expected_return_rate: initial?.expected_return_rate ?? "7",
    inflation_rate: initial?.inflation_rate ?? "3",
    safe_withdrawal_rate: initial?.safe_withdrawal_rate ?? "4",
    annual_contribution: initial?.annual_contribution ?? "0",
    annual_contribution_401k: initial?.annual_contribution_401k ?? "0",
    annual_contribution_roth: initial?.annual_contribution_roth ?? "0",
    include_spouse: initial?.include_spouse ?? false,
    spouse_birth_year: initial?.spouse_birth_year ?? String(currentYear - 38),
    spouse_retirement_age: initial?.spouse_retirement_age ?? "65",
    spouse_life_expectancy_age: initial?.spouse_life_expectancy_age ?? "90",
    spouse_social_security_estimate: initial?.spouse_social_security_estimate ?? "",
    spouse_annual_contribution: initial?.spouse_annual_contribution ?? "0",
    spouse_annual_contribution_401k: initial?.spouse_annual_contribution_401k ?? "0",
    spouse_annual_contribution_roth: initial?.spouse_annual_contribution_roth ?? "0",
    yearly_income: initial?.yearly_income ?? "",
    spouse_yearly_income: initial?.spouse_yearly_income ?? "",
    monthly_essential_expenses: initial?.monthly_essential_expenses ?? "",
    monthly_non_essential_expenses: initial?.monthly_non_essential_expenses ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const fs = (field: keyof ProfileFormData, val: string) =>
    setForm((p) => ({ ...p, [field]: val }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await onSave(form);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  const currentAge = currentYear - parseInt(form.birth_year || "0");
  const yearsLeft = parseInt(form.retirement_age || "65") - currentAge;
  const spouseAge = currentYear - parseInt(form.spouse_birth_year || "0");

  const bucketOverflow =
    parseFloat(form.annual_contribution_401k || "0") +
    parseFloat(form.annual_contribution_roth || "0") >
    parseFloat(form.annual_contribution || "0");
  const spouseBucketOverflow =
    form.include_spouse &&
    parseFloat(form.spouse_annual_contribution_401k || "0") +
    parseFloat(form.spouse_annual_contribution_roth || "0") >
    parseFloat(form.spouse_annual_contribution || "0");

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Personal details */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Your Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Birth Year</label>
            <input type="number" title="Birth year" value={form.birth_year} onChange={(e) => fs("birth_year", e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="1940" max="2000" required />
            {currentAge > 0 && currentAge < 120 && <p className="text-xs text-slate-500 mt-0.5">Current age: {currentAge}</p>}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Target Retirement Age</label>
            <input type="number" title="Target retirement age" value={form.retirement_age} onChange={(e) => fs("retirement_age", e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="40" max="80" required />
            {yearsLeft > 0 && <p className="text-xs text-slate-500 mt-0.5">{yearsLeft} years from now</p>}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Life Expectancy Age</label>
            <input type="number" title="Life expectancy age" value={form.life_expectancy_age} onChange={(e) => fs("life_expectancy_age", e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="70" max="110" required />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Your Annual Income ($)</label>
            <input type="number" title="Your annual income" value={form.yearly_income} onChange={(e) => fs("yearly_income", e.target.value)}
              placeholder="e.g. 120000" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="0" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Your Annual Retirement Contribution ($)</label>
            <input type="number" title="Your annual contribution" value={form.annual_contribution} onChange={(e) => fs("annual_contribution", e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="0" required />
            <div className="bg-slate-700/30 rounded-lg p-3 mt-2 space-y-2">
              <div>
                <label className="block text-xs text-blue-300 mb-1">401k / Tax-deferred ($)</label>
                <input type="number" title="401k contribution" value={form.annual_contribution_401k} onChange={(e) => fs("annual_contribution_401k", e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  min="0" />
              </div>
              <div>
                <label className="block text-xs text-emerald-300 mb-1">Roth / Tax-exempt ($)</label>
                <input type="number" title="Roth contribution" value={form.annual_contribution_roth} onChange={(e) => fs("annual_contribution_roth", e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  min="0" />
              </div>
              <p className="text-xs text-amber-300">
                Brokerage (taxable): ${Math.max(0, parseFloat(form.annual_contribution || "0") - parseFloat(form.annual_contribution_401k || "0") - parseFloat(form.annual_contribution_roth || "0")).toLocaleString()}
              </p>
              {bucketOverflow && <p className="text-xs text-red-400">401k + Roth cannot exceed total contribution</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Your Social Security Estimate ($/yr, optional)</label>
            <input type="number" value={form.social_security_estimate} onChange={(e) => fs("social_security_estimate", e.target.value)}
              placeholder="e.g. 24000" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="0" />
          </div>
        </div>
      </div>

      {/* Retirement expenses */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Monthly Expenses in Retirement</p>
        <p className="text-xs text-slate-500 mb-3">If set, these drive your income target instead of a single desired income figure.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Essential Expenses at Retirement ($/mo)</label>
            <input type="number" title="Monthly essential expenses at retirement" value={form.monthly_essential_expenses} onChange={(e) => fs("monthly_essential_expenses", e.target.value)}
              placeholder="e.g. 5000 (housing, food, healthcare)" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="0" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Non-Essential Expenses at Retirement ($/mo, optional)</label>
            <input type="number" title="Monthly non-essential expenses" value={form.monthly_non_essential_expenses} onChange={(e) => fs("monthly_non_essential_expenses", e.target.value)}
              placeholder="e.g. 2000 (travel, dining, hobbies)" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="0" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-400 mb-1">
              Or: Desired Annual Income if not using monthly expenses ($)
            </label>
            <input type="number" title="Desired annual income in retirement" value={form.desired_annual_income} onChange={(e) => fs("desired_annual_income", e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              min="0" required />
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <label>Expected Annual Return</label>
            <span className="text-blue-400 font-semibold">{form.expected_return_rate}%</span>
          </div>
          <input type="range" title="Expected annual return rate" min="4" max="12" step="0.5" value={form.expected_return_rate}
            onChange={(e) => fs("expected_return_rate", e.target.value)} className="w-full accent-blue-500" />
          <div className="flex justify-between text-xs text-slate-600 mt-0.5"><span>4%</span><span>12%</span></div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <label>Inflation Rate</label>
            <span className="text-amber-400 font-semibold">{form.inflation_rate}%</span>
          </div>
          <input type="range" title="Inflation rate" min="1" max="6" step="0.5" value={form.inflation_rate}
            onChange={(e) => fs("inflation_rate", e.target.value)} className="w-full accent-amber-500" />
          <div className="flex justify-between text-xs text-slate-600 mt-0.5"><span>1%</span><span>6%</span></div>
        </div>
        <div className="sm:col-span-2">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <div>
              <label>Safe Withdrawal Rate (SWR)</label>
              <span className="text-slate-500 ml-2">— drives your retirement target ({(100 / parseFloat(form.safe_withdrawal_rate || "4")).toFixed(0)}× income)</span>
            </div>
            <span className="text-emerald-400 font-semibold">{form.safe_withdrawal_rate}%</span>
          </div>
          <input type="range" title="Safe withdrawal rate" min="2" max="6" step="0.1" value={form.safe_withdrawal_rate}
            onChange={(e) => fs("safe_withdrawal_rate", e.target.value)} className="w-full accent-emerald-500" />
          <div className="flex justify-between text-xs text-slate-600 mt-0.5"><span>2% (conservative)</span><span>6% (aggressive)</span></div>
        </div>
      </div>

      {/* Spouse toggle */}
      <div className="border-t border-slate-700 pt-4">
        <button type="button" onClick={() => setForm((p) => ({ ...p, include_spouse: !p.include_spouse }))}
          className="flex items-center gap-3 group">
          <div className={`relative w-10 h-5 rounded-full transition-colors ${form.include_spouse ? "bg-blue-600" : "bg-slate-600"}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.include_spouse ? "translate-x-5" : "translate-x-0"}`} />
          </div>
          <span className="text-sm text-slate-300 group-hover:text-white transition">Include spouse / partner in this plan</span>
        </button>
      </div>

      {form.include_spouse && (
        <div className="bg-slate-700/40 rounded-xl p-4 border border-slate-600/50">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Spouse / Partner Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Spouse Birth Year</label>
              <input type="number" title="Spouse birth year" value={form.spouse_birth_year} onChange={(e) => fs("spouse_birth_year", e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                min="1940" max="2005" required={form.include_spouse} />
              {spouseAge > 0 && spouseAge < 120 && <p className="text-xs text-slate-500 mt-0.5">Spouse age: {spouseAge}</p>}
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Spouse Target Retirement Age</label>
              <input type="number" title="Spouse target retirement age" value={form.spouse_retirement_age} onChange={(e) => fs("spouse_retirement_age", e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                min="40" max="80" required={form.include_spouse} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Spouse Life Expectancy Age</label>
              <input type="number" title="Spouse life expectancy age" value={form.spouse_life_expectancy_age} onChange={(e) => fs("spouse_life_expectancy_age", e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                min="70" max="110" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Spouse Annual Income ($)</label>
              <input type="number" title="Spouse annual income" value={form.spouse_yearly_income} onChange={(e) => fs("spouse_yearly_income", e.target.value)}
                placeholder="e.g. 95000" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                min="0" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Spouse Annual Contribution ($)</label>
              <input type="number" title="Spouse annual contribution" value={form.spouse_annual_contribution} onChange={(e) => fs("spouse_annual_contribution", e.target.value)}
                placeholder="e.g. 12000" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                min="0" />
              <div className="bg-slate-700/30 rounded-lg p-3 mt-2 space-y-2">
                <div>
                  <label className="block text-xs text-blue-300 mb-1">Spouse 401k / Tax-deferred ($)</label>
                  <input type="number" title="Spouse 401k contribution" value={form.spouse_annual_contribution_401k} onChange={(e) => fs("spouse_annual_contribution_401k", e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    min="0" />
                </div>
                <div>
                  <label className="block text-xs text-emerald-300 mb-1">Spouse Roth / Tax-exempt ($)</label>
                  <input type="number" title="Spouse Roth contribution" value={form.spouse_annual_contribution_roth} onChange={(e) => fs("spouse_annual_contribution_roth", e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    min="0" />
                </div>
                <p className="text-xs text-amber-300">
                  Spouse Brokerage (taxable): ${Math.max(0, parseFloat(form.spouse_annual_contribution || "0") - parseFloat(form.spouse_annual_contribution_401k || "0") - parseFloat(form.spouse_annual_contribution_roth || "0")).toLocaleString()}
                </p>
                {spouseBucketOverflow && <p className="text-xs text-red-400">Spouse 401k + Roth cannot exceed total contribution</p>}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Spouse Social Security Estimate ($/yr, optional)</label>
              <input type="number" value={form.spouse_social_security_estimate} onChange={(e) => fs("spouse_social_security_estimate", e.target.value)}
                placeholder="e.g. 18000" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                min="0" />
            </div>
          </div>
        </div>
      )}

      {formError && <p className="text-red-400 text-sm">{formError}</p>}

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={saving || bucketOverflow || !!spouseBucketOverflow}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
          {saving ? "Saving…" : "Save & Calculate"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-slate-400 hover:text-white text-sm transition">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ─── Scenario Chart ──────────────────────────────────────────────────────────

function ScenarioChart({ data, retirementYear }: { data: ScenarioProjection[]; retirementYear: number }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="gradOpt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="gradBase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.08} />
          </linearGradient>
          <linearGradient id="gradPess" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis dataKey="age" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
        <Tooltip content={<ScenarioTooltip />} />
        <ReferenceLine x={data.find(d => d.year === retirementYear)?.age ?? undefined}
          stroke="#f59e0b" strokeDasharray="4 3" label={{ value: "Retirement", fill: "#f59e0b", fontSize: 10, position: "top" }} />
        {/* Required wealth line */}
        <Area type="monotone" dataKey="required" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3"
          fill="none" dot={false} name="required" />
        {/* Scenario bands — render pessimistic first (bottom), then base, then optimistic (widest) */}
        <Area type="monotone" dataKey="pessimistic" stroke="#1d4ed8" strokeWidth={1} fill="url(#gradPess)" dot={false} name="pessimistic" />
        <Area type="monotone" dataKey="base" stroke="#3b82f6" strokeWidth={2} fill="url(#gradBase)" dot={false} name="base" />
        <Area type="monotone" dataKey="optimistic" stroke="#38bdf8" strokeWidth={1} fill="url(#gradOpt)" dot={false} name="optimistic" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Goal Details panels ─────────────────────────────────────────────────────

function TaxBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const { fmt: fmtRaw, fmtCompact } = useCurrency();
  function fmt(n: number, compact = false): string { return compact ? fmtCompact(n) : fmtRaw(n); }
  const pct = total > 0 ? Math.min(100, (amount / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-slate-400 flex-1">{label}</span>
      <span className="text-slate-300 font-medium">{fmt(amount, true)}</span>
      <span className="text-slate-500 w-8 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
}

// ─── Year-by-Year Table ───────────────────────────────────────────────────────

type RowDef =
  | { kind: "data"; label: string; key: keyof YearlyPlanRow; indent?: boolean }
  | { kind: "section"; label: string; totalKey: keyof YearlyPlanRow | null };

const YEAR_BY_YEAR_ROWS: RowDef[] = [
  { kind: "data",    label: "Your age",              key: "age" },
  { kind: "data",    label: "Partner age",           key: "spouse_age" },
  { kind: "section", label: "Savings start of year", totalKey: "savings_start_of_year" },
  { kind: "data",    label: "Tax-deferred (401k/IRA)",  key: "tax_deferred_savings",  indent: true },
  { kind: "data",    label: "Tax-free (Roth)",           key: "tax_exempt_savings",    indent: true },
  { kind: "data",    label: "Brokerage (taxable)",       key: "taxable_savings",       indent: true },
  { kind: "section", label: "Total expenses",        totalKey: "total_expenses" },
  { kind: "data",    label: "Essential",             key: "essential_expenses",     indent: true },
  { kind: "data",    label: "Non-essential",         key: "non_essential_expenses", indent: true },
  { kind: "data",    label: "Taxes",                 key: "estimated_taxes",        indent: true },
  { kind: "section", label: "Total income",          totalKey: "total_income" },
  { kind: "data",    label: "Earned",                key: "earned_income",             indent: true },
  { kind: "data",    label: "Dividend & Interest",   key: "dividend_interest_income",  indent: true },
  { kind: "data",    label: "Other (SS + rental)",   key: "other_income",              indent: true },
  { kind: "data",    label: "RMD (taxable dist.)",   key: "rmd_amount",                indent: true },
  { kind: "section", label: "Savings withdrawals",   totalKey: "savings_withdrawals" },
  { kind: "data",    label: "Withdrawal %",          key: "withdrawal_pct",         indent: true },
  { kind: "data",    label: "Savings at year end",   key: "savings_end_of_year" },
  { kind: "data",    label: "Net surplus / deficit", key: "net_surplus_deficit" },
];

function YearByYearTable({
  rows,
  anchoredToReturn,
  taxReturnYear,
  loading,
  isRefreshing,
  onRefresh,
  retirementAge,
}: {
  rows: YearlyPlanRow[] | null;
  anchoredToReturn: boolean;
  taxReturnYear: number | null;
  loading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  retirementAge: number;
}) {
  const { fmt: fmtRaw } = useCurrency();

  function cellText(row: YearlyPlanRow, def: RowDef & { kind: "data" }): string {
    const v = row[def.key];
    if (v === null || v === undefined) return "—";
    if (def.key === "age" || def.key === "spouse_age") return String(v);
    if (def.key === "withdrawal_pct") return `${(v as number).toFixed(1)}%`;
    return fmtRaw(v as number);
  }

  function cellColor(row: YearlyPlanRow, def: RowDef & { kind: "data" }): string {
    if (def.key === "net_surplus_deficit") {
      return row.net_surplus_deficit >= 0 ? "text-emerald-400" : "text-red-400";
    }
    if (def.key === "savings_end_of_year") {
      return row.savings_end_of_year <= 0 ? "text-red-400" : "text-slate-200";
    }
    if (def.key === "earned_income" || def.key === "dividend_interest_income" || def.key === "other_income" || def.key === "rmd_amount") return "text-emerald-300";
    return "text-slate-200";
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div>
          <h2 className="text-base font-semibold text-white">Year-by-Year Retirement Plan</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Base scenario · nominal (future) dollars — all amounts grow with inflation each year
            {anchoredToReturn && taxReturnYear && (
              <span className="ml-2 text-blue-400">· Anchored to {taxReturnYear} tax return</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition font-medium"
        >
          {isRefreshing ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {isRefreshing ? "Refreshing…" : "Refresh All"}
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs min-w-max">
            <thead>
              <tr className="bg-slate-900/60">
                <th scope="col" className="sticky left-0 z-10 bg-slate-900/95 px-4 py-3 text-left text-slate-400 font-medium border-r border-slate-700 min-w-[190px]">Category</th>
                {rows.map((row) => (
                  <th
                    key={row.year}
                    className={`px-3 py-3 text-center font-semibold min-w-[108px] border-l border-slate-700/40 ${
                      row.age === retirementAge ? "bg-blue-900/30 text-blue-300" : "text-slate-300"
                    }`}
                  >
                    <div>{row.year}</div>
                    {row.age === retirementAge && (
                      <div className="text-blue-400 text-[9px] font-normal mt-0.5 tracking-wide uppercase">Retirement</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {YEAR_BY_YEAR_ROWS.map((def, i) => {
                if (def.kind === "section") {
                  return (
                    <tr key={i} className="bg-slate-700/60">
                      <td className="sticky left-0 z-10 bg-slate-700/95 px-4 py-2.5 font-semibold text-white border-r border-slate-600 text-xs">
                        {def.label}
                      </td>
                      {rows.map((row) => {
                        const annual = def.totalKey ? (row[def.totalKey] as number) : null;
                        const showMonthly = def.totalKey === "total_expenses" || def.totalKey === "total_income" || def.totalKey === "savings_withdrawals";
                        return (
                          <td key={row.year} className={`px-3 py-2.5 text-center font-semibold text-white border-l border-slate-600/40 ${
                            row.age === retirementAge ? "bg-blue-900/10" : ""
                          }`}>
                            {annual !== null ? fmtRaw(annual) : ""}
                            {showMonthly && annual !== null && annual > 0 && (
                              <div className="text-slate-400 text-[9px] font-normal mt-0.5">{fmtRaw(annual / 12)}/mo</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }
                return (
                  <tr key={i} className="border-t border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                    <td className={`sticky left-0 z-10 bg-slate-800 py-2 text-slate-400 border-r border-slate-700/50 ${def.indent ? "pl-8 pr-4" : "px-4"}`}>
                      {def.label}
                    </td>
                    {rows.map((row) => (
                      <td key={row.year} className={`px-3 py-2 text-center border-l border-slate-700/20 ${cellColor(row, def)} ${
                        row.age === retirementAge ? "bg-blue-900/10" : ""
                      }`}>
                        {cellText(row, def)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (!rows || rows.length === 0) && (
        <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
          Complete your retirement profile to generate the year-by-year plan.
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function RetirementPage() {
  const { fmt: fmtRaw, fmtCompact } = useCurrency();
  function fmt(n: number, compact = false): string { return compact ? fmtCompact(n) : fmtRaw(n); }

  const [projection, setProjection] = useState<RetirementProjection | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [projectionError, setProjectionError] = useState("");
  const [lastPriceRefresh, setLastPriceRefresh] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "year-by-year">("overview");
  const [yearlyPlan, setYearlyPlan] = useState<YearlyPlanResponse | null>(null);
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [planRefreshing, setPlanRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setProjectionError("");
    try {
      const profileResp = await getRetirementProfile();
      if ("has_profile" in profileResp && profileResp.has_profile === false) {
        setHasProfile(false);
        setShowForm(true);
        setProjection(null);
      } else {
        setHasProfile(true);
        try {
          const proj = await getRetirementProjection();
          setProjection(proj);
          setProjectionError("");
        } catch (projErr: unknown) {
          setProjection(null);
          setProjectionError(projErr instanceof Error ? projErr.message : "Failed to load projection.");
        }
      }
    } catch {
      setHasProfile(false);
      setProjectionError("Failed to load retirement data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh projection when investment prices are updated (manual or scheduled)
  useEffect(() => {
    let cancelled = false;
    async function pollRefreshStatus() {
      try {
        const status = await getRefreshStatus();
        const ts = status.last_refresh ?? null;
        if (ts && ts !== lastPriceRefresh) {
          setLastPriceRefresh(ts);
          if (lastPriceRefresh !== null) {
            // A new price refresh occurred — silently reload projection
            load();
          }
        }
      } catch {
        // ignore polling errors silently
      }
      if (!cancelled) {
        setTimeout(pollRefreshStatus, 60_000); // check every 60 s
      }
    }
    pollRefreshStatus();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPriceRefresh, load]);

  async function handleSave(formData: ProfileFormData) {
    await upsertRetirementProfile({
      birth_year: parseInt(formData.birth_year),
      retirement_age: parseInt(formData.retirement_age),
      life_expectancy_age: parseInt(formData.life_expectancy_age),
      desired_annual_income: parseFloat(formData.desired_annual_income),
      social_security_estimate: formData.social_security_estimate ? parseFloat(formData.social_security_estimate) : null,
      expected_return_rate: parseFloat(formData.expected_return_rate) / 100,
      inflation_rate: parseFloat(formData.inflation_rate) / 100,
      safe_withdrawal_rate: parseFloat(formData.safe_withdrawal_rate) / 100,
      annual_contribution: parseFloat(formData.annual_contribution),
      annual_contribution_401k: parseFloat(formData.annual_contribution_401k || "0"),
      annual_contribution_roth: parseFloat(formData.annual_contribution_roth || "0"),
      include_spouse: formData.include_spouse,
      spouse_birth_year: formData.include_spouse && formData.spouse_birth_year ? parseInt(formData.spouse_birth_year) : null,
      spouse_retirement_age: formData.include_spouse && formData.spouse_retirement_age ? parseInt(formData.spouse_retirement_age) : null,
      spouse_life_expectancy_age: formData.include_spouse && formData.spouse_life_expectancy_age ? parseInt(formData.spouse_life_expectancy_age) : null,
      spouse_social_security_estimate: formData.include_spouse && formData.spouse_social_security_estimate ? parseFloat(formData.spouse_social_security_estimate) : null,
      spouse_annual_contribution: formData.include_spouse && formData.spouse_annual_contribution ? parseFloat(formData.spouse_annual_contribution) : null,
      spouse_annual_contribution_401k: formData.include_spouse ? parseFloat(formData.spouse_annual_contribution_401k || "0") : null,
      spouse_annual_contribution_roth: formData.include_spouse ? parseFloat(formData.spouse_annual_contribution_roth || "0") : null,
      yearly_income: formData.yearly_income ? parseFloat(formData.yearly_income) : null,
      spouse_yearly_income: formData.include_spouse && formData.spouse_yearly_income ? parseFloat(formData.spouse_yearly_income) : null,
      monthly_essential_expenses: formData.monthly_essential_expenses ? parseFloat(formData.monthly_essential_expenses) : null,
      monthly_non_essential_expenses: formData.monthly_non_essential_expenses ? parseFloat(formData.monthly_non_essential_expenses) : null,
    });
    setShowForm(false);
    await load();
  }

  async function loadYearlyPlan() {
    setYearlyLoading(true);
    try {
      const data = await getRetirementYearlyPlan();
      setYearlyPlan(data);
    } catch {
      // silently fail — empty state shown in table
    } finally {
      setYearlyLoading(false);
    }
  }

  function handleTabChange(tab: "overview" | "year-by-year") {
    setActiveTab(tab);
    if (tab === "year-by-year" && yearlyPlan === null) {
      loadYearlyPlan();
    }
  }

  async function handlePlanRefresh() {
    setPlanRefreshing(true);
    try {
      // Poll for a fresh price snapshot (max 30 s)
      const initialStatus = await getRefreshStatus();
      const initialTs = initialStatus.last_refresh;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await getRefreshStatus();
        if (status.last_refresh && status.last_refresh !== initialTs) break;
      }
      await load();
      setYearlyPlan(null);
      await loadYearlyPlan();
    } catch {
      // ignore errors — data already refreshed as much as possible
    } finally {
      setPlanRefreshing(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Onboarding ───────────────────────────────────────────────────────
  if (hasProfile === false) {
    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <div className="max-w-2xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <span className="text-5xl">☀️</span>
            <h1 className="text-3xl font-bold mt-4 text-white">Your Wealth Plan</h1>
            <p className="text-slate-400 mt-2 text-lg">
              A comfortable retirement starts with a plan. Let&apos;s build yours.
            </p>
          </div>
          <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700">
            <h2 className="text-lg font-semibold text-white mb-6">Set Up Your Retirement Profile</h2>
            <ProfileForm onSave={handleSave} />
          </div>
        </div>
      </div>
    );
  }

  // ── Projection error ─────────────────────────────────────────────────
  if (!projection) {
    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">Retirement</h1>
            <button type="button" onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">
              {showForm ? "Close" : "Edit Profile"}
            </button>
          </div>
          {showForm && (
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
              <ProfileForm onSave={handleSave} onCancel={() => setShowForm(false)} />
            </div>
          )}
          {showAccounts && (
            <AccountSelectionPanel onSelectionChanged={() => { load(); }} />
          )}
          <div className="bg-slate-800 rounded-2xl border border-red-800/50 p-8 text-center">
            <p className="text-red-400 mb-4">{projectionError || "Could not load projection."}</p>
            <button type="button" onClick={load}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────
  const p = projection;
  const prof = p.profile;
  const totalIncome = p.income_sources.reduce((s, src) => s + src.annual_amount, 0);
  const incomeCoverage = p.retirement_wealth_target > 0
    ? Math.min(200, (totalIncome / (parseFloat(prof.desired_annual_income as unknown as string))) * 100) : 0;

  const retirementYear = currentYear + p.years_to_retirement;
  const taxTotal = p.tax_deferred_balance + p.taxable_investment_balance + p.tax_exempt_balance;

  const probColor = p.probability_of_success >= 80 ? "text-emerald-400" : p.probability_of_success >= 55 ? "text-amber-400" : "text-red-400";
  const probDesc = p.probability_of_success >= 90
    ? `Your plan succeeds in average and below-average market conditions. You're well-positioned for retirement.`
    : p.probability_of_success >= 65
    ? `Your plan succeeds in average markets. A below-average market could create a shortfall — consider increasing contributions.`
    : `Your plan only succeeds in above-average markets. Significant additional saving or a later retirement date is recommended.`;

  const profileFormInitial: Partial<ProfileFormData> = {
    birth_year: String(prof.birth_year),
    retirement_age: String(prof.retirement_age),
    life_expectancy_age: String(prof.life_expectancy_age),
    desired_annual_income: String(Math.round(parseFloat(prof.desired_annual_income as unknown as string))),
    social_security_estimate: prof.social_security_estimate ? String(Math.round(parseFloat(prof.social_security_estimate as unknown as string))) : "",
    expected_return_rate: String(Math.round(parseFloat(prof.expected_return_rate as unknown as string) * 100)),
    inflation_rate: String(Math.round(parseFloat(prof.inflation_rate as unknown as string) * 100)),
    safe_withdrawal_rate: prof.safe_withdrawal_rate ? String(parseFloat(prof.safe_withdrawal_rate as unknown as string) * 100) : "4",
    annual_contribution: String(Math.round(parseFloat(prof.annual_contribution as unknown as string))),
    annual_contribution_401k: String(Math.round(parseFloat(prof.annual_contribution_401k as unknown as string) || 0)),
    annual_contribution_roth: String(Math.round(parseFloat(prof.annual_contribution_roth as unknown as string) || 0)),
    include_spouse: prof.include_spouse,
    spouse_birth_year: prof.spouse_birth_year ? String(prof.spouse_birth_year) : String(currentYear - 38),
    spouse_retirement_age: prof.spouse_retirement_age ? String(prof.spouse_retirement_age) : "65",
    spouse_life_expectancy_age: prof.spouse_life_expectancy_age ? String(prof.spouse_life_expectancy_age) : "90",
    spouse_social_security_estimate: prof.spouse_social_security_estimate ? String(Math.round(parseFloat(prof.spouse_social_security_estimate as unknown as string))) : "",
    spouse_annual_contribution: prof.spouse_annual_contribution ? String(Math.round(parseFloat(prof.spouse_annual_contribution as unknown as string))) : "0",
    spouse_annual_contribution_401k: prof.spouse_annual_contribution_401k ? String(Math.round(parseFloat(prof.spouse_annual_contribution_401k as unknown as string))) : "0",
    spouse_annual_contribution_roth: prof.spouse_annual_contribution_roth ? String(Math.round(parseFloat(prof.spouse_annual_contribution_roth as unknown as string))) : "0",
    yearly_income: prof.yearly_income ? String(Math.round(parseFloat(prof.yearly_income as unknown as string))) : "",
    spouse_yearly_income: prof.spouse_yearly_income ? String(Math.round(parseFloat(prof.spouse_yearly_income as unknown as string))) : "",
    monthly_essential_expenses: prof.monthly_essential_expenses ? String(Math.round(parseFloat(prof.monthly_essential_expenses as unknown as string))) : "",
    monthly_non_essential_expenses: prof.monthly_non_essential_expenses ? String(Math.round(parseFloat(prof.monthly_non_essential_expenses as unknown as string))) : "",
  };

  const insightIcons = ["💡", "📊", "🧮", "🛡", "⏱"];

  return (
    <CountryGate allowedCountries={["US"]} featureName="Retirement Planner">
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Retirement</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Household retirement planning
              {prof.include_spouse && (
                <span className="ml-2 px-2 py-0.5 bg-violet-900/50 border border-violet-700 text-violet-300 text-xs rounded-full">Combined plan</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setShowAccounts(!showAccounts); setShowForm(false); }}
              className={`px-4 py-2 text-sm rounded-lg transition flex items-center gap-1.5 ${showAccounts ? "bg-blue-600 text-white" : "bg-slate-700 hover:bg-slate-600 text-slate-300"}`}>
              <span>🏦</span> Accounts
            </button>
            <button type="button" onClick={() => { setShowForm(!showForm); setShowAccounts(false); }}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition">
              {showForm ? "Close" : "Edit Profile"}
            </button>
          </div>
        </div>

        {/* Edit form */}
        {showForm && (
          <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
            <h2 className="text-base font-semibold text-white mb-5">Edit Retirement Profile</h2>
            <ProfileForm initial={profileFormInitial} onSave={handleSave} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* Account selection panel */}
        {showAccounts && (
          <AccountSelectionPanel onSelectionChanged={() => { load(); }} />
        )}

        {/* ── Tab switcher ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 rounded-xl p-1 w-fit">
          <button
            type="button"
            onClick={() => handleTabChange("overview")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "overview"
                ? "bg-slate-700 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("year-by-year")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "year-by-year"
                ? "bg-slate-700 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Year by Year
          </button>
        </div>

        {/* ── Year-by-Year tab ─────────────────────────────────────────── */}
        {activeTab === "year-by-year" && (
          <YearByYearTable
            rows={yearlyPlan?.rows ?? null}
            anchoredToReturn={yearlyPlan?.anchored_to_return ?? false}
            taxReturnYear={yearlyPlan?.tax_return_year ?? null}
            loading={yearlyLoading}
            isRefreshing={planRefreshing}
            onRefresh={handlePlanRefresh}
            retirementAge={prof.retirement_age}
          />
        )}

        {activeTab === "overview" && (<>{/* ── Asset Projection Chart ───────────────────────────────────── */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white">Asset Projection</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Displaying today&apos;s dollars · from now until end of plan · 3 market scenarios
              </p>
            </div>
            {/* Legend */}
            <div className="flex gap-3 text-xs flex-wrap justify-end">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-sky-400 inline-block" />Average market</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block" />Below average</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-900 inline-block rounded" />Sig. below average</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-t border-dashed border-amber-400 inline-block" />Target</span>
            </div>
          </div>

          <ScenarioChart data={p.scenario_projections} retirementYear={retirementYear} />

          {/* End-of-plan values */}
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-700">
            <div className="text-center">
              <p className="text-slate-500 text-xs mb-1">Sig. Below Average</p>
              <p className="text-slate-300 text-lg font-bold">{fmt(p.pessimistic_wealth_at_retirement, true)}</p>
              <p className="text-slate-600 text-xs">at retirement</p>
            </div>
            <div className="text-center border-x border-slate-700">
              <p className="text-blue-400 text-xs mb-1">Below Average</p>
              <p className="text-white text-xl font-extrabold">{fmt(p.projected_wealth_at_retirement, true)}</p>
              <p className="text-slate-500 text-xs">at retirement</p>
            </div>
            <div className="text-center">
              <p className="text-sky-400 text-xs mb-1">Average Market</p>
              <p className="text-sky-300 text-lg font-bold">{fmt(p.optimistic_wealth_at_retirement, true)}</p>
              <p className="text-slate-600 text-xs">at retirement</p>
            </div>
          </div>
        </div>

        {/* ── Household Profile + How are you doing? ───────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Household Profile */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Household Profile</h2>
            <div className="space-y-4">
              {/* Primary */}
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-300 flex-shrink-0">Y</div>
                <div className="flex-1">
                  <p className="text-white text-sm font-semibold">You · Age {p.current_age}</p>
                  <p className="text-slate-400 text-xs">Currently working</p>
                  {prof.yearly_income && (
                    <p className="text-slate-300 text-xs mt-0.5">
                      {fmt(parseFloat(prof.yearly_income as unknown as string), true)}/yr income
                    </p>
                  )}
                  <p className="text-slate-500 text-xs mt-0.5">
                    Retires at {prof.retirement_age} · Planning to {prof.life_expectancy_age}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-blue-400 text-xs">+{p.years_to_retirement} yrs</p>
                </div>
              </div>

              {prof.include_spouse && prof.spouse_birth_year && (
                <>
                  <div className="border-t border-slate-700" />
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-violet-900 flex items-center justify-center text-sm font-bold text-violet-300 flex-shrink-0">S</div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-semibold">Spouse · Age {currentYear - prof.spouse_birth_year}</p>
                      <p className="text-slate-400 text-xs">Currently working</p>
                      {prof.spouse_yearly_income && (
                        <p className="text-slate-300 text-xs mt-0.5">
                          {fmt(parseFloat(prof.spouse_yearly_income as unknown as string), true)}/yr income
                        </p>
                      )}
                      <p className="text-slate-500 text-xs mt-0.5">
                        Retires at {prof.spouse_retirement_age ?? 65}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
            <button type="button" onClick={() => setShowForm(true)}
              className="mt-4 text-xs text-blue-400 hover:text-blue-300 transition">
              Edit profile →
            </button>
          </div>

          {/* How are you doing? */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">How Are You Doing?</h2>
            <div className="flex items-center gap-6">
              <ProbabilityGauge value={p.probability_of_success} />
              <div>
                <p className={`text-2xl font-extrabold mb-1 ${probColor}`}>{p.probability_of_success.toFixed(0)}%+</p>
                <p className="text-slate-400 text-xs leading-relaxed max-w-xs">{probDesc}</p>
                <div className="mt-3 space-y-1">
                  {p.gap > 0 ? (
                    <p className="text-amber-400 text-xs">Gap: {fmt(p.gap, true)} · Save {fmt(p.monthly_saving_needed, true)}/mo more</p>
                  ) : (
                    <p className="text-emerald-400 text-xs">Surplus: {fmt(Math.abs(p.gap), true)} ahead of target</p>
                  )}
                  <p className="text-slate-500 text-xs">Target: {fmt(p.retirement_wealth_target, true)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Goal Details ─────────────────────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Goal Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Total Saved */}
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-400 font-medium">Total Saved</p>
                <span className="text-slate-500 text-xs">{p.current_retirement_assets > 0 ? "Retirement accounts" : "No accounts found"}</span>
              </div>
              <p className="text-2xl font-extrabold text-white mb-4">{fmt(p.current_retirement_assets, true)}</p>
              {taxTotal > 0 ? (
                <div className="space-y-2">
                  <TaxBar label="Tax-deferred (401k, IRA)" amount={p.tax_deferred_balance} total={taxTotal} color="#3b82f6" />
                  <TaxBar label="Taxable investments" amount={p.taxable_investment_balance} total={taxTotal} color="#f59e0b" />
                  <TaxBar label="Tax-exempt (Roth)" amount={p.tax_exempt_balance} total={taxTotal} color="#22c55e" />
                  {/* Bar visualization */}
                  <div className="h-2 rounded-full overflow-hidden flex mt-2">
                    <div className="bg-blue-500 h-full" style={{ width: `${taxTotal > 0 ? (p.tax_deferred_balance / taxTotal) * 100 : 0}%` }} />
                    <div className="bg-amber-500 h-full" style={{ width: `${taxTotal > 0 ? (p.taxable_investment_balance / taxTotal) * 100 : 0}%` }} />
                    <div className="bg-emerald-500 h-full" style={{ width: `${taxTotal > 0 ? (p.tax_exempt_balance / taxTotal) * 100 : 0}%` }} />
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 text-xs">Link retirement accounts to see tax breakdown.</p>
              )}
            </div>

            {/* Retirement Profile */}
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
              <p className="text-xs text-slate-400 font-medium mb-1">Retirement Profile</p>
              <p className="text-2xl font-extrabold text-white mb-4">{retirementYear}</p>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Your retirement age</span>
                  <span className="text-slate-200 font-medium">{prof.retirement_age} <span className="text-slate-500">(planning to {prof.life_expectancy_age})</span></span>
                </div>
                {prof.include_spouse && prof.spouse_birth_year && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Spouse&apos;s retirement age</span>
                    <span className="text-slate-200 font-medium">{prof.spouse_retirement_age ?? 65}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Expected return</span>
                  <span className="text-slate-200 font-medium">{(parseFloat(prof.expected_return_rate as unknown as string) * 100).toFixed(1)}%/yr</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Inflation assumption</span>
                  <span className="text-slate-200 font-medium">{(parseFloat(prof.inflation_rate as unknown as string) * 100).toFixed(1)}%/yr</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Years to retirement</span>
                  <span className="text-slate-200 font-medium">{p.years_to_retirement} years</span>
                </div>
                <div className="border-t border-slate-600/50 pt-2 mt-1">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1.5">Assumptions</p>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Mortgages & home loans</span>
                    <span className="text-emerald-400 font-medium">Paid off ✓</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-slate-400">Children&apos;s college</span>
                    <span className="text-emerald-400 font-medium">Fully funded ✓</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Expenses */}
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
              <p className="text-xs text-slate-400 font-medium mb-1">Monthly Expenses</p>
              {p.total_monthly_expenses > 0 ? (
                <>
                  <p className="text-2xl font-extrabold text-white mb-4">{fmt(p.total_monthly_expenses, true)}<span className="text-slate-500 text-sm font-normal">/mo</span></p>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Essential expenses</span>
                      <span className="text-slate-200 font-medium">
                        {prof.monthly_essential_expenses ? fmt(parseFloat(prof.monthly_essential_expenses as unknown as string)) : "—"}/mo
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Non-essential</span>
                      <span className="text-slate-200 font-medium">
                        {prof.monthly_non_essential_expenses ? fmt(parseFloat(prof.monthly_non_essential_expenses as unknown as string)) : "—"}/mo
                      </span>
                    </div>
                    <div className="border-t border-slate-700 pt-2 flex justify-between font-semibold">
                      <span className="text-slate-300">Total annual</span>
                      <span className="text-white">{fmt(p.total_monthly_expenses * 12, true)}/yr</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-2xl font-extrabold text-white mb-4">
                    {fmt(parseFloat(prof.desired_annual_income as unknown as string) / 12, true)}<span className="text-slate-500 text-sm font-normal">/mo</span>
                  </p>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Annual target income</span>
                      <span className="text-slate-200 font-medium">{fmt(parseFloat(prof.desired_annual_income as unknown as string), true)}/yr</span>
                    </div>
                    <p className="text-slate-600 text-xs mt-2">Add monthly expense breakdown in Edit Profile for detailed planning.</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Your Strategies ─────────────────────────────────────────── */}
        {(() => {
          const profContrib = parseFloat(prof.annual_contribution as unknown as string) || 0;
          const spouseContrib = prof.include_spouse && prof.spouse_annual_contribution
            ? parseFloat(prof.spouse_annual_contribution as unknown as string) : 0;
          const totalContrib = profContrib + spouseContrib;
          const combinedIncome = (prof.yearly_income ? parseFloat(prof.yearly_income as unknown as string) : 0)
            + (prof.include_spouse && prof.spouse_yearly_income ? parseFloat(prof.spouse_yearly_income as unknown as string) : 0);
          const savingsRate = combinedIncome > 0 ? (totalContrib / combinedIncome) * 100 : 0;
          const onTrackColor = p.on_track_pct >= 80 ? "text-emerald-400 bg-emerald-900/30 border-emerald-800" : p.on_track_pct >= 50 ? "text-amber-400 bg-amber-900/30 border-amber-800" : "text-red-400 bg-red-900/30 border-red-800";

          const ssSources = p.income_sources.filter(s => s.source_type === "social_security");
          const ssTotal = ssSources.reduce((a, s) => a + s.annual_amount, 0);
          const rentalSources = p.income_sources.filter(s => s.source_type === "rental");
          const rentalTotal = rentalSources.reduce((a, s) => a + s.annual_amount, 0);
          const portfolioSource = p.income_sources.find(s => s.source_type === "portfolio");
          const guaranteedIncome = ssTotal + rentalTotal;
          const targetAnnual = p.retirement_wealth_target * 0.04;
          const guaranteedCoverage = targetAnnual > 0 ? Math.min(100, (guaranteedIncome / targetAnnual) * 100) : 0;

          const taxTotal = p.tax_deferred_balance + p.taxable_investment_balance + p.tax_exempt_balance;

          return (
            <div>
              <div className="mb-3">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Strategies</h2>
                <p className="text-slate-500 text-xs mt-0.5">Examine your current contributions, investing mix, and income sources below.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Retirement Savings */}
                <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">💼</span>
                    <p className="text-sm font-semibold text-white">Retirement Savings</p>
                  </div>
                  <p className="text-slate-500 text-xs leading-relaxed mb-4">
                    Everyone should have a retirement plan that ensures they do not outlive their assets.
                  </p>
                  <div className="space-y-2 text-xs flex-1">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Your contributions</span>
                      <span className="text-slate-200 font-medium">{fmt(profContrib, true)}/yr</span>
                    </div>
                    {prof.include_spouse && spouseContrib > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Spouse contributions</span>
                        <span className="text-slate-200 font-medium">{fmt(spouseContrib, true)}/yr</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center border-t border-slate-700 pt-2">
                      <span className="text-slate-300 font-medium">Total annual</span>
                      <span className="text-white font-bold">{fmt(totalContrib, true)}/yr</span>
                    </div>
                    {savingsRate > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Savings rate</span>
                        <span className="text-slate-200 font-medium">{savingsRate.toFixed(1)}%</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-slate-400">On track</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${onTrackColor}`}>
                        {p.on_track_pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-700 flex gap-3 text-xs">
                    <button type="button" onClick={() => setShowForm(true)} className="text-blue-400 hover:text-blue-300 transition">Edit profile →</button>
                    <a href="/accounts" className="text-slate-500 hover:text-slate-300 transition">Edit accounts →</a>
                  </div>
                </div>

                {/* Investments */}
                <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">📊</span>
                    <p className="text-sm font-semibold text-white">Investments</p>
                  </div>
                  <p className="text-slate-500 text-xs leading-relaxed mb-4">
                    Tax diversification is critical — balancing pre-tax, taxable, and Roth accounts gives flexibility in retirement.
                  </p>
                  <div className="flex-1">
                    {taxTotal > 0 ? (
                      <div className="space-y-3">
                        {[
                          { label: "Tax-deferred (401k, IRA)", amount: p.tax_deferred_balance, color: "bg-blue-500", textColor: "text-blue-400" },
                          { label: "Taxable investments", amount: p.taxable_investment_balance, color: "bg-amber-500", textColor: "text-amber-400" },
                          { label: "Tax-exempt (Roth)", amount: p.tax_exempt_balance, color: "bg-emerald-500", textColor: "text-emerald-400" },
                        ].map(({ label, amount, color, textColor }) => {
                          const pct = taxTotal > 0 ? (amount / taxTotal) * 100 : 0;
                          return (
                            <div key={label}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-400">{label}</span>
                                <span className={`font-medium ${textColor}`}>{pct.toFixed(0)}%</span>
                              </div>
                              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                              </div>
                              <p className="text-slate-600 text-xs mt-0.5">{fmt(amount, true)}</p>
                            </div>
                          );
                        })}
                        <p className="text-slate-600 text-xs mt-2 leading-relaxed">Diversification does not ensure a profit or guarantee against loss.</p>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-xs">Link your retirement accounts to see your investment mix.</p>
                    )}
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-700 flex gap-3 text-xs">
                    <a href="/accounts" className="text-blue-400 hover:text-blue-300 transition">Edit accounts →</a>
                    <a href="/investments" className="text-slate-500 hover:text-slate-300 transition">View investments →</a>
                  </div>
                </div>

                {/* Retirement Income */}
                <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🏛</span>
                    <p className="text-sm font-semibold text-white">Retirement Income</p>
                  </div>
                  <p className="text-slate-500 text-xs leading-relaxed mb-4">
                    Essential expenses should be covered by reliable lifetime income — Social Security, rental, and annuities — not just portfolio withdrawals.
                  </p>
                  <div className="space-y-3 flex-1 text-xs">
                    <div>
                      <p className="text-slate-400 font-medium mb-1.5">Lifetime income</p>
                      {ssSources.length > 0 ? ssSources.map(s => (
                        <div key={s.label} className="flex justify-between mb-1">
                          <span className="text-slate-500">{s.label}</span>
                          <span className="text-slate-300">{fmt(s.annual_amount, true)}/yr</span>
                        </div>
                      )) : (
                        <p className="text-slate-600">Social Security: not set</p>
                      )}
                    </div>
                    {rentalTotal > 0 && (
                      <div>
                        <p className="text-slate-400 font-medium mb-1.5">Rental income</p>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Active leases</span>
                          <span className="text-slate-300">{fmt(rentalTotal, true)}/yr</span>
                        </div>
                      </div>
                    )}
                    {portfolioSource && (
                      <div>
                        <p className="text-slate-400 font-medium mb-1.5">Portfolio</p>
                        <div className="flex justify-between">
                          <span className="text-slate-500">4% withdrawals</span>
                          <span className="text-slate-300">{fmt(portfolioSource.annual_amount, true)}/yr</span>
                        </div>
                      </div>
                    )}
                    <div className="border-t border-slate-700 pt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Guaranteed income coverage</span>
                        <span className={`font-semibold ${guaranteedCoverage >= 30 ? "text-emerald-400" : "text-amber-400"}`}>
                          {guaranteedCoverage.toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-slate-600 text-xs mt-0.5">SS + rental vs. total retirement target</p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-700 flex gap-3 text-xs">
                    <button type="button" onClick={() => setShowForm(true)} className="text-blue-400 hover:text-blue-300 transition">Edit retirement income →</button>
                  </div>
                </div>

              </div>
            </div>
          );
        })()}

        {/* ── Assess Your Plan for Risk ──────────────────────────────────── */}
        {(() => {
          const inflationRate = parseFloat(prof.inflation_rate as unknown as string) || 0.03;
          const yearsToRet = p.years_to_retirement;
          const targetAnnual = p.retirement_wealth_target * 0.04;
          const inflatedTarget = targetAnnual * Math.pow(1 + inflationRate, yearsToRet);
          const retirementYears = prof.life_expectancy_age - prof.retirement_age;
          const pessimisticMeetsTarget = p.pessimistic_wealth_at_retirement >= p.retirement_wealth_target;
          const baseMeetsTarget = p.projected_wealth_at_retirement >= p.retirement_wealth_target;
          const marketRange = p.optimistic_wealth_at_retirement - p.pessimistic_wealth_at_retirement;
          const essentialMonthly = prof.monthly_essential_expenses ? parseFloat(prof.monthly_essential_expenses as unknown as string) : 0;

          const riskCards = [
            {
              icon: "🕐",
              title: "Longevity Risk",
              color: pessimisticMeetsTarget ? "border-emerald-800/50 bg-emerald-900/10" : baseMeetsTarget ? "border-amber-800/50 bg-amber-900/10" : "border-red-800/50 bg-red-900/10",
              badge: pessimisticMeetsTarget ? "Low Risk" : baseMeetsTarget ? "Moderate" : "High Risk",
              badgeColor: pessimisticMeetsTarget ? "text-emerald-400" : baseMeetsTarget ? "text-amber-400" : "text-red-400",
              text: `Your plan covers ${retirementYears} years of retirement (age ${prof.retirement_age} to ${prof.life_expectancy_age}). ${pessimisticMeetsTarget ? "Even in below-average markets, you appear funded for your full life expectancy." : baseMeetsTarget ? "In average markets you're funded, but a market downturn could create a shortfall late in retirement." : "Consider increasing savings or adjusting your retirement age to reduce longevity risk."}`,
            },
            {
              icon: "📉",
              title: "Market Volatility",
              color: pessimisticMeetsTarget ? "border-emerald-800/50 bg-emerald-900/10" : "border-amber-800/50 bg-amber-900/10",
              badge: pessimisticMeetsTarget ? "Well-cushioned" : "Monitor",
              badgeColor: pessimisticMeetsTarget ? "text-emerald-400" : "text-amber-400",
              text: `In a significantly below-average market, your portfolio at retirement could be ${fmt(p.pessimistic_wealth_at_retirement, true)} vs. ${fmt(p.optimistic_wealth_at_retirement, true)} in an average market — a ${fmt(marketRange, true)} range. Diversification helps reduce this spread.`,
            },
            {
              icon: "📊",
              title: "Inflation Risk",
              color: inflatedTarget > targetAnnual * 1.5 ? "border-amber-800/50 bg-amber-900/10" : "border-slate-700 bg-slate-800/40",
              badge: inflatedTarget > targetAnnual * 1.5 ? "Notable" : "Manageable",
              badgeColor: inflatedTarget > targetAnnual * 1.5 ? "text-amber-400" : "text-slate-400",
              text: `At ${(inflationRate * 100).toFixed(1)}% annual inflation, your ${fmt(targetAnnual, true)}/yr income target today will require ${fmt(inflatedTarget, true)}/yr in ${yearsToRet} years. The 4% withdrawal rule partially offsets this through portfolio growth.`,
            },
            {
              icon: "🎲",
              title: "Sequence of Returns",
              color: "border-amber-800/50 bg-amber-900/10",
              badge: "Universal Risk",
              badgeColor: "text-amber-400",
              text: "Early retirement losses compound negatively — withdrawals from a declining portfolio lock in losses. Consider keeping 1–2 years of expenses in cash or short-term bonds as a buffer when you retire.",
            },
            {
              icon: "🏥",
              title: "Healthcare Costs",
              color: "border-amber-800/50 bg-amber-900/10",
              badge: "Plan Ahead",
              badgeColor: "text-amber-400",
              text: `Healthcare is often the largest unexpected retirement expense. ${essentialMonthly > 0 ? `Consider budgeting an additional ${fmt(essentialMonthly * 0.12)}/mo (12% of your essential expenses) for healthcare above your current estimates.` : "Budget 10–15% above your monthly expenses for healthcare to be safe."}`,
            },
            ...(p.on_track_pct < 100 ? [{
              icon: "💰",
              title: "Contribution Adequacy",
              color: p.on_track_pct < 50 ? "border-red-800/50 bg-red-900/10" : "border-amber-800/50 bg-amber-900/10",
              badge: p.on_track_pct < 50 ? "Action Needed" : "Improve",
              badgeColor: p.on_track_pct < 50 ? "text-red-400" : "text-amber-400",
              text: `You are currently ${p.on_track_pct.toFixed(0)}% on track. Increasing annual contributions by ${fmt(p.required_additional_annual_saving, true)} could close your retirement gap. Small increases early compound significantly over time.`,
            }] : []),
          ];

          return (
            <div>
              <div className="mb-3">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Assess Your Plan for Risk</h2>
                <p className="text-slate-500 text-xs mt-0.5">We&apos;ve analyzed how your plan factors in common retirement risks.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {riskCards.map((card) => (
                  <div key={card.title} className={`rounded-2xl border p-5 ${card.color}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{card.icon}</span>
                        <p className="text-sm font-semibold text-white">{card.title}</p>
                      </div>
                      <span className={`text-xs font-medium ${card.badgeColor}`}>{card.badge}</span>
                    </div>
                    <p className="text-slate-400 text-xs leading-relaxed">{card.text}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Income Sources ───────────────────────────────────────────── */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-white">Income Sources in Retirement</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Total {fmt(totalIncome, true)}/yr · {incomeCoverage.toFixed(0)}% of desired {fmt(parseFloat(prof.desired_annual_income as unknown as string), true)}/yr
              </p>
            </div>
            <div className="hidden sm:block w-32">
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${incomeCoverage >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                  style={{ width: `${Math.min(100, incomeCoverage)}%` }} />
              </div>
              <p className="text-xs text-slate-500 mt-1 text-right">{incomeCoverage.toFixed(0)}% covered</p>
            </div>
          </div>
          {p.income_sources.length === 0 ? (
            <p className="text-slate-500 text-sm">No income sources calculated. Add accounts, properties, or a Social Security estimate.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {p.income_sources.map((src) => (
                <IncomeCard key={src.label} source={src} total={totalIncome} />
              ))}
            </div>
          )}
        </div>

        {/* ── Insights ─────────────────────────────────────────────────── */}
        {p.insights.length > 0 && (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
            <h2 className="text-base font-semibold text-white mb-4">Personalized Insights</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {p.insights.map((insight, i) => (
                <div key={i} className="flex gap-3 bg-slate-700/40 rounded-xl p-4 border border-slate-600/50">
                  <span className="text-xl flex-shrink-0 mt-0.5">{insightIcons[i] ?? "💡"}</span>
                  <p className="text-slate-300 text-sm leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <p className="text-center text-slate-600 text-xs pb-4">
          Projections use the 4% safe withdrawal rule. Scenarios: optimistic (+3%), base, pessimistic (−2%). Not financial advice.
          Key assumptions: all mortgages and children&apos;s education costs are assumed to be fully paid by retirement.
          Net worth: {fmt(p.total_net_worth, true)}
        </p>
        </>)}

      </div>
    </div>
    </CountryGate>
  );
}
