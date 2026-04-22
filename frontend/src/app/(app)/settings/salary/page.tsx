"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import {
  listHouseholdMembers,
  listSalaryWithholdings,
  upsertSalaryWithholding,
  UserResponse,
  SalaryWithholding,
} from "@/lib/api";

const YEARS = [2024, 2025, 2026];

const MONEY_FIELDS: { key: keyof SalaryWithholding; label: string; note?: string }[] = [
  { key: "gross_wages",         label: "Gross Wages",           note: "Box 1" },
  { key: "federal_wages",       label: "Federal Wages",          note: "Box 1" },
  { key: "medicare_wages",      label: "Medicare Wages",         note: "Box 5" },
  { key: "federal_income_tax",  label: "Federal Income Tax",     note: "Box 2" },
  { key: "state_income_tax",    label: "State Income Tax",       note: "Box 17" },
  { key: "social_security_tax", label: "Social Security Tax",    note: "Box 4" },
  { key: "medicare_tax",        label: "Medicare Tax",           note: "Box 6" },
  { key: "health_insurance",    label: "Health & Benefits",      note: "Box 12DD" },
  { key: "traditional_401k",   label: "Traditional 401k",       note: "Box 12D" },
  { key: "roth_401k",          label: "Roth 401k",               note: "Box 12AA" },
  { key: "esop_income",        label: "ESOP / Stock",             note: "Box 12V" },
  { key: "hsa",                label: "HSA",                     note: "Box 12W" },
  { key: "group_term_life",    label: "Group Term Life",          note: "Box 12C" },
  { key: "fsa_section125",     label: "FSA / Section 125",        note: "Sec 125" },
];

type FormValues = Record<string, string>;

function emptyForm(userId: string, year: number): FormValues {
  const base: FormValues = { user_id: userId, year: String(year), employer_name: "" };
  for (const f of MONEY_FIELDS) base[f.key as string] = "";
  return base;
}

function recordToForm(rec: SalaryWithholding): FormValues {
  const form: FormValues = {
    user_id: rec.user_id,
    year: String(rec.year),
    employer_name: rec.employer_name ?? "",
  };
  for (const f of MONEY_FIELDS) form[f.key as string] = rec[f.key] as string;
  return form;
}

export default function SalarySettingsPage() {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [members, setMembers] = useState<UserResponse[]>([]);
  const [forms, setForms] = useState<Record<string, FormValues>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    listHouseholdMembers().then(setMembers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!members.length) return;
    listSalaryWithholdings(year).then((records) => {
      const byUser: Record<string, SalaryWithholding> = {};
      for (const r of records) byUser[r.user_id] = r;
      const newForms: Record<string, FormValues> = {};
      for (const m of members) {
        newForms[m.id] = byUser[m.id] ? recordToForm(byUser[m.id]) : emptyForm(m.id, year);
      }
      setForms(newForms);
    }).catch(() => {});
  }, [members, year]);

  function handleChange(userId: string, field: string, value: string) {
    setForms((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: value },
    }));
  }

  async function handleSave(userId: string) {
    const f = forms[userId];
    if (!f) return;
    setSaving((prev) => ({ ...prev, [userId]: true }));
    try {
      const payload = {
        user_id: userId,
        year,
        employer_name: f.employer_name ?? "",
        gross_wages: f.gross_wages || "0",
        federal_wages: f.federal_wages || "0",
        medicare_wages: f.medicare_wages || "0",
        federal_income_tax: f.federal_income_tax || "0",
        state_income_tax: f.state_income_tax || "0",
        social_security_tax: f.social_security_tax || "0",
        medicare_tax: f.medicare_tax || "0",
        health_insurance: f.health_insurance || "0",
        traditional_401k: f.traditional_401k || "0",
        roth_401k: f.roth_401k || "0",
        esop_income: f.esop_income || "0",
        hsa: f.hsa || "0",
        group_term_life: f.group_term_life || "0",
        fsa_section125: f.fsa_section125 || "0",
      };
      await upsertSalaryWithholding(payload);
      setToast("Saved successfully");
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast("Save failed — check values");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSaving((prev) => ({ ...prev, [userId]: false }));
    }
  }

  const btnBase = "text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors duration-150";
  const btnActive = "bg-indigo-600 border-indigo-600 text-white";
  const btnIdle = "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-700";

  return (
    <div>
      <PageHeader
        title="W-2 / Payroll Data"
        subtitle="Enter annual W-2 figures to power the payroll Sankey diagram"
      />

      {/* Year selector */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-sm text-gray-500 dark:text-gray-400 mr-1">Year:</span>
        {YEARS.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className={`${btnBase} ${year === y ? btnActive : btnIdle}`}
          >
            {y}
          </button>
        ))}
        <Link
          href="/dashboard"
          className="ml-auto text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* One card per member */}
      <div className="space-y-6">
        {members.map((member) => {
          const f = forms[member.id] ?? emptyForm(member.id, year);
          const isSaving = saving[member.id] ?? false;

          return (
            <Card key={member.id}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{member.full_name}</h3>
                  <p className="text-xs text-gray-400">{year} W-2</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSave(member.id)}
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
              </div>

              {/* Employer name */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Employer Name
                </label>
                <input
                  type="text"
                  value={f.employer_name ?? ""}
                  onChange={(e) => handleChange(member.id, "employer_name", e.target.value)}
                  placeholder="e.g. Avanade Inc."
                  className="w-full max-w-xs rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Money fields 2-col grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {MONEY_FIELDS.map((field) => (
                  <div key={field.key as string}>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      {field.label}
                      {field.note && (
                        <span className="ml-1 text-gray-400 font-normal">({field.note})</span>
                      )}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={f[field.key as string] ?? ""}
                        onChange={(e) => handleChange(member.id, field.key as string, e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-800 text-white text-sm px-4 py-2 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
