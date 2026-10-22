"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  getTaxChecklist, getTaxProfile, updateEntityTaxInputs, updatePropertyTaxInputs, updateTaxProfile,
  type TaxChecklistResponse, type TaxEntityInputs, type TaxGap, type TaxProfile, type TaxProfileResponse,
  type TaxPropertyInputs,
} from "@/lib/api";
import type { TaxTab } from "./OverviewTab";
import { CLASS_LABEL, FILING_LABEL, Panel } from "./shared";

const inputCls = "w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500";

type MoneyKey = {
  [K in keyof TaxProfile]: TaxProfile[K] extends string | null ? K : never
}[keyof TaxProfile];

const MONEY_GROUPS: { title: string; note: string; fields: { key: MoneyKey; label: string; hint?: string }[] }[] = [
  {
    title: "Last year's return",
    note: "For the underpayment safe harbor. Filled from an uploaded 1040 when available.",
    fields: [
      { key: "prior_year_agi", label: "AGI (line 11)" },
      { key: "prior_year_tax", label: "Total tax (line 24)" },
      { key: "capital_loss_carryover", label: "Capital loss carryover" },
      { key: "suspended_passive_loss", label: "Suspended rental losses" },
    ],
  },
  {
    title: "Income the accounts don't show",
    note: "Expected for the rest of the year.",
    fields: [
      { key: "expected_bonus", label: "Bonus not on the W-2 figures" },
      { key: "other_ordinary_income", label: "RSU vests, 1099-NEC/MISC" },
    ],
  },
  {
    title: "Deductions",
    note: "Leave home interest / property tax blank to use your loans and property costs.",
    fields: [
      { key: "charitable_cash", label: "Charitable gifts — cash" },
      { key: "charitable_noncash", label: "Charitable gifts — property/stock" },
      { key: "medical_expenses", label: "Medical out-of-pocket" },
      { key: "mortgage_interest_override", label: "Home mortgage interest (1098)" },
      { key: "property_tax_override", label: "Home property tax" },
      { key: "other_itemized", label: "Other itemized" },
      { key: "above_line_adjustments", label: "Deductible IRA / HSA / student loan interest" },
    ],
  },
  {
    title: "Payments made",
    note: "Leave blank to count \"Taxes\" transactions (April through January).",
    fields: [
      { key: "estimated_payments_federal", label: "Federal estimated payments" },
      { key: "estimated_payments_state", label: "State estimated payments" },
    ],
  },
];

