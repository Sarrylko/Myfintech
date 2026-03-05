"use client";

import { useEffect, useState } from "react";
import { useCurrency } from "@/lib/currency";
import {
  InsuranceBeneficiary,
  InsurancePolicy,
  InsurancePolicyCreate,
  InsurancePolicyDetail,
  PolicyType,
  PremiumFrequency,
  Vehicle,
  VehicleCreate,
  addBeneficiary,
  createPolicy,
  createVehicle,
  deleteBeneficiary,
  deletePolicy,
  deleteVehicle,
  getPolicyDetail,
  listPolicies,
  listVehicles,
  updatePolicy,
  updateVehicle,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HouseholdMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface PropertySummary {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
}

interface BusinessEntitySummary {
  id: string;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  life_term: "Term Life",
  life_whole: "Whole Life",
  life_universal: "Universal Life",
  home: "Home",
  renters: "Renters",
  auto: "Auto",
  umbrella: "Umbrella",
  health: "Health",
  dental: "Dental",
  vision: "Vision",
  disability: "Disability",
  long_term_care: "Long-Term Care",
  business: "Business",
  other: "Other",
};

const POLICY_GROUPS: { label: string; types: PolicyType[] }[] = [
  { label: "Life Insurance", types: ["life_term", "life_whole", "life_universal"] },
  { label: "Property", types: ["home", "renters"] },
  { label: "Auto", types: ["auto"] },
  { label: "Liability", types: ["umbrella"] },
  { label: "Health & Medical", types: ["health", "dental", "vision"] },
  { label: "Income Protection", types: ["disability", "long_term_care"] },
  { label: "Business", types: ["business"] },
  { label: "Other", types: ["other"] },
];

const LIFE_TYPES: PolicyType[] = ["life_term", "life_whole", "life_universal"];
const PERSONAL_TYPES: PolicyType[] = [
  "life_term", "life_whole", "life_universal",
  "health", "dental", "vision", "disability", "long_term_care",
];
const FREQ_LABELS: Record<PremiumFrequency, string> = {
  monthly: "/mo",
  quarterly: "/qtr",
  semi_annual: "/6mo",
  annual: "/yr",
  one_time: " (one-time)",
};
const FREQ_MULT: Record<PremiumFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  semi_annual: 2,
  annual: 1,
  one_time: 0,
};

const GROUP_COLORS: Record<string, string> = {
  "Life Insurance": "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Property": "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  "Auto": "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "Liability": "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "Health & Medical": "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "Income Protection": "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  "Business": "bg-gray-50 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
  "Other": "bg-gray-50 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function annualPremium(p: InsurancePolicy): number {
  if (!p.premium_amount) return 0;
  return parseFloat(p.premium_amount) * (FREQ_MULT[p.premium_frequency] ?? 1);
}

