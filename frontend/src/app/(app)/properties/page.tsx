"use client";

import { useEffect, useState, memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  listProperties,
  updateProperty,
  deleteProperty,
  listLoans,
  createLoan,
  updateLoan,
  deleteLoan,
  listAccounts,
  listPropertyCosts,
  createPropertyCost,
  updatePropertyCost,
  deletePropertyCost,
  listMaintenanceExpenses,
  createMaintenanceExpense,
  updateMaintenanceExpense,
  deleteMaintenanceExpense,
  importMaintenanceExpenses,
  listPropertyValuations,
  createPropertyValuation,
  deletePropertyValuation,
  Account,
  Property,
  Loan,
  LoanCreate,
  PropertyCost,
  PropertyCostCreate,
  MaintenanceExpense,
  MaintenanceExpenseCreate,
  PropertyValuation,
} from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(val: string | null | number | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(val));
}

function fmtDec(val: string | null | number | undefined, decimals = 2): string {
  if (val === null || val === undefined || val === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(val));
}

function gain(current: string | null, costBasis: number): string {
  if (!current || costBasis === 0) return "—";
  const diff = Number(current) - costBasis;
  return `${diff >= 0 ? "+" : ""}${fmt(String(diff))}`;
}

function gainColor(current: string | null, costBasis: number): string {
  if (!current || costBasis === 0) return "text-gray-400";
  return Number(current) >= costBasis ? "text-green-600" : "text-red-600";
}

function typeLabel(type: string | null): string {
  const map: Record<string, string> = {
    single_family: "Single Family",
    condo: "Condo",
    townhouse: "Townhouse",
    multi_family: "Multi-Family",
    land: "Land",
    other: "Other",
  };
  return type ? (map[type] ?? type) : "—";
}

function costBasis(p: Property): number {
  return (p.purchase_price ? Number(p.purchase_price) : 0) +
    (p.closing_costs ? Number(p.closing_costs) : 0);
}

function totalLoanBalance(loans: Loan[]): number {
  return loans.reduce((s, l) => s + Number(l.current_balance ?? 0), 0);
}

function totalMonthlyLoanPayment(loans: Loan[]): number {
  return loans.reduce((s, l) => s + Number(l.monthly_payment ?? 0), 0);
}

function totalMonthlyRecurringCosts(costs: PropertyCost[]): number {
  return costs
    .filter((c) => c.is_active)
    .reduce((s, c) => s + toMonthly(Number(c.amount), c.frequency), 0);
}

// Monthly equivalent of any frequency
function toMonthly(amount: number, frequency: string): number {
  if (frequency === "monthly") return amount;
  if (frequency === "quarterly") return amount / 3;
  if (frequency === "annual") return amount / 12;
  return 0; // one_time not counted in monthly
}

const LOAN_TYPES = ["mortgage", "heloc", "second_mortgage", "other"];
const COST_CATEGORIES = ["hoa", "property_tax", "insurance", "maintenance", "utility", "other"];
const COST_FREQUENCIES = ["monthly", "quarterly", "annual", "one_time"];
const EXPENSE_CATEGORIES = [
  "repair", "appliance", "landscaping", "cleaning",
  "inspection", "plumbing", "electrical", "roofing", "hvac",
  "management_fee", "administrative", "leasing_fee", "other",
];

const COST_COLORS: Record<string, string> = {
  hoa: "bg-blue-100 text-blue-700",
  property_tax: "bg-purple-100 text-purple-700",
  insurance: "bg-yellow-100 text-yellow-700",
  maintenance: "bg-orange-100 text-orange-700",
  utility: "bg-teal-100 text-teal-700",
  other: "bg-gray-100 text-gray-600",
};

const EXPENSE_COLORS: Record<string, string> = {
  repair: "bg-red-100 text-red-700",
  appliance: "bg-blue-100 text-blue-700",
  landscaping: "bg-green-100 text-green-700",
  cleaning: "bg-teal-100 text-teal-700",
  inspection: "bg-yellow-100 text-yellow-700",
  plumbing: "bg-cyan-100 text-cyan-700",
  electrical: "bg-amber-100 text-amber-700",
  roofing: "bg-stone-100 text-stone-700",
  hvac: "bg-indigo-100 text-indigo-700",
  management_fee: "bg-violet-100 text-violet-700",
  administrative: "bg-pink-100 text-pink-700",
  leasing_fee: "bg-orange-100 text-orange-700",
  other: "bg-gray-100 text-gray-600",
};

// ─── Small UI components ──────────────────────────────────────────────────────

function CurrencyField({
  label, value, onChange, placeholder, hint,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
        <input
          type="number" min="0" step="any" value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "0"}
          className="border border-gray-300 rounded-lg pl-6 pr-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Field({
  label, type = "text", value, onChange, placeholder,
}: { label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}

function SelectField({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
        ))}
      </select>
    </div>
  );
}

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
        active
          ? "bg-primary-600 text-white"
          : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Edit Details form types ──────────────────────────────────────────────────

interface DetailForm {
  purchase_price: string;
  purchase_date: string;
  closing_costs: string;
  is_primary_residence: boolean;
  is_property_managed: boolean;
  management_fee_pct: string;
  leasing_fee_amount: string;
}