function ProfileForm({ year, data, onSaved }: { year: number; data: TaxProfileResponse; onSaved: () => void }) {
  const [form, setForm] = useState<TaxProfile>(data.profile);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => setForm(data.profile), [data.profile]);

  const set = <K extends keyof TaxProfile>(k: K, v: TaxProfile[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const { year: _y, exists: _e, ...rest } = form;
      const body = Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [k, v === "" ? null : v]),
      );
      await updateTaxProfile(year, body);
      setMsg("Saved");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const married = form.filing_status === "mfj" || form.filing_status === "mfs";

  return (
    <Panel
      title={`Tax profile — ${year}`}
      note={data.profile.exists ? "Saved for this year" : "Not saved yet: showing defaults from last year / your retirement profile"}
      right={
        <div className="flex items-center gap-3">
          {msg && <span className={`text-xs ${msg === "Saved" ? "text-emerald-600" : "text-red-600"}`}>{msg}</span>}
          <button type="button" onClick={save} disabled={saving}
                  className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="tp-status">Filing status</label>
          <select id="tp-status" className={inputCls} value={form.filing_status}
                  onChange={(e) => set("filing_status", e.target.value as TaxProfile["filing_status"])}>
            {Object.entries(FILING_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="tp-state">State</label>
          <select id="tp-state" className={inputCls} value={form.state ?? ""} onChange={(e) => set("state", e.target.value || null)}>
            <option value="">—</option>
            {data.states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="tp-kids">Children under 17</label>
          <input id="tp-kids" type="number" min={0} className={inputCls} value={form.dependents_under_17}
                 onChange={(e) => set("dependents_under_17", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="tp-deps">Other dependents</label>
          <input id="tp-deps" type="number" min={0} className={inputCls} value={form.other_dependents}
                 onChange={(e) => set("other_dependents", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="tp-bd">Your birthdate</label>
          <input id="tp-bd" type="date" className={inputCls} value={form.taxpayer_birthdate ?? ""}
                 onChange={(e) => set("taxpayer_birthdate", e.target.value || null)} />
        </div>
        {married && (
          <div>
            <label className="block text-xs text-gray-500 mb-1" htmlFor="tp-sbd">Spouse birthdate</label>
            <input id="tp-sbd" type="date" className={inputCls} value={form.spouse_birthdate ?? ""}
                   onChange={(e) => set("spouse_birthdate", e.target.value || null)} />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700 col-span-2 md:col-span-1 mt-5">
          <input type="checkbox" checked={form.active_participation}
                 onChange={(e) => set("active_participation", e.target.checked)} />
          Actively manage rentals
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 col-span-2 md:col-span-1 mt-5">
          <input type="checkbox" checked={form.real_estate_professional}
                 onChange={(e) => set("real_estate_professional", e.target.checked)} />
          Real estate professional
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
        {MONEY_GROUPS.map((g) => (
          <div key={g.title} className="border border-gray-100 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-700">{g.title}</p>
            <p className="text-xs text-gray-400 mb-3">{g.note}</p>
            <div className="space-y-2">
              {g.fields.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3">
                  <label htmlFor={`tp-${f.key}`} className="text-sm text-gray-600">{f.label}</label>
                  <input
                    id={`tp-${f.key}`}
                    type="number"
                    step="0.01"
                    placeholder="—"
                    className="w-32 text-right text-sm border border-gray-300 rounded-md px-2 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form[f.key] ?? ""}
                    onChange={(e) => set(f.key, e.target.value === "" ? null : e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PropertyRow({ p, onSaved }: { p: TaxPropertyInputs; onSaved: () => void }) {
  const [land, setLand] = useState(p.land_value ?? "");
  const [inService, setInService] = useState(p.placed_in_service_date ?? "");
  const [days, setDays] = useState(p.personal_use_days?.toString() ?? "");
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const dirty = land !== (p.land_value ?? "") || inService !== (p.placed_in_service_date ?? "")
    || days !== (p.personal_use_days?.toString() ?? "");

  async function save() {
    setState("saving");
    try {
      await updatePropertyTaxInputs(p.id, {
        land_value: land === "" ? null : land,
        placed_in_service_date: inService || null,
        personal_use_days: days === "" ? null : Number(days),
      });
      setState("saved");
      onSaved();
    } catch {
      setState("error");
    }
  }

  return (
    <tr>
      <td className="py-2 pr-3">
        <p className="text-sm font-medium text-gray-800">{p.address}</p>
        <p className="text-[11px] text-gray-400">bought {p.purchase_date ?? "—"}{p.purchase_price ? ` for $${Number(p.purchase_price).toLocaleString()}` : ""}</p>
      </td>
      <td className="py-2 pr-3">
        <input type="number" placeholder="20% assumed" aria-label="Land value" value={land} onChange={(e) => setLand(e.target.value)}
               className="w-32 text-right text-sm border border-gray-300 rounded-md px-2 py-1" />
      </td>
      <td className="py-2 pr-3">
        <input type="date" aria-label="Placed in service" value={inService} onChange={(e) => setInService(e.target.value)}
               className="text-sm border border-gray-300 rounded-md px-2 py-1" />
      </td>
      <td className="py-2 pr-3">
        <input type="number" min={0} max={366} aria-label="Personal-use days" value={days} onChange={(e) => setDays(e.target.value)}
               className="w-20 text-right text-sm border border-gray-300 rounded-md px-2 py-1" />
      </td>
      <td className="py-2 text-right">
        <button type="button" onClick={save} disabled={!dirty || state === "saving"}
                className="text-xs font-medium px-3 py-1 rounded-md bg-indigo-600 text-white disabled:opacity-40">
          {state === "saving" ? "…" : state === "saved" && !dirty ? "Saved" : "Save"}
        </button>
      </td>
    </tr>
  );
}

function EntityCard({ e, onSaved }: { e: TaxEntityInputs; onSaved: () => void }) {
  const [form, setForm] = useState(e);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  useEffect(() => setForm(e), [e]);
  const set = <K extends keyof TaxEntityInputs>(k: K, v: TaxEntityInputs[K]) => { setForm((f) => ({ ...f, [k]: v })); setState(""); };

  async function save() {
    setState("saving");
    try {
      const { id: _i, name: _n, entity_type: _t, ...rest } = form;
      await updateEntityTaxInputs(e.id, {
        ...rest,
        owner_salary: rest.owner_salary === "" ? null : rest.owner_salary,
        health_insurance_premiums: rest.health_insurance_premiums === "" ? null : rest.health_insurance_premiums,
        retirement_contribution: rest.retirement_contribution === "" ? null : rest.retirement_contribution,
      });
      setState("saved");
      onSaved();
    } catch {
      setState("error");
    }
  }

  const sCorp = (form.tax_classification ?? (e.entity_type === "s_corp" ? "s_corp" : null)) === "s_corp";

  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">{e.name}</p>
          <p className="text-[11px] text-gray-400 uppercase">{e.entity_type.replace("_", " ")}</p>
        </div>
        <button type="button" onClick={save} disabled={state === "saving"}
                className="text-xs font-medium px-3 py-1 rounded-md bg-indigo-600 text-white disabled:opacity-40">
          {state === "saving" ? "…" : state === "saved" ? "Saved" : state === "error" ? "Retry" : "Save"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1" htmlFor={`ent-cls-${e.id}`}>Taxed as</label>
          <select id={`ent-cls-${e.id}`} className={inputCls} value={form.tax_classification ?? ""}
                  onChange={(ev) => set("tax_classification", (ev.target.value || null) as TaxEntityInputs["tax_classification"])}>
            <option value="">Derive from entity type</option>
            {Object.entries(CLASS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {sCorp && (
          <div>
            <label className="block text-xs text-gray-500 mb-1" htmlFor={`ent-sal-${e.id}`}>Owner W-2 salary</label>
            <input id={`ent-sal-${e.id}`} type="number" className={inputCls} value={form.owner_salary ?? ""}
                   onChange={(ev) => set("owner_salary", ev.target.value || null)} />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor={`ent-ho-${e.id}`}>Home office sq ft</label>
          <input id={`ent-ho-${e.id}`} type="number" min={0} className={inputCls} value={form.home_office_sqft ?? ""}
                 onChange={(ev) => set("home_office_sqft", ev.target.value === "" ? null : Number(ev.target.value))} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor={`ent-hi-${e.id}`}>Health premiums / yr</label>
          <input id={`ent-hi-${e.id}`} type="number" className={inputCls} value={form.health_insurance_premiums ?? ""}
                 onChange={(ev) => set("health_insurance_premiums", ev.target.value || null)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor={`ent-rp-${e.id}`}>Retirement plan</label>
          <select id={`ent-rp-${e.id}`} className={inputCls} value={form.retirement_plan ?? "none"}
                  onChange={(ev) => set("retirement_plan", ev.target.value as TaxEntityInputs["retirement_plan"])}>
            <option value="none">None</option>
            <option value="solo_401k">Solo 401(k)</option>
            <option value="sep">SEP-IRA</option>
            <option value="simple">SIMPLE IRA</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor={`ent-rc-${e.id}`}>Employer contribution</label>
          <input id={`ent-rc-${e.id}`} type="number" className={inputCls} value={form.retirement_contribution ?? ""}
                 onChange={(ev) => set("retirement_contribution", ev.target.value || null)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 col-span-2">
          <input type="checkbox" checked={form.accountable_plan} onChange={(ev) => set("accountable_plan", ev.target.checked)} />
          Has an accountable (expense reimbursement) plan
        </label>
      </div>
    </div>
  );
}

const GAP_LINK: Record<TaxGap["where"], { label: string; href?: string; tab?: TaxTab }> = {
  inputs: { label: "Profile below" },
  salary: { label: "Settings → Salary", href: "/settings/salary" },
  investments: { label: "Investments", href: "/investments" },
  rentals: { label: "Rental fields below" },
  business: { label: "Business fields below" },
};

export default function InputsTab({ year, gaps, onSaved, onNavigate }: {
  year: number;
  gaps: TaxGap[];
  onSaved: () => void;
  onNavigate: (tab: TaxTab) => void;
}) {
  const [data, setData] = useState<TaxProfileResponse | null>(null);
  const [checklist, setChecklist] = useState<TaxChecklistResponse | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    getTaxProfile(year).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    getTaxChecklist(year).then(setChecklist).catch(() => setChecklist(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [year]);

  const saved = () => { load(); onSaved(); };

  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>;
  if (!data) return <p className="text-sm text-gray-400 text-center py-10">Loading…</p>;

  return (
    <div className="space-y-5">
      {gaps.length > 0 && (
        <Panel title="What would sharpen the estimate" note={`${gaps.length} item${gaps.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-gray-100">
            {gaps.map((g) => {
              const link = GAP_LINK[g.where];
              return (
                <li key={g.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700">{g.message}</span>
                  {link.href ? (
                    <Link href={link.href} className="text-xs text-indigo-600 hover:text-indigo-800 shrink-0">{link.label} →</Link>
                  ) : (
                    <span className="text-xs text-gray-400 shrink-0">{link.label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <ProfileForm year={year} data={data} onSaved={saved} />

      {data.properties.length > 0 && (
        <Panel title="Rental depreciation inputs"
               note="Land isn't depreciable — your county assessor's land/improvement split is a good source.">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[11px] text-gray-500 uppercase tracking-wide text-left">
                  <th className="font-medium pb-1">Property</th>
                  <th className="font-medium pb-1">Land value</th>
                  <th className="font-medium pb-1">First rented</th>
                  <th className="font-medium pb-1">Personal days</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.properties.map((p) => <PropertyRow key={p.id} p={p} onSaved={saved} />)}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {data.entities.length > 0 && (
        <Panel title="Business entities" note="How each entity is taxed decides self-employment tax, QBI and which strategies apply.">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.entities.map((e) => <EntityCard key={e.id} e={e} onSaved={saved} />)}
          </div>
        </Panel>
      )}

      {checklist && (
        <Panel
          title="Tax document checklist"
          note={`${checklist.required_received} of ${checklist.required} expected forms uploaded for ${year}`}
          right={
            <button type="button" onClick={() => onNavigate("documents")}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
              Upload in Documents →
            </button>
          }
        >
          <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
            <div className="h-full bg-emerald-500"
                 style={{ width: `${checklist.required ? (checklist.required_received / checklist.required) * 100 : 100}%` }} />
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
            {checklist.items.map((i, idx) => (
              <li key={`${i.category}-${idx}`} className="flex items-center gap-2 text-sm">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                  i.received ? "bg-emerald-500 text-white" : "border border-gray-300"}`}>
                  {i.received ? "✓" : ""}
                </span>
                <span className={i.received ? "text-gray-500" : "text-gray-700"}>{i.label}</span>
                {i.optional && <span className="text-[10px] text-gray-400">optional</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-3">
            Matched by form type and year on uploads in the Documents tab. Forms usually arrive late January to mid-March.
          </p>
        </Panel>
      )}
    </div>
  );
}