function renewalDays(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  const renewal = new Date(dateStr);
  return Math.round((renewal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function renewalColor(dateStr: string | null): string {
  const days = renewalDays(dateStr);
  if (days === null) return "text-gray-400";
  if (days < 0) return "text-red-600 dark:text-red-400 font-medium";
  if (days <= 30) return "text-red-500 dark:text-red-400 font-medium";
  if (days <= 60) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-gray-600 dark:text-gray-400";
}

function vehicleLabel(v: Vehicle): string {
  return v.nickname || [v.year, v.make, v.model].filter(Boolean).join(" ");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  label, value, onChange, type = "text", placeholder = "", required = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 w-full text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}

function SelectField({
  label, value, onChange, options, required = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 w-full text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Default form state ───────────────────────────────────────────────────────

const DEFAULT_FORM: InsurancePolicyCreate & {
  premium_amount_str: string;
  coverage_amount_str: string;
  deductible_str: string;
} = {
  policy_type: "home",
  provider: "",
  policy_number: "",
  premium_amount: undefined,
  premium_amount_str: "",
  premium_frequency: "monthly",
  coverage_amount: undefined,
  coverage_amount_str: "",
  deductible: undefined,
  deductible_str: "",
  start_date: "",
  renewal_date: "",
  auto_renew: false,
  is_active: true,
  property_id: "",
  vehicle_id: "",
  insured_user_id: "",
  entity_id: "",
  notes: "",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InsurancePage() {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [entities, setEntities] = useState<BusinessEntitySummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Detail panel
  const [selectedDetail, setSelectedDetail] = useState<InsurancePolicyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Policy form modal
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...DEFAULT_FORM });

  // Vehicle modal
  const [showVehicles, setShowVehicles] = useState(false);
  const [vehicleForm, setVehicleForm] = useState<VehicleCreate & { id?: string }>({ make: "", model: "" });
  const [vehicleSaving, setVehicleSaving] = useState(false);

  // Beneficiary form (inside detail panel)
  const [showBenForm, setShowBenForm] = useState(false);
  const [benForm, setBenForm] = useState({ name: "", relationship: "", beneficiary_type: "primary", percentage: "" });

  // Collapsed groups
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { fmt: fmtRaw, fmtDate, locale } = useCurrency();
  function fmt(val: string | number | null | undefined, decimals = 0): string {
    if (val == null || val === "") return "—";
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return "—";
    return fmtRaw(n, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function fmtFull(val: string | number | null | undefined): string {
    return fmt(val, 2);
  }

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [polsData, vehData, propsData, membersData, entsData] = await Promise.all([
        listPolicies(),
        listVehicles(),
        fetch("/api/v1/properties/", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/v1/users/household/members", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/v1/business-entities/", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setPolicies(polsData);
      setVehicles(vehData);
      setProperties(propsData);
      setMembers(membersData);
      setEntities(entsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const activePolicies = policies.filter(p => p.is_active);
  const totalAnnual = activePolicies.reduce((sum, p) => sum + annualPremium(p), 0);
  const renewingSoon = activePolicies
    .filter(p => { const d = renewalDays(p.renewal_date); return d !== null && d >= 0 && d <= 60; })
    .sort((a, b) => (renewalDays(a.renewal_date) ?? 999) - (renewalDays(b.renewal_date) ?? 999));

  // ── Policy form helpers ───────────────────────────────────────────────────

  function openAdd() {
    setEditingId(null);
    setForm({ ...DEFAULT_FORM });
    setShowForm(true);
  }

  function openEdit(p: InsurancePolicy) {
    setEditingId(p.id);
    setForm({
      ...DEFAULT_FORM,
      policy_type: p.policy_type as PolicyType,
      provider: p.provider,
      policy_number: p.policy_number ?? "",
      premium_amount_str: p.premium_amount ?? "",
      premium_frequency: p.premium_frequency as PremiumFrequency,
      coverage_amount_str: p.coverage_amount ?? "",
      deductible_str: p.deductible ?? "",
      start_date: p.start_date ?? "",
      renewal_date: p.renewal_date ?? "",
      auto_renew: p.auto_renew,
      is_active: p.is_active,
      property_id: p.property_id ?? "",
      vehicle_id: p.vehicle_id ?? "",
      insured_user_id: p.insured_user_id ?? "",
      entity_id: p.entity_id ?? "",
      notes: p.notes ?? "",
    });
    setShowForm(true);
  }

  function formPayload(): InsurancePolicyCreate {
    const payload: InsurancePolicyCreate = {
      policy_type: form.policy_type,
      provider: form.provider.trim(),
      policy_number: form.policy_number?.trim() || undefined,
      premium_amount: form.premium_amount_str ? Number(form.premium_amount_str) : undefined,
      premium_frequency: form.premium_frequency,
      coverage_amount: form.coverage_amount_str ? Number(form.coverage_amount_str) : undefined,
      deductible: form.deductible_str ? Number(form.deductible_str) : undefined,
      start_date: form.start_date || undefined,
      renewal_date: form.renewal_date || undefined,
      auto_renew: form.auto_renew,
      is_active: form.is_active,
      notes: form.notes?.trim() || undefined,
    };
    if (PERSONAL_TYPES.includes(form.policy_type) && form.insured_user_id)
      payload.insured_user_id = form.insured_user_id;
    if (form.policy_type === "auto" && form.vehicle_id)
      payload.vehicle_id = form.vehicle_id;
    if ((form.policy_type === "home" || form.policy_type === "renters") && form.property_id)
      payload.property_id = form.property_id;
    if ((form.policy_type === "business" || form.policy_type === "umbrella") && form.entity_id)
      payload.entity_id = form.entity_id;
    return payload;
  }

  async function savePolicy() {
    if (!form.provider.trim()) { setError("Provider is required"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = formPayload();
      if (editingId) {
        const updated = await updatePolicy(editingId, payload);
        setPolicies(prev => prev.map(p => p.id === editingId ? updated : p));
        if (selectedDetail?.id === editingId) {
          const detail = await getPolicyDetail(editingId);
          setSelectedDetail(detail);
        }
      } else {
        const created = await createPolicy(payload);
        setPolicies(prev => [...prev, created]);
      }
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePolicy(id: string) {
    if (!confirm("Delete this insurance policy?")) return;
    try {
      await deletePolicy(id);
      setPolicies(prev => prev.filter(p => p.id !== id));
      if (selectedDetail?.id === id) setSelectedDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function openDetail(p: InsurancePolicy) {
    setLoadingDetail(true);
    setSelectedDetail(null);
    setShowBenForm(false);
    try {
      const detail = await getPolicyDetail(p.id);
      setSelectedDetail(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load detail");
    } finally {
      setLoadingDetail(false);
    }
  }

  // ── Beneficiary helpers ────────────────────────────────────────────────────

  async function saveBeneficiary() {
    if (!selectedDetail || !benForm.name.trim() || !benForm.percentage) return;
    setSaving(true);
    try {
      await addBeneficiary(selectedDetail.id, {
        name: benForm.name.trim(),
        relationship: benForm.relationship || undefined,
        beneficiary_type: benForm.beneficiary_type,
        percentage: parseFloat(benForm.percentage),
      });
      const detail = await getPolicyDetail(selectedDetail.id);
      setSelectedDetail(detail);
      setShowBenForm(false);
      setBenForm({ name: "", relationship: "", beneficiary_type: "primary", percentage: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add beneficiary");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBeneficiary(benId: string) {
    if (!selectedDetail) return;
    try {
      await deleteBeneficiary(selectedDetail.id, benId);
      setSelectedDetail(prev => prev ? {
        ...prev,
        beneficiaries: prev.beneficiaries.filter(b => b.id !== benId),
      } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete beneficiary");
    }
  }

  // ── Vehicle helpers ────────────────────────────────────────────────────────

  async function saveVehicle() {
    if (!vehicleForm.make.trim() || !vehicleForm.model.trim()) return;
    setVehicleSaving(true);
    try {
      if (vehicleForm.id) {
        const updated = await updateVehicle(vehicleForm.id, { ...vehicleForm });
        setVehicles(prev => prev.map(v => v.id === vehicleForm.id ? updated : v));
      } else {
        const created = await createVehicle({ ...vehicleForm });
        setVehicles(prev => [...prev, created]);
      }
      setVehicleForm({ make: "", model: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save vehicle");
    } finally {
      setVehicleSaving(false);
    }
  }

  async function handleDeleteVehicle(id: string) {
    try {
      await deleteVehicle(id);
      setVehicles(prev => prev.filter(v => v.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : e instanceof Object ? String(e) : "Cannot delete vehicle");
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function coveredLabel(p: InsurancePolicy | InsurancePolicyDetail): string {
    if ("property_address" in p && p.property_address) return p.property_address;
    if ("vehicle_label" in p && p.vehicle_label) return p.vehicle_label;
    if ("insured_user_name" in p && p.insured_user_name) return p.insured_user_name;
    if ("entity_name" in p && p.entity_name) return p.entity_name;
    // Fallback: find from local data
    if (p.property_id) {
      const prop = properties.find(pr => pr.id === p.property_id);
      return prop ? `${prop.address}${prop.city ? ", " + prop.city : ""}` : "Property";
    }
    if (p.vehicle_id) {
      const veh = vehicles.find(v => v.id === p.vehicle_id);
      return veh ? vehicleLabel(veh) : "Vehicle";
    }
    if (p.insured_user_id) {
      const mem = members.find(m => m.id === p.insured_user_id);
      return mem ? (mem.full_name || mem.email) : "Member";
    }
    if (p.entity_id) {
      const ent = entities.find(e => e.id === p.entity_id);
      return ent ? ent.name : "Entity";
    }
    return "Household";
  }

  function groupBadgeClass(groupLabel: string): string {
    return GROUP_COLORS[groupLabel] || GROUP_COLORS["Other"];
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading insurance...
      </div>
    );
  }

  return (
    <div className="flex h-full gap-0">
      {/* ── Left: main content ── */}
      <div className={`flex-1 overflow-auto p-6 ${selectedDetail ? "pr-3" : ""}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              🛡 Insurance
              <span className="text-sm font-normal text-gray-500">
                {activePolicies.length} active {activePolicies.length === 1 ? "policy" : "policies"}
              </span>
            </h1>
            {totalAnnual > 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Total annual premium:{" "}
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {fmt(totalAnnual)}/year
                </span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowVehicles(true)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              🚗 Manage Vehicles
            </button>
            <button
              onClick={openAdd}
              className="px-3 py-1.5 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition font-medium"
            >
              + Add Policy
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {error}
            <button onClick={() => setError("")} className="ml-2 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Renewal alert banner */}
        {renewingSoon.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">
              ⏰ Upcoming renewals
            </p>
            <div className="space-y-0.5">
              {renewingSoon.map(p => {
                const days = renewalDays(p.renewal_date)!;
                return (
                  <p key={p.id} className="text-xs text-amber-700 dark:text-amber-400">
                    {POLICY_TYPE_LABELS[p.policy_type]} — {p.provider}:{" "}
                    {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} ({fmtDate(p.renewal_date)})
                  </p>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {policies.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">🛡</p>
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">No insurance policies yet</p>
            <p className="text-sm mt-1">Add your life, home, auto, and other insurance policies to track coverage and premiums.</p>
            <button
              onClick={openAdd}
              className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 transition"
            >
              + Add First Policy
            </button>
          </div>
        )}

        {/* Policy groups */}
        {POLICY_GROUPS.map(group => {
          const groupPolicies = policies.filter(p => group.types.includes(p.policy_type as PolicyType));
          if (groupPolicies.length === 0) return null;
          const groupTotal = groupPolicies.filter(p => p.is_active).reduce((s, p) => s + annualPremium(p), 0);
          const isCollapsed = collapsed[group.label];

          return (
            <div key={group.label} className="mb-5">
              <button
                onClick={() => setCollapsed(prev => ({ ...prev, [group.label]: !prev[group.label] }))}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition text-left"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${groupBadgeClass(group.label)}`}
                  >
                    {group.label}
                  </span>
                  <span className="text-xs text-gray-500">{groupPolicies.length} polic{groupPolicies.length === 1 ? "y" : "ies"}</span>
                </div>
                <div className="flex items-center gap-3">
                  {groupTotal > 0 && (
                    <span className="text-xs text-gray-500">
                      {fmt(groupTotal)}/yr
                    </span>
                  )}
                  <span className="text-gray-400 text-xs">{isCollapsed ? "▶" : "▼"}</span>
                </div>
              </button>

              {!isCollapsed && (
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                        <th className="text-left py-2 px-3 font-medium">Provider</th>
                        <th className="text-left py-2 px-3 font-medium">Covered</th>
                        <th className="text-left py-2 px-3 font-medium">Premium</th>
                        <th className="text-left py-2 px-3 font-medium">Coverage</th>
                        <th className="text-left py-2 px-3 font-medium">Renews</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="py-2 px-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupPolicies.map(p => (
                        <tr
                          key={p.id}
                          onClick={() => openDetail(p)}
                          className={`border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition ${selectedDetail?.id === p.id ? "bg-primary-50/50 dark:bg-primary-900/10" : ""}`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-gray-800 dark:text-gray-200">{p.provider}</div>
                            <div className="text-xs text-gray-400">{POLICY_TYPE_LABELS[p.policy_type as PolicyType]}</div>
                          </td>
                          <td className="py-2.5 px-3 text-gray-600 dark:text-gray-400 text-xs">
                            {coveredLabel(p)}
                          </td>
                          <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">
                            {p.premium_amount ? (
                              <span>
                                {fmt(p.premium_amount)}
                                <span className="text-xs text-gray-400">{FREQ_LABELS[p.premium_frequency]}</span>
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">
                            {fmt(p.coverage_amount)}
                          </td>
                          <td className={`py-2.5 px-3 text-xs ${renewalColor(p.renewal_date)}`}>
                            {fmtDate(p.renewal_date)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${p.is_active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"}`}>
                              {p.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1">
                              <button
                                onClick={() => openEdit(p)}
                                className="p-1 text-gray-400 hover:text-primary-600 transition text-xs"
                                title="Edit"
                              >✏️</button>
                              <button
                                onClick={() => handleDeletePolicy(p.id)}
                                className="p-1 text-gray-400 hover:text-red-500 transition text-xs"
                                title="Delete"
                              >🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Right: Detail panel ── */}
      {(selectedDetail || loadingDetail) && (
        <div className="w-80 border-l border-gray-200 dark:border-gray-700 overflow-auto bg-white dark:bg-gray-900 flex-shrink-0">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">Policy Detail</h3>
              <button
                onClick={() => setSelectedDetail(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
              >✕</button>
            </div>

            {loadingDetail && (
              <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
            )}

            {selectedDetail && (
              <div className="space-y-4 text-sm">
                {/* Header */}
                <div>
                  <p className="font-semibold text-base text-gray-800 dark:text-gray-100">
                    {selectedDetail.provider}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {POLICY_TYPE_LABELS[selectedDetail.policy_type as PolicyType]}
                    {selectedDetail.policy_number && ` · #${selectedDetail.policy_number}`}
                  </p>
                </div>

                {/* Fields */}
                <dl className="space-y-2">
                  {selectedDetail.premium_amount && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Premium</dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-200">
                        {fmtFull(selectedDetail.premium_amount)}{FREQ_LABELS[selectedDetail.premium_frequency]}
                        {annualPremium(selectedDetail) > 0 && (
                          <span className="text-xs text-gray-400 ml-1">
                            ({fmt(annualPremium(selectedDetail))}/yr)
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                  {selectedDetail.coverage_amount && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">
                        {LIFE_TYPES.includes(selectedDetail.policy_type as PolicyType) ? "Face Value" : "Coverage"}
                      </dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-200">{fmtFull(selectedDetail.coverage_amount)}</dd>
                    </div>
                  )}
                  {selectedDetail.deductible && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Deductible</dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-200">{fmtFull(selectedDetail.deductible)}</dd>
                    </div>
                  )}
                  {selectedDetail.start_date && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Start Date</dt>
                      <dd className="text-gray-700 dark:text-gray-300">{fmtDate(selectedDetail.start_date)}</dd>
                    </div>
                  )}
                  {selectedDetail.renewal_date && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Renewal</dt>
                      <dd className={renewalColor(selectedDetail.renewal_date)}>
                        {fmtDate(selectedDetail.renewal_date)}
                        {(() => {
                          const d = renewalDays(selectedDetail.renewal_date);
                          if (d === null) return null;
                          if (d < 0) return <span className="text-xs ml-1">(overdue)</span>;
                          if (d === 0) return <span className="text-xs ml-1">(today)</span>;
                          return <span className="text-xs ml-1">({d}d)</span>;
                        })()}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Auto-Renew</dt>
                    <dd className="text-gray-700 dark:text-gray-300">{selectedDetail.auto_renew ? "Yes" : "No"}</dd>
                  </div>

                  {/* Linked entity */}
                  {(selectedDetail.property_address || selectedDetail.vehicle_label ||
                    selectedDetail.insured_user_name || selectedDetail.entity_name) && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Covers</dt>
                      <dd className="text-gray-700 dark:text-gray-300 text-right max-w-[160px]">
                        {selectedDetail.property_address || selectedDetail.vehicle_label ||
                         selectedDetail.insured_user_name || selectedDetail.entity_name}
                      </dd>
                    </div>
                  )}

                  {selectedDetail.notes && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400 mb-1">Notes</dt>
                      <dd className="text-gray-700 dark:text-gray-300 text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded">
                        {selectedDetail.notes}
                      </dd>
                    </div>
                  )}
                </dl>

                {/* Edit button */}
                <button
                  onClick={() => openEdit(selectedDetail)}
                  className="w-full py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  ✏️ Edit Policy
                </button>

                {/* Beneficiaries (life only) */}
                {LIFE_TYPES.includes(selectedDetail.policy_type as PolicyType) && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                        Beneficiaries
                      </h4>
                      <button
                        onClick={() => setShowBenForm(!showBenForm)}
                        className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        + Add
                      </button>
                    </div>

                    {/* Existing beneficiaries */}
                    {selectedDetail.beneficiaries.length === 0 && !showBenForm && (
                      <p className="text-xs text-gray-400 text-center py-3">No beneficiaries added</p>
                    )}

                    {["primary", "contingent"].map(btype => {
                      const bens = selectedDetail.beneficiaries.filter(b => b.beneficiary_type === btype);
                      if (bens.length === 0) return null;
                      return (
                        <div key={btype} className="mb-2">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-500 capitalize mb-1">
                            {btype}
                          </p>
                          {bens.map(b => (
                            <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-800">
                              <div>
                                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{b.name}</p>
                                {b.relationship && (
                                  <p className="text-xs text-gray-400 capitalize">{b.relationship}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  {parseFloat(b.percentage).toFixed(0)}%
                                </span>
                                <button
                                  onClick={() => handleDeleteBeneficiary(b.id)}
                                  className="text-gray-300 hover:text-red-500 text-xs transition"
                                >✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}

                    {/* Add beneficiary form */}
                    {showBenForm && (
                      <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
                        <Field label="Name" value={benForm.name} onChange={v => setBenForm(f => ({ ...f, name: v }))} required />
                        <SelectField
                          label="Type"
                          value={benForm.beneficiary_type}
                          onChange={v => setBenForm(f => ({ ...f, beneficiary_type: v }))}
                          options={[{ value: "primary", label: "Primary" }, { value: "contingent", label: "Contingent" }]}
                        />
                        <SelectField
                          label="Relationship"
                          value={benForm.relationship}
                          onChange={v => setBenForm(f => ({ ...f, relationship: v }))}
                          options={[
                            { value: "", label: "Select..." },
                            { value: "spouse", label: "Spouse" },
                            { value: "child", label: "Child" },
                            { value: "parent", label: "Parent" },
                            { value: "sibling", label: "Sibling" },
                            { value: "trust", label: "Trust" },
                            { value: "estate", label: "Estate" },
                            { value: "other", label: "Other" },
                          ]}
                        />
                        <Field
                          label="Percentage %"
                          value={benForm.percentage}
                          onChange={v => setBenForm(f => ({ ...f, percentage: v }))}
                          type="number"
                          placeholder="e.g. 50"
                          required
                        />
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={saveBeneficiary}
                            disabled={saving}
                            className="flex-1 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setShowBenForm(false)}
                            className="flex-1 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add/Edit Policy Modal ── */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
                  {editingId ? "Edit Policy" : "Add Insurance Policy"}
                </h2>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="Policy Type"
                  required
                  value={form.policy_type}
                  onChange={v => setForm(f => ({ ...f, policy_type: v as PolicyType }))}
                  options={Object.entries(POLICY_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                />
                <Field
                  label="Insurance Provider"
                  required
                  value={form.provider}
                  onChange={v => setForm(f => ({ ...f, provider: v }))}
                  placeholder="e.g. State Farm"
                />
                <Field
                  label="Policy Number"
                  value={form.policy_number || ""}
                  onChange={v => setForm(f => ({ ...f, policy_number: v }))}
                  placeholder="Optional"
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Field
                      label="Premium Amount"
                      type="number"
                      value={form.premium_amount_str}
                      onChange={v => setForm(f => ({ ...f, premium_amount_str: v }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="w-32">
                    <SelectField
                      label="Frequency"
                      value={form.premium_frequency}
                      onChange={v => setForm(f => ({ ...f, premium_frequency: v as PremiumFrequency }))}
                      options={[
                        { value: "monthly", label: "Monthly" },
                        { value: "quarterly", label: "Quarterly" },
                        { value: "semi_annual", label: "Semi-Annual" },
                        { value: "annual", label: "Annual" },
                        { value: "one_time", label: "One-Time" },
                      ]}
                    />
                  </div>
                </div>
                <Field
                  label={LIFE_TYPES.includes(form.policy_type) ? "Face Value / Death Benefit" : "Coverage Amount"}
                  type="number"
                  value={form.coverage_amount_str}
                  onChange={v => setForm(f => ({ ...f, coverage_amount_str: v }))}
                  placeholder="0.00"
                />
                {!LIFE_TYPES.includes(form.policy_type) && (
                  <Field
                    label="Deductible"
                    type="number"
                    value={form.deductible_str}
                    onChange={v => setForm(f => ({ ...f, deductible_str: v }))}
                    placeholder="0.00"
                  />
                )}
                <Field
                  label="Start Date"
                  type="date"
                  value={form.start_date || ""}
                  onChange={v => setForm(f => ({ ...f, start_date: v }))}
                />
                <Field
                  label="Renewal / Expiration Date"
                  type="date"
                  value={form.renewal_date || ""}
                  onChange={v => setForm(f => ({ ...f, renewal_date: v }))}
                />

                {/* Linked entity — conditional on policy type */}
                {(form.policy_type === "home" || form.policy_type === "renters") && properties.length > 0 && (
                  <div className="col-span-2">
                    <SelectField
                      label="Linked Property"
                      value={form.property_id || ""}
                      onChange={v => setForm(f => ({ ...f, property_id: v }))}
                      options={[
                        { value: "", label: "None" },
                        ...properties.map(p => ({
                          value: p.id,
                          label: `${p.address}${p.city ? ", " + p.city : ""}`,
                        })),
                      ]}
                    />
                  </div>
                )}

                {form.policy_type === "auto" && (
                  <div className="col-span-2">
                    {vehicles.length > 0 ? (
                      <SelectField
                        label="Linked Vehicle"
                        value={form.vehicle_id || ""}
                        onChange={v => setForm(f => ({ ...f, vehicle_id: v }))}
                        options={[
                          { value: "", label: "None" },
                          ...vehicles.map(v => ({ value: v.id, label: vehicleLabel(v) })),
                        ]}
                      />
                    ) : (
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Linked Vehicle</p>
                        <p className="text-xs text-gray-400">
                          No vehicles found.{" "}
                          <button
                            onClick={() => { setShowForm(false); setShowVehicles(true); }}
                            className="text-primary-600 hover:underline"
                          >
                            Add a vehicle first
                          </button>
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {PERSONAL_TYPES.includes(form.policy_type) && members.length > 0 && (
                  <div className="col-span-2">
                    <SelectField
                      label="Insured Member"
                      value={form.insured_user_id || ""}
                      onChange={v => setForm(f => ({ ...f, insured_user_id: v }))}
                      options={[
                        { value: "", label: "None / Household" },
                        ...members.map(m => ({ value: m.id, label: m.full_name || m.email })),
                      ]}
                    />
                  </div>
                )}

                {(form.policy_type === "business" || form.policy_type === "umbrella") && entities.length > 0 && (
                  <div className="col-span-2">
                    <SelectField
                      label="Business Entity"
                      value={form.entity_id || ""}
                      onChange={v => setForm(f => ({ ...f, entity_id: v }))}
                      options={[
                        { value: "", label: "None" },
                        ...entities.map(e => ({ value: e.id, label: e.name })),
                      ]}
                    />
                  </div>
                )}

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                  <textarea
                    value={form.notes || ""}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 w-full text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                    placeholder="Optional notes"
                  />
                </div>

                <div className="col-span-2 flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.auto_renew}
                      onChange={e => setForm(f => ({ ...f, auto_renew: e.target.checked }))}
                      className="rounded"
                    />
                    Auto-renews
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="rounded"
                    />
                    Active
                  </label>
                </div>
              </div>

              {error && (
                <p className="mt-3 text-sm text-red-500">{error}</p>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={savePolicy}
                  disabled={saving}
                  className="flex-1 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingId ? "Save Changes" : "Add Policy"}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Manage Vehicles Modal ── */}
      {showVehicles && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowVehicles(false); }}
        >
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-xl max-h-[80vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">🚗 Manage Vehicles</h2>
                <button onClick={() => setShowVehicles(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>

              {/* Existing vehicles */}
              {vehicles.length > 0 && (
                <div className="mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                        <th className="text-left py-2 font-medium">Vehicle</th>
                        <th className="text-left py-2 font-medium">VIN</th>
                        <th className="text-left py-2 font-medium">Color</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicles.map(v => (
                        <tr key={v.id} className="border-b border-gray-50 dark:border-gray-800">
                          <td className="py-2">
                            <div className="font-medium text-gray-800 dark:text-gray-200">{vehicleLabel(v)}</div>
                            {v.nickname && (
                              <div className="text-xs text-gray-400">{[v.year, v.make, v.model].filter(Boolean).join(" ")}</div>
                            )}
                          </td>
                          <td className="py-2 text-xs text-gray-500">{v.vin || "—"}</td>
                          <td className="py-2 text-xs text-gray-500">{v.color || "—"}</td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => setVehicleForm({ ...v })}
                                className="text-xs text-gray-400 hover:text-primary-600 transition"
                              >✏️</button>
                              <button
                                onClick={() => handleDeleteVehicle(v.id)}
                                className="text-xs text-gray-400 hover:text-red-500 transition"
                              >🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add/edit vehicle form */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wide">
                  {vehicleForm.id ? "Edit Vehicle" : "Add Vehicle"}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Make" required value={vehicleForm.make || ""} onChange={v => setVehicleForm(f => ({ ...f, make: v }))} placeholder="e.g. Toyota" />
                  <Field label="Model" required value={vehicleForm.model || ""} onChange={v => setVehicleForm(f => ({ ...f, model: v }))} placeholder="e.g. Camry" />
                  <Field label="Year" type="number" value={vehicleForm.year?.toString() || ""} onChange={v => setVehicleForm(f => ({ ...f, year: v ? parseInt(v) : undefined }))} placeholder="e.g. 2022" />
                  <Field label="Nickname" value={vehicleForm.nickname || ""} onChange={v => setVehicleForm(f => ({ ...f, nickname: v }))} placeholder="e.g. Wife's Car" />
                  <Field label="VIN" value={vehicleForm.vin || ""} onChange={v => setVehicleForm(f => ({ ...f, vin: v }))} placeholder="Optional" />
                  <Field label="Color" value={vehicleForm.color || ""} onChange={v => setVehicleForm(f => ({ ...f, color: v }))} placeholder="e.g. Silver" />
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={saveVehicle}
                    disabled={vehicleSaving}
                    className="flex-1 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {vehicleSaving ? "Saving..." : vehicleForm.id ? "Update" : "Add Vehicle"}
                  </button>
                  {vehicleForm.id && (
                    <button
                      onClick={() => setVehicleForm({ make: "", model: "" })}
                      className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 transition"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