function toDetailForm(p: Property): DetailForm {
  return {
    purchase_price: p.purchase_price ? String(Number(p.purchase_price)) : "",
    purchase_date: p.purchase_date
      ? new Date(p.purchase_date).toISOString().split("T")[0]
      : "",
    closing_costs: p.closing_costs ? String(Number(p.closing_costs)) : "",
    is_primary_residence: p.is_primary_residence || false,
    is_property_managed: p.is_property_managed || false,
    management_fee_pct: p.management_fee_pct ? String(Number(p.management_fee_pct)) : "",
    leasing_fee_amount: p.leasing_fee_amount ? String(Number(p.leasing_fee_amount)) : "",
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Current value quick-edit
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Detail edit panel
  const [editingDetails, setEditingDetails] = useState<string | null>(null);
  const [detailForm, setDetailForm] = useState<DetailForm>({
    purchase_price: "", purchase_date: "", closing_costs: "",
  });
  const [savingDetails, setSavingDetails] = useState(false);

  const [deleting, setDeleting] = useState<string | null>(null);

  // Per-property tabs and data
  const [activeTab, setActiveTab] = useState<Record<string, string | null>>({});
  const [loans, setLoans] = useState<Record<string, Loan[]>>({});
  const [costs, setCosts] = useState<Record<string, PropertyCost[]>>({});
  const [expenses, setExpenses] = useState<Record<string, MaintenanceExpense[]>>({});
  const [valuations, setValuations] = useState<Record<string, PropertyValuation[]>>({});

  const token = getToken();

  useEffect(() => {
    if (!token) { router.replace("/login"); return; }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const props = await listProperties(token);
      setProperties(props);
      // Load loans + costs for all properties upfront (powers equity bar + monthly cost summary)
      if (props.length > 0) {
        const [allLoans, allCosts] = await Promise.all([
          Promise.all(props.map((p) => listLoans(p.id, token))),
          Promise.all(props.map((p) => listPropertyCosts(p.id, token))),
        ]);
        setLoans(Object.fromEntries(props.map((p, i) => [p.id, allLoans[i]])));
        setCosts(Object.fromEntries(props.map((p, i) => [p.id, allCosts[i]])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties");
    } finally {
      setLoading(false);
    }
  }

  // ── Tab toggling + lazy data loads ────────────────────────────────────────
  async function toggleTab(propertyId: string, tab: string) {
    if (!token) return;
    const current = activeTab[propertyId];
    if (current === tab) {
      setActiveTab((prev) => ({ ...prev, [propertyId]: null }));
      return;
    }
    setActiveTab((prev) => ({ ...prev, [propertyId]: tab }));
    setEditingDetails(null); // close details panel when opening a tab
    if (tab === "costs" && costs[propertyId] === undefined) {
      try {
        const data = await listPropertyCosts(propertyId, token);
        setCosts((prev) => ({ ...prev, [propertyId]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load costs");
      }
    }
    if (tab === "maintenance" && expenses[propertyId] === undefined) {
      try {
        const data = await listMaintenanceExpenses(propertyId, token);
        setExpenses((prev) => ({ ...prev, [propertyId]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load expenses");
      }
    }
    if (tab === "valuations" && valuations[propertyId] === undefined) {
      try {
        const data = await listPropertyValuations(propertyId, token);
        setValuations((prev) => ({ ...prev, [propertyId]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load value history");
      }
    }
  }

  // ── Current value quick-edit ──────────────────────────────────────────────
  async function saveValue(id: string) {
    if (!token) return;
    setSaving(true);
    try {
      const updated = await updateProperty(id, { current_value: editValue ? Number(editValue) : undefined }, token);
      setProperties((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update value");
    } finally {
      setSaving(false);
    }
  }

  // ── Detail edit panel ─────────────────────────────────────────────────────
  function openDetails(p: Property) {
    setDetailForm(toDetailForm(p));
    setEditingDetails(p.id);
    setEditing(null);
    setActiveTab((prev) => ({ ...prev, [p.id]: null }));
  }

  async function saveDetails(id: string) {
    if (!token) return;
    setSavingDetails(true);
    try {
      const payload: Record<string, unknown> = {};
      if (detailForm.purchase_price !== "") payload.purchase_price = Number(detailForm.purchase_price);
      else payload.purchase_price = null;
      if (detailForm.purchase_date) payload.purchase_date = new Date(detailForm.purchase_date).toISOString();
      else payload.purchase_date = null;
      if (detailForm.closing_costs !== "") payload.closing_costs = Number(detailForm.closing_costs);
      else payload.closing_costs = null;

      // Residence + management flags
      payload.is_primary_residence = detailForm.is_primary_residence;
      payload.is_property_managed = detailForm.is_property_managed;
      if (detailForm.management_fee_pct !== "") payload.management_fee_pct = Number(detailForm.management_fee_pct);
      else payload.management_fee_pct = null;
      if (detailForm.leasing_fee_amount !== "") payload.leasing_fee_amount = Number(detailForm.leasing_fee_amount);
      else payload.leasing_fee_amount = null;

      const updated = await updateProperty(id, payload, token);
      setProperties((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setEditingDetails(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update property");
    } finally {
      setSavingDetails(false);
    }
  }

  // ── Delete property ───────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!token) return;
    if (!confirm("Remove this property?")) return;
    setDeleting(id);
    try {
      await deleteProperty(id, token);
      setProperties((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete property");
    } finally {
      setDeleting(null);
    }
  }

  const totalValue = properties.reduce((sum, p) => sum + (p.current_value ? Number(p.current_value) : 0), 0);
  const totalCostBasis = properties.reduce((sum, p) => sum + costBasis(p), 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Real Estate</h2>
        <a href="/settings" className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">
          + Add Property
        </a>
      </div>

      {properties.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Current Value</p>
            <p className="text-2xl font-bold">{fmt(String(totalValue))}</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Cost Basis</p>
            <p className="text-2xl font-bold">{fmt(String(totalCostBasis))}</p>
            <p className="text-xs text-gray-400 mt-0.5">Purchase price + closing costs</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Gain / Loss</p>
            <p className={`text-2xl font-bold ${gainColor(String(totalValue), totalCostBasis)}`}>
              {gain(String(totalValue), totalCostBasis)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow border border-gray-100 p-12 text-center text-gray-400">
          Loading properties...
        </div>
      ) : properties.length === 0 ? (
        <div className="bg-white rounded-lg shadow border border-gray-100 p-12 text-center text-gray-400">
          <p className="text-lg mb-2">No properties added yet</p>
          <p className="text-sm mb-4">
            Go to <a href="/settings" className="text-primary-600 underline">Settings</a> to add your first property.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {properties.map((p) => {
            const basis = costBasis(p);
            const isEditingDetails = editingDetails === p.id;
            const propLoans = loans[p.id] ?? [];
            const propCosts = costs[p.id] ?? [];
            const loanBalance = totalLoanBalance(propLoans);
            const monthlyLoanPayment = totalMonthlyLoanPayment(propLoans);
            const monthlyRecurring = totalMonthlyRecurringCosts(propCosts);
            const monthlyCarrying = monthlyLoanPayment + monthlyRecurring;
            const curTab = activeTab[p.id] ?? null;

            return (
              <div key={p.id} className="bg-white rounded-xl shadow border border-gray-100 p-6">

                {/* ── Header ── */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">🏠</span>
                      <h3 className="font-semibold text-gray-900">{p.address}</h3>
                      <span className="text-xs bg-gray-100 text-gray-500 rounded px-2 py-0.5">
                        {typeLabel(p.property_type)}
                      </span>
                      {p.is_primary_residence && (
                        <span className="text-xs bg-green-100 text-green-700 rounded px-2 py-0.5 font-medium">
                          Primary Residence
                        </span>
                      )}
                    </div>
                    {(p.city || p.state || p.zip_code) && (
                      <p className="text-sm text-gray-500 ml-7">
                        {[p.city, p.state, p.zip_code].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {p.notes && <p className="text-xs text-gray-400 ml-7 mt-1">{p.notes}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <a href="/rentals" className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                      Manage Rentals →
                    </a>
                    <button
                      onClick={() => isEditingDetails ? setEditingDetails(null) : openDetails(p)}
                      className="text-xs text-gray-500 hover:text-primary-600 font-medium border border-gray-200 hover:border-primary-300 px-2 py-1 rounded-md transition"
                    >
                      {isEditingDetails ? "Cancel Edit" : "Edit Details"}
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={deleting === p.id}
                      className="text-gray-300 hover:text-red-400 transition text-sm disabled:opacity-50"
                      title="Remove property"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* ── Value row ── */}
                <div className="mt-4 flex flex-wrap gap-6 items-end">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Purchase Price</p>
                    <p className="font-medium text-gray-700">{fmt(p.purchase_price)}</p>
                  </div>
                  {p.purchase_date && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Purchase Date</p>
                      <p className="font-medium text-gray-700">
                        {new Date(p.purchase_date).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                    </div>
                  )}
                  {p.closing_costs && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Closing Costs</p>
                      <p className="font-medium text-gray-700">{fmt(p.closing_costs)}</p>
                    </div>
                  )}
                  {/* Current value quick-edit */}
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Current Value</p>
                    {editing === p.id ? (
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                          <input
                            type="number" min="0" step="any" autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="border border-primary-400 rounded px-2 pl-5 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveValue(p.id);
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                        </div>
                        <button onClick={() => saveValue(p.id)} disabled={saving}
                          className="text-xs bg-primary-600 text-white px-2 py-1 rounded hover:bg-primary-700 disabled:opacity-50">
                          {saving ? "..." : "Save"}
                        </button>
                        <button onClick={() => setEditing(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditing(p.id);
                          setEditValue(p.current_value ? String(Number(p.current_value)) : "");
                          setEditingDetails(null);
                          setActiveTab((prev) => ({ ...prev, [p.id]: null }));
                        }}
                        className="font-semibold text-gray-900 hover:text-primary-600 transition group flex items-center gap-1"
                        title="Click to update value"
                      >
                        {fmt(p.current_value)}
                        <span className="text-xs text-gray-300 group-hover:text-primary-400">✏</span>
                      </button>
                    )}
                  </div>
                  {loanBalance > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Liability</p>
                      <p className="font-medium text-red-500">{fmt(loanBalance)}</p>
                    </div>
                  )}
                  {monthlyCarrying > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Monthly Cost</p>
                      <p className="font-medium text-orange-600">{fmt(monthlyCarrying)}<span className="text-xs text-gray-400 font-normal">/mo</span></p>
                      {monthlyLoanPayment > 0 && monthlyRecurring > 0 && (
                        <p className="text-xs text-gray-400">
                          {fmt(monthlyLoanPayment)} mortgage + {fmt(monthlyRecurring)} costs
                        </p>
                      )}
                    </div>
                  )}
                  {p.current_value && basis > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Gain / Loss</p>
                      <p className={`font-medium ${gainColor(p.current_value, basis)}`}>
                        {gain(p.current_value, basis)}
                      </p>
                    </div>
                  )}
                  {p.last_valuation_date && (
                    <div className="ml-auto text-right">
                      <p className="text-xs text-gray-400">Last updated</p>
                      <p className="text-xs text-gray-500">
                        {new Date(p.last_valuation_date).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                    </div>
                  )}
                </div>

                {/* ── Equity bar (from loans) ── */}
                {p.current_value && loanBalance > 0 && (() => {
                  const value = Number(p.current_value);
                  const equity = value - loanBalance;
                  const equityPct = Math.max(0, Math.min(100, (equity / value) * 100));
                  return (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>
                          Equity{" "}
                          <span className={equity >= 0 ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                            {fmt(equity)} ({equityPct.toFixed(1)}%)
                          </span>
                        </span>
                        <span>
                          Total loan balance{" "}
                          <span className="text-gray-600 font-medium">{fmt(loanBalance)}</span>
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all duration-500"
                          style={{ width: `${equityPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* ── Edit Details panel ── */}
                {isEditingDetails && (
                  <div className="mt-5 pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                      Edit Purchase Details
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <CurrencyField
                        label="Purchase Price"
                        value={detailForm.purchase_price}
                        onChange={(v) => setDetailForm((f) => ({ ...f, purchase_price: v }))}
                        placeholder="450000"
                      />
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Purchase Date</label>
                        <input
                          type="date"
                          value={detailForm.purchase_date}
                          onChange={(e) => setDetailForm((f) => ({ ...f, purchase_date: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <CurrencyField
                        label="Closing Costs"
                        value={detailForm.closing_costs}
                        onChange={(v) => setDetailForm((f) => ({ ...f, closing_costs: v }))}
                        placeholder="8500"
                      />
                    </div>

                    {/* Primary Residence */}
                    <div className="border-t border-gray-100 pt-4 mt-2 mb-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={detailForm.is_primary_residence}
                          onChange={(e) => setDetailForm((f) => ({ ...f, is_primary_residence: e.target.checked }))}
                          className="w-4 h-4 text-primary-600 rounded focus:ring-2 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700 font-medium">Primary Residence</span>
                      </label>
                      <p className="text-xs text-gray-400 ml-6 mt-1">
                        Primary residences are excluded from the Rentals section
                      </p>
                    </div>

                    {/* Property Management */}
                    <div className="border-t border-gray-100 pt-4 mt-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                        Property Management
                      </p>
                      <div className="mb-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={detailForm.is_property_managed}
                            onChange={(e) => setDetailForm((f) => ({ ...f, is_property_managed: e.target.checked }))}
                            className="w-4 h-4 text-primary-600 rounded focus:ring-2 focus:ring-primary-500"
                          />
                          <span className="text-sm text-gray-700 font-medium">
                            Managed by Property Manager
                          </span>
                        </label>
                        <p className="text-xs text-gray-400 ml-6 mt-1">
                          Enable this if a property manager handles this property (management & leasing fees will be tracked)
                        </p>
                      </div>

                      {detailForm.is_property_managed && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Management Fee (%)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={detailForm.management_fee_pct}
                              onChange={(e) => setDetailForm((f) => ({ ...f, management_fee_pct: e.target.value }))}
                              placeholder="8.00"
                              className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                              % of monthly rent collected (e.g., 8 for 8%)
                            </p>
                          </div>
                          <CurrencyField
                            label="Leasing Fee (per lease)"
                            value={detailForm.leasing_fee_amount}
                            onChange={(v) => setDetailForm((f) => ({ ...f, leasing_fee_amount: v }))}
                            placeholder="500"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3 mt-4">
                      <button onClick={() => saveDetails(p.id)} disabled={savingDetails}
                        className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                        {savingDetails ? "Saving..." : "Save Changes"}
                      </button>
                      <button onClick={() => setEditingDetails(null)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Tab bar ── */}
                <div className="mt-4 pt-3 border-t border-gray-50 flex gap-2">
                  <TabBtn active={curTab === "loans"} onClick={() => toggleTab(p.id, "loans")}>
                    Loans {propLoans.length > 0 && `(${propLoans.length})`}
                  </TabBtn>
                  <TabBtn active={curTab === "costs"} onClick={() => toggleTab(p.id, "costs")}>
                    Recurring Costs {costs[p.id] && costs[p.id].length > 0 && `(${costs[p.id].length})`}
                  </TabBtn>
                  <TabBtn active={curTab === "maintenance"} onClick={() => toggleTab(p.id, "maintenance")}>
                    Maintenance Log {expenses[p.id] && expenses[p.id].length > 0 && `(${expenses[p.id].length})`}
                  </TabBtn>
                  <TabBtn active={curTab === "valuations"} onClick={() => toggleTab(p.id, "valuations")}>
                    Value History {valuations[p.id] && valuations[p.id].length > 0 && `(${valuations[p.id].length})`}
                  </TabBtn>
                </div>

                {/* ── Loans tab ── */}
                {curTab === "loans" && (
                  <LoansTab
                    propertyId={p.id}
                    loans={propLoans}
                    token={token!}
                    onUpdate={(updated) => setLoans((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Costs tab ── */}
                {curTab === "costs" && (
                  <CostsTab
                    propertyId={p.id}
                    costs={costs[p.id] ?? []}
                    token={token!}
                    onUpdate={(updated) => setCosts((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Maintenance tab ── */}
                {curTab === "maintenance" && (
                  <MaintenanceTab
                    propertyId={p.id}
                    expenses={expenses[p.id] ?? []}
                    token={token!}
                    onUpdate={(updated) => setExpenses((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Value History tab ── */}
                {curTab === "valuations" && (
                  <ValuationsTab
                    propertyId={p.id}
                    purchasePrice={p.purchase_price ? Number(p.purchase_price) : null}
                    valuations={valuations[p.id] ?? []}
                    token={token!}
                    onUpdate={(updated) => setValuations((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Loans Tab ────────────────────────────────────────────────────────────────

const BLANK_LOAN: LoanCreate = {
  account_id: null,
  lender_name: "", loan_type: "mortgage",
  original_amount: undefined, current_balance: undefined,
  interest_rate: undefined, monthly_payment: undefined,
  payment_due_day: undefined,
  escrow_included: false, escrow_amount: undefined,
  origination_date: undefined, maturity_date: undefined,
  term_months: undefined, notes: "",
};

function loanLabel(l: Loan): string {
  const type = l.loan_type.replace(/_/g, " ");
  return l.lender_name ? `${l.lender_name} (${type})` : type;
}

function LoanForm({
  form, setForm, onSave, onCancel, saving, saveLabel, accounts,
}: {
  form: LoanCreate & { [k: string]: unknown };
  setForm: React.Dispatch<React.SetStateAction<LoanCreate & { [k: string]: unknown }>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveLabel: string;
  accounts: import("@/lib/api").Account[];
}) {
  function numField(key: string): string {
    const v = form[key];
    return v !== undefined && v !== null && v !== "" ? String(v) : "";
  }
  function setNum(key: string, val: string) {
    setForm((f) => ({ ...f, [key]: val === "" ? undefined : Number(val) }));
  }

  return (
    <div className="mt-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
      {/* Account link row */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Link to Account <span className="text-gray-400 font-normal">(optional — balance will auto-sync)</span>
        </label>
        <select
          value={String(form.account_id ?? "")}
          onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value || null }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">— Not linked —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {[a.institution_name, a.name, a.mask ? `···${a.mask}` : ""].filter(Boolean).join(" · ")}
              {a.current_balance ? ` (${Number(a.current_balance).toLocaleString("en-US", { style: "currency", currency: "USD" })})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Lender Name" value={String(form.lender_name ?? "")}
          onChange={(v) => setForm((f) => ({ ...f, lender_name: v }))} placeholder="e.g. Chase" />
        <SelectField label="Loan Type" value={String(form.loan_type ?? "mortgage")}
          onChange={(v) => setForm((f) => ({ ...f, loan_type: v }))} options={LOAN_TYPES} />
        <CurrencyField label="Original Amount" value={numField("original_amount")}
          onChange={(v) => setNum("original_amount", v)} placeholder="400000" />
        <CurrencyField label="Current Balance" value={numField("current_balance")}
          onChange={(v) => setNum("current_balance", v)} placeholder="350000" />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Interest Rate (%)</label>
          <input type="number" min="0" step="0.001" value={numField("interest_rate")}
            onChange={(e) => setNum("interest_rate", e.target.value)} placeholder="6.875"
            className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <CurrencyField label="Monthly Payment (P&I)" value={numField("monthly_payment")}
          onChange={(v) => setNum("monthly_payment", v)} placeholder="2200" />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment Due Day</label>
          <input type="number" min="1" max="31" value={numField("payment_due_day")}
            onChange={(e) => setNum("payment_due_day", e.target.value)} placeholder="1"
            className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <Field label="Origination Date" type="date" value={String(form.origination_date ?? "")}
          onChange={(v) => setForm((f) => ({ ...f, origination_date: v || undefined }))} />
        <Field label="Maturity Date" type="date" value={String(form.maturity_date ?? "")}
          onChange={(v) => setForm((f) => ({ ...f, maturity_date: v || undefined }))} />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Term (months)</label>
          <input type="number" min="1" value={numField("term_months")}
            onChange={(e) => setNum("term_months", e.target.value)} placeholder="360"
            className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
      </div>
      {/* Escrow row */}
      <div className="mt-3 flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={Boolean(form.escrow_included)}
            onChange={(e) => setForm((f) => ({ ...f, escrow_included: e.target.checked }))}
            className="rounded" />
          Escrow included (taxes + insurance in payment)
        </label>
        {form.escrow_included && (
          <div className="w-48">
            <CurrencyField label="Monthly Escrow Amount" value={numField("escrow_amount")}
              onChange={(v) => setNum("escrow_amount", v)} placeholder="500" />
          </div>
        )}
      </div>
      <div className="mt-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
        <input type="text" value={String(form.notes ?? "")}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="Optional notes" />
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onSave} disabled={saving}
          className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {saving ? "Saving..." : saveLabel}
        </button>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">Cancel</button>
      </div>
    </div>
  );
}

function LoansTab({
  propertyId, loans, token, onUpdate,
}: {
  propertyId: string;
  loans: Loan[];
  token: string;
  onUpdate: (updated: Loan[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<LoanCreate & { [k: string]: unknown }>({ ...BLANK_LOAN });
  const [addSaving, setAddSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LoanCreate & { [k: string]: unknown }>({ ...BLANK_LOAN });
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tabError, setTabError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    listAccounts(token).then(setAccounts).catch(() => {});
  }, [token]);

  // Build a quick lookup: accountId → account name label
  const accountMap = Object.fromEntries(
    accounts.map((a) => [
      a.id,
      [a.institution_name, a.name, a.mask ? `···${a.mask}` : ""].filter(Boolean).join(" · "),
    ])
  );

  function loanToForm(l: Loan): LoanCreate & { [k: string]: unknown } {
    return {
      account_id: l.account_id ?? null,
      lender_name: l.lender_name ?? "",
      loan_type: l.loan_type,
      original_amount: l.original_amount ? Number(l.original_amount) : undefined,
      current_balance: l.current_balance ? Number(l.current_balance) : undefined,
      interest_rate: l.interest_rate ? Number(l.interest_rate) : undefined,
      monthly_payment: l.monthly_payment ? Number(l.monthly_payment) : undefined,
      payment_due_day: l.payment_due_day ?? undefined,
      escrow_included: l.escrow_included,
      escrow_amount: l.escrow_amount ? Number(l.escrow_amount) : undefined,
      origination_date: l.origination_date ?? undefined,
      maturity_date: l.maturity_date ?? undefined,
      term_months: l.term_months ?? undefined,
      notes: l.notes ?? "",
    };
  }

  async function handleAdd() {
    setAddSaving(true);
    setTabError("");
    try {
      const loan = await createLoan(propertyId, addForm as LoanCreate, token);
      onUpdate([...loans, loan]);
      setShowAdd(false);
      setAddForm({ ...BLANK_LOAN });
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to save loan");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleEdit(id: string) {
    setEditSaving(true);
    setTabError("");
    try {
      const loan = await updateLoan(id, editForm as LoanCreate, token);
      onUpdate(loans.map((l) => (l.id === id ? loan : l)));
      setEditId(null);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to update loan");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this loan?")) return;
    setDeletingId(id);
    setTabError("");
    try {
      await deleteLoan(id, token);
      onUpdate(loans.filter((l) => l.id !== id));
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to delete loan");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      {tabError && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
          {tabError}
        </div>
      )}
      {loans.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400 mb-3">No loans recorded yet.</p>
      )}
      <div className="space-y-3">
        {loans.map((l) => (
          <div key={l.id}>
            {editId === l.id ? (
              <LoanForm
                form={editForm} setForm={setEditForm}
                onSave={() => handleEdit(l.id)} onCancel={() => setEditId(null)}
                saving={editSaving} saveLabel="Save" accounts={accounts} />
            ) : (
              <div className="flex items-start justify-between gap-4 bg-gray-50 rounded-lg px-4 py-3">
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1">
                  <div>
                    <p className="text-xs text-gray-400">Loan</p>
                    <p className="text-sm font-medium text-gray-800">{loanLabel(l)}</p>
                    {l.account_id && accountMap[l.account_id] && (
                      <p className="text-xs text-emerald-600 mt-0.5" title="Balance syncs automatically from linked account">
                        ⟳ {accountMap[l.account_id]}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Balance</p>
                    <p className="text-sm font-semibold text-gray-900">{fmt(l.current_balance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Rate</p>
                    <p className="text-sm text-gray-700">
                      {l.interest_rate ? `${Number(l.interest_rate).toFixed(3)}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Payment / mo</p>
                    <p className="text-sm text-gray-700">
                      {l.monthly_payment ? fmtDec(l.monthly_payment) : "—"}
                      {l.escrow_included && (
                        <span className="ml-1 text-xs text-blue-500" title="Escrow included">✓ escrow</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setEditId(l.id); setEditForm(loanToForm(l)); }}
                    className="text-xs text-gray-400 hover:text-primary-600 transition">Edit</button>
                  <button
                    onClick={() => handleDelete(l.id)} disabled={deletingId === l.id}
                    className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-40">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {showAdd ? (
        <LoanForm
          form={addForm} setForm={setAddForm}
          onSave={handleAdd} onCancel={() => { setShowAdd(false); setAddForm({ ...BLANK_LOAN }); }}
          saving={addSaving} saveLabel="Add Loan" accounts={accounts} />
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium">
          + Add Loan
        </button>
      )}
    </div>
  );
}

// ─── Costs Tab ────────────────────────────────────────────────────────────────

const BLANK_COST: PropertyCostCreate = {
  category: "other", label: "", amount: 0, frequency: "monthly", is_active: true, notes: "",
};

function CostsTab({
  propertyId, costs, token, onUpdate,
}: {
  propertyId: string;
  costs: PropertyCost[];
  token: string;
  onUpdate: (updated: PropertyCost[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...BLANK_COST, amount: "" as unknown as number });
  const [addSaving, setAddSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ...BLANK_COST, amount: "" as unknown as number });
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tabError, setTabError] = useState("");

  function costToForm(c: PropertyCost) {
    return {
      category: c.category, label: c.label ?? "",
      amount: Number(c.amount) as unknown as number,
      frequency: c.frequency, is_active: c.is_active, notes: c.notes ?? "",
    };
  }

  async function handleAdd() {
    setAddSaving(true);
    setTabError("");
    try {
      const created = await createPropertyCost(propertyId, {
        ...addForm, amount: Number(addForm.amount),
        label: addForm.label || undefined, notes: addForm.notes || undefined,
      } as PropertyCostCreate, token);
      onUpdate([...costs, created]);
      setShowAdd(false);
      setAddForm({ ...BLANK_COST, amount: "" as unknown as number });
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to save cost");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleEdit(id: string) {
    setEditSaving(true);
    setTabError("");
    try {
      const updated = await updatePropertyCost(id, {
        ...editForm, amount: Number(editForm.amount),
        label: editForm.label || undefined, notes: editForm.notes || undefined,
      } as PropertyCostCreate, token);
      onUpdate(costs.map((c) => (c.id === id ? updated : c)));
      setEditId(null);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to update cost");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this recurring cost?")) return;
    setDeletingId(id);
    setTabError("");
    try {
      await deletePropertyCost(id, token);
      onUpdate(costs.filter((c) => c.id !== id));
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to delete cost");
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleActive(c: PropertyCost) {
    setTabError("");
    try {
      const updated = await updatePropertyCost(c.id, { is_active: !c.is_active }, token);
      onUpdate(costs.map((x) => (x.id === c.id ? updated : x)));
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to update cost");
    }
  }

  const activeCosts = costs.filter((c) => c.is_active);
  const monthlyTotal = activeCosts.reduce(
    (sum, c) => sum + toMonthly(Number(c.amount), c.frequency), 0
  );

  function CostFormFields({
    form, setForm,
  }: { form: typeof addForm; setForm: React.Dispatch<React.SetStateAction<typeof addForm>> }) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectField label="Category" value={form.category}
          onChange={(v) => setForm((f) => ({ ...f, category: v }))} options={COST_CATEGORIES} />
        <Field label="Label / Description" value={form.label ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, label: v }))} placeholder="e.g. HOA - Lakeside Commons" />
        <CurrencyField label="Amount" value={String(form.amount === 0 ? "" : form.amount)}
          onChange={(v) => setForm((f) => ({ ...f, amount: v as unknown as number }))} />
        <SelectField label="Frequency" value={form.frequency}
          onChange={(v) => setForm((f) => ({ ...f, frequency: v }))} options={COST_FREQUENCIES} />
        <Field label="Notes (optional)" value={form.notes ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      {tabError && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
          {tabError}
        </div>
      )}
      {costs.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400 mb-3">No recurring costs recorded yet.</p>
      )}
      <div className="space-y-2">
        {costs.map((c) => (
          <div key={c.id}>
            {editId === c.id ? (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <CostFormFields form={editForm} setForm={setEditForm} />
                <div className="mt-3 flex gap-2">
                  <button onClick={() => handleEdit(c.id)} disabled={editSaving}
                    className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                    {editSaving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => setEditId(null)} className="text-sm text-gray-400 hover:text-gray-600 px-3">Cancel</button>
                </div>
              </div>
            ) : (
              <div className={`flex items-center justify-between gap-4 rounded-lg px-4 py-2.5 ${c.is_active ? "bg-gray-50" : "bg-gray-50 opacity-50"}`}>
                <div className="flex items-center gap-3 flex-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${COST_COLORS[c.category] ?? COST_COLORS.other}`}>
                    {c.category.replace(/_/g, " ")}
                  </span>
                  <span className="text-sm text-gray-700">{c.label || "—"}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{fmtDec(c.amount)}</p>
                    <p className="text-xs text-gray-400">{c.frequency}</p>
                  </div>
                  <button onClick={() => toggleActive(c)} title={c.is_active ? "Deactivate" : "Activate"}
                    className="text-xs text-gray-300 hover:text-amber-500 transition">
                    {c.is_active ? "●" : "○"}
                  </button>
                  <button onClick={() => { setEditId(c.id); setEditForm(costToForm(c)); }}
                    className="text-xs text-gray-400 hover:text-primary-600 transition">Edit</button>
                  <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id}
                    className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-40">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd ? (
        <div className="mt-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
          <CostFormFields form={addForm} setForm={setAddForm} />
          <div className="mt-3 flex gap-2">
            <button onClick={handleAdd} disabled={addSaving}
              className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {addSaving ? "Saving..." : "Add Cost"}
            </button>
            <button onClick={() => { setShowAdd(false); setAddForm({ ...BLANK_COST, amount: "" as unknown as number }); }}
              className="text-sm text-gray-400 hover:text-gray-600 px-3">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium">
          + Add Recurring Cost
        </button>
      )}

      {activeCosts.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-sm">
          <span className="text-gray-500">Monthly equivalent (active costs)</span>
          <span className="font-semibold text-gray-900">{fmtDec(monthlyTotal)}/mo</span>
        </div>
      )}
    </div>
  );
}

// ─── Maintenance Tab ──────────────────────────────────────────────────────────

const BLANK_EXPENSE: MaintenanceExpenseCreate = {
  expense_date: "", amount: 0, category: "other", description: "", vendor: "", is_capex: false, notes: "",
};

type ExpenseForm = Partial<MaintenanceExpenseCreate> & { amount: number | string };

const ExpenseFormFields = memo(function ExpenseFormFields({
  form, onFormChange,
}: {
  form: ExpenseForm;
  onFormChange: (updates: Partial<ExpenseForm>) => void;
}) {
  const handleDateChange = useCallback((v: string) => onFormChange({ expense_date: v }), [onFormChange]);
  const handleAmountChange = useCallback((v: string) => onFormChange({ amount: v as unknown as number }), [onFormChange]);
  const handleCategoryChange = useCallback((v: string) => onFormChange({ category: v }), [onFormChange]);
  const handleDescriptionChange = useCallback((v: string) => onFormChange({ description: v }), [onFormChange]);
  const handleVendorChange = useCallback((v: string) => onFormChange({ vendor: v }), [onFormChange]);
  const handleNotesChange = useCallback((v: string) => onFormChange({ notes: v }), [onFormChange]);
  const handleCapexChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFormChange({ is_capex: e.target.checked }), [onFormChange]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label="Date" type="date" value={form.expense_date ?? ""} onChange={handleDateChange} />
      <CurrencyField label="Amount" value={String(form.amount === 0 ? "" : form.amount)} onChange={handleAmountChange} />
      <SelectField label="Category" value={form.category ?? "other"} onChange={handleCategoryChange} options={EXPENSE_CATEGORIES} />
      <div className="md:col-span-2">
        <Field label="Description" value={form.description ?? ""} onChange={handleDescriptionChange} placeholder="e.g. HVAC repair" />
      </div>
      <Field label="Vendor (optional)" value={form.vendor ?? ""} onChange={handleVendorChange} placeholder="e.g. ABC Plumbing" />
      <div className="md:col-span-3">
        <Field label="Notes (optional)" value={form.notes ?? ""} onChange={handleNotesChange} />
      </div>
      <div className="md:col-span-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={Boolean(form.is_capex)}
            onChange={handleCapexChange}
            className="rounded"
          />
          <span>Capital Expenditure (CapEx)</span>
          <span className="text-xs text-gray-400">— excluded from NOI calculation</span>
        </label>
      </div>
    </div>
  );
});

function MaintenanceTab({
  propertyId, expenses, token, onUpdate,
}: {
  propertyId: string;
  expenses: MaintenanceExpense[];
  token: string;
  onUpdate: (updated: MaintenanceExpense[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...BLANK_EXPENSE, amount: "" as unknown as number });
  const [addSaving, setAddSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ...BLANK_EXPENSE, amount: "" as unknown as number });
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tabError, setTabError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: { row: number; error: string }[] } | null>(null);

  function expenseToForm(e: MaintenanceExpense) {
    return {
      expense_date: e.expense_date,
      amount: Number(e.amount) as unknown as number,
      category: e.category,
      description: e.description,
      vendor: e.vendor ?? "",
      is_capex: e.is_capex,
      notes: e.notes ?? "",
    };
  }

  async function handleAdd() {
    if (!addForm.expense_date || !addForm.description) return;
    setAddSaving(true);
    setTabError("");
    try {
      const created = await createMaintenanceExpense(propertyId, {
        ...addForm,
        amount: Number(addForm.amount),
        vendor: addForm.vendor || undefined,
        notes: addForm.notes || undefined,
      } as MaintenanceExpenseCreate, token);
      onUpdate([created, ...expenses]);
      setShowAdd(false);
      setAddForm({ ...BLANK_EXPENSE, amount: "" as unknown as number });
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to save expense");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleEdit(id: string) {
    setEditSaving(true);
    setTabError("");
    try {
      const updated = await updateMaintenanceExpense(id, {
        ...editForm,
        amount: Number(editForm.amount),
        vendor: editForm.vendor || undefined,
        notes: editForm.notes || undefined,
      } as MaintenanceExpenseCreate, token);
      onUpdate(expenses.map((e) => (e.id === id ? updated : e)));
      setEditId(null);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to update expense");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this expense?")) return;
    setDeletingId(id);
    setTabError("");
    try {
      await deleteMaintenanceExpense(id, token);
      onUpdate(expenses.filter((e) => e.id !== id));
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to delete expense");
    } finally {
      setDeletingId(null);
    }
  }

  function downloadTemplate() {
    const header = "expense_date,amount,description,vendor,category,notes";
    const examples = [
      "2024-03-15,250.00,Plumbing repair - kitchen sink,ABC Plumbing,plumbing,",
      "2024-04-01,150.00,Lawn mowing,Green Lawn Co,landscaping,April service",
      "2024-05-20,800.00,HVAC filter replacement and service,,,Annual tune-up",
    ].join("\n");
    const blob = new Blob([header + "\n" + examples], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "maintenance_expenses_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    setTabError("");
    setImportResult(null);
    try {
      const result = await importMaintenanceExpenses(propertyId, importFile, token);
      setImportResult(result);
      if (result.imported > 0) {
        // Reload the expenses list
        const refreshed = await listMaintenanceExpenses(propertyId, token);
        onUpdate(refreshed);
      }
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const thisYear = new Date().getFullYear();
  const ytdTotal = expenses
    .filter((e) => new Date(e.expense_date).getFullYear() === thisYear)
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const allTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  const handleAddFormChange = useCallback((updates: Partial<ExpenseForm>) => {
    setAddForm((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleEditFormChange = useCallback((updates: Partial<ExpenseForm>) => {
    setEditForm((prev) => ({ ...prev, ...updates }));
  }, []);

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      {tabError && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
          {tabError}
        </div>
      )}
      {expenses.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400 mb-3">No maintenance expenses recorded yet.</p>
      )}

      <div className="space-y-2">
        {expenses.map((e) => (
          <div key={e.id}>
            {editId === e.id ? (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <ExpenseFormFields form={editForm} onFormChange={handleEditFormChange} />
                <div className="mt-3 flex gap-2">
                  <button onClick={() => handleEdit(e.id)} disabled={editSaving}
                    className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                    {editSaving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => setEditId(null)} className="text-sm text-gray-400 hover:text-gray-600 px-3">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 bg-gray-50 rounded-lg px-4 py-2.5">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(e.expense_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${EXPENSE_COLORS[e.category] ?? EXPENSE_COLORS.other}`}>
                    {e.category.replace(/_/g, " ")}
                  </span>
                  {e.is_capex && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0 bg-purple-100 text-purple-700">
                      CapEx
                    </span>
                  )}
                  <span className="text-sm text-gray-700 truncate">{e.description}</span>
                  {e.vendor && <span className="text-xs text-gray-400 truncate">· {e.vendor}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-gray-900">{fmtDec(e.amount)}</span>
                  <button onClick={() => { setEditId(e.id); setEditForm(expenseToForm(e)); }}
                    className="text-xs text-gray-400 hover:text-primary-600 transition">Edit</button>
                  <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id}
                    className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-40">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd ? (
        <div className="mt-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
          <ExpenseFormFields form={addForm} onFormChange={handleAddFormChange} />
          <div className="mt-3 flex gap-2">
            <button onClick={handleAdd} disabled={addSaving || !addForm.expense_date || !addForm.description}
              className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {addSaving ? "Saving..." : "Add Expense"}
            </button>
            <button onClick={() => { setShowAdd(false); setAddForm({ ...BLANK_EXPENSE, amount: "" as unknown as number }); }}
              className="text-sm text-gray-400 hover:text-gray-600 px-3">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <button onClick={() => { setShowAdd(true); setShowImport(false); }}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            + Add Expense
          </button>
          <button
            onClick={() => { setShowImport((v) => !v); setShowAdd(false); setImportResult(null); }}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium border border-gray-200 hover:border-gray-300 px-2.5 py-1 rounded-md transition"
          >
            {showImport ? "Cancel Import" : "Import CSV"}
          </button>
        </div>
      )}

      {/* ── CSV Import panel ── */}
      {showImport && !showAdd && (
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-blue-800">Import Maintenance Expenses</p>
            <button
              onClick={downloadTemplate}
              className="text-xs text-blue-600 hover:text-blue-800 underline font-medium"
            >
              Download template CSV
            </button>
          </div>
          <p className="text-xs text-blue-600 mb-3">
            Required columns: <strong>expense_date</strong> (YYYY-MM-DD), <strong>amount</strong>, <strong>description</strong>.
            Optional: vendor, category, notes. Category is auto-detected from description if not provided.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null); }}
              className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-white file:text-primary-600 file:hover:bg-gray-50 file:cursor-pointer"
            />
            <button
              onClick={handleImport}
              disabled={!importFile || importing}
              className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 shrink-0"
            >
              {importing ? "Importing..." : "Import"}
            </button>
          </div>
          {importResult && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-green-700">
                {importResult.imported} expense{importResult.imported !== 1 ? "s" : ""} imported successfully.
              </p>
              {importResult.errors.length > 0 && (
                <div className="mt-1">
                  <p className="text-xs font-medium text-red-600 mb-1">
                    {importResult.errors.length} row{importResult.errors.length !== 1 ? "s" : ""} skipped:
                  </p>
                  <ul className="space-y-0.5">
                    {importResult.errors.map((err) => (
                      <li key={err.row} className="text-xs text-red-600">
                        Row {err.row}: {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {expenses.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex gap-6 text-sm">
          <span className="text-gray-500">
            YTD ({thisYear}): <span className="font-semibold text-gray-900">{fmtDec(ytdTotal)}</span>
          </span>
          <span className="text-gray-500">
            All-time: <span className="font-semibold text-gray-900">{fmtDec(allTotal)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Value History Tab ────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  appraisal: "Appraisal",
  zillow: "Zillow",
  redfin: "Redfin",
};

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-gray-100 text-gray-600",
  appraisal: "bg-blue-100 text-blue-700",
  zillow: "bg-indigo-100 text-indigo-700",
  redfin: "bg-red-100 text-red-700",
};

function ValuationsTab({
  propertyId, purchasePrice, valuations, token, onUpdate,
}: {
  propertyId: string;
  purchasePrice: number | null;
  valuations: PropertyValuation[];
  token: string;
  onUpdate: (updated: PropertyValuation[]) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ value: "", source: "manual", valuation_date: today, notes: "" });
  const [saving, setSaving] = useState(false);
  const [tabError, setTabError] = useState("");

  // Chart data — sorted ascending by date for left-to-right rendering
  const chartData = [...valuations]
    .sort((a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime())
    .map((v) => ({
      date: new Date(v.valuation_date).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      value: Number(v.value),
    }));

  // Add purchase price as the first data point if it exists and is earlier
  if (purchasePrice && chartData.length === 0) {
    chartData.push({ date: "Purchase", value: purchasePrice });
  }

  async function handleAdd() {
    if (!addForm.value) return;
    setSaving(true);
    setTabError("");
    try {
      const created = await createPropertyValuation(propertyId, {
        value: Number(addForm.value),
        source: addForm.source,
        valuation_date: addForm.valuation_date ? new Date(addForm.valuation_date).toISOString() : undefined,
        notes: addForm.notes || undefined,
      }, token);
      onUpdate([created, ...valuations]);
      setAddForm({ value: "", source: "manual", valuation_date: today, notes: "" });
      setShowAdd(false);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this valuation snapshot?")) return;
    try {
      await deletePropertyValuation(id, token);
      onUpdate(valuations.filter((v) => v.id !== id));
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      {tabError && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
          {tabError}
        </div>
      )}

      {/* Chart */}
      {chartData.length >= 2 && (
        <div className="mb-4 bg-gray-50 rounded-lg p-4 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-3">Value Over Time</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={52}
              />
              <Tooltip
                formatter={(v: number) => [fmt(v), "Value"]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6366f1" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* List */}
      {valuations.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400 mb-3">No value snapshots yet. Add one to start tracking.</p>
      )}
      <div className="space-y-2 mb-3">
        {valuations.map((v) => (
          <div key={v.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 border border-gray-100 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-900">{fmt(v.value)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[v.source] ?? "bg-gray-100 text-gray-600"}`}>
                {SOURCE_LABELS[v.source] ?? v.source}
              </span>
              <span className="text-gray-400 text-xs">
                {new Date(v.valuation_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              {v.notes && <span className="text-gray-400 text-xs italic">{v.notes}</span>}
            </div>
            <button
              onClick={() => handleDelete(v.id)}
              className="text-gray-300 hover:text-red-400 transition text-xs"
              title="Delete snapshot"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd ? (
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <CurrencyField label="Estimated Value" value={addForm.value}
              onChange={(v) => setAddForm((f) => ({ ...f, value: v }))} placeholder="500000" />
            <SelectField label="Source" value={addForm.source}
              onChange={(v) => setAddForm((f) => ({ ...f, source: v }))}
              options={["manual", "appraisal", "zillow", "redfin"]} />
            <Field label="Date" type="date" value={addForm.valuation_date}
              onChange={(v) => setAddForm((f) => ({ ...f, valuation_date: v }))} />
            <Field label="Notes (optional)" value={addForm.notes}
              onChange={(v) => setAddForm((f) => ({ ...f, notes: v }))} placeholder="e.g. Post-renovation" />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={handleAdd} disabled={saving || !addForm.value}
              className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {saving ? "Saving..." : "Save Snapshot"}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs text-primary-600 hover:text-primary-700 font-medium border border-primary-200 hover:border-primary-400 px-3 py-1.5 rounded-lg transition"
        >
          + Add Snapshot
        </button>
      )}
    </div>
  );
}
