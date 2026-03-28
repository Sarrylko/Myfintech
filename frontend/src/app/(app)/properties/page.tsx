"use client";

import { useEffect, useState, memo, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  listProperties,
  createProperty,
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
  listPropertyDocuments,
  uploadPropertyDocument,
  downloadPropertyDocument,
  deletePropertyDocument,
  listPropertyCostStatuses,
  upsertPropertyCostStatus,
  listBusinessEntities,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  Account,
  Property,
  Loan,
  LoanCreate,
  PropertyCost,
  PropertyCostCreate,
  MaintenanceExpense,
  MaintenanceExpenseCreate,
  PropertyValuation,
  PropertyDocument,
  PropertyCostStatus,
  BusinessEntityResponse,
  InsurancePolicy,
  InsurancePolicyCreate,
  PolicyType,
  PremiumFrequency,
  PropertyCreate,
} from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useCurrency } from "@/lib/currency";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { fmtInCurrency, convertToUSD } from "@/lib/forex";
import { useForex } from "@/components/ForexProvider";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function gain(current: string | null, costBasis: number, fmtFn: (v: string | null | number | undefined) => string): string {
  if (!current || costBasis === 0) return "—";
  const diff = Number(current) - costBasis;
  return `${diff >= 0 ? "+" : ""}${fmtFn(String(diff))}`;
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
    .filter((c) => c.is_active && !c.is_escrowed)
    .reduce((s, c) => s + toMonthly(Number(c.amount), c.frequency), 0);
}

// Monthly equivalent of any frequency
function toMonthly(amount: number, frequency: string): number {
  if (frequency === "monthly") return amount;
  if (frequency === "quarterly") return amount / 3;
  if (frequency === "semi_annual") return amount / 6;
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
  label, value, onChange, placeholder, hint, symbol = "$",
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; symbol?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{symbol}</span>
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
  country: string;
  currency_code: string;
  purchase_price: string;
  purchase_date: string;
  closing_costs: string;
  is_primary_residence: boolean;
  is_property_managed: boolean;
  management_fee_pct: string;
  leasing_fee_amount: string;
  zillow_url: string;
  redfin_url: string;
  county: string;
  pin: string;
  entity_id: string;
}

function toDetailForm(p: Property): DetailForm {
  return {
    country: p.country ?? "US",
    currency_code: p.currency_code ?? "USD",
    purchase_price: p.purchase_price ? String(Number(p.purchase_price)) : "",
    purchase_date: p.purchase_date
      ? new Date(p.purchase_date).toISOString().split("T")[0]
      : "",
    closing_costs: p.closing_costs ? String(Number(p.closing_costs)) : "",
    is_primary_residence: p.is_primary_residence || false,
    is_property_managed: p.is_property_managed || false,
    management_fee_pct: p.management_fee_pct ? String(Number(p.management_fee_pct)) : "",
    leasing_fee_amount: p.leasing_fee_amount ? String(Number(p.leasing_fee_amount)) : "",
    zillow_url: p.zillow_url ?? "",
    redfin_url: p.redfin_url ?? "",
    county: p.county ?? "",
    pin: p.pin ?? "",
    entity_id: p.entity_id ?? "",
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertiesPage() {
  const { fmt: fmtRaw, fmtDate, locale, currency: householdCurrency } = useCurrency();
  const { rates: fxRates } = useForex();
  // Look up the symbol for a currency code
  const currencySymbol = (code: string) =>
    CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
  const fmt = (val: string | null | number | undefined): string => {
    if (val === null || val === undefined || val === "") return "—";
    return fmtRaw(Number(val));
  };
  // Format a monetary amount in the property's own currency when it differs from the household's
  const fmtProp = (
    val: string | null | number | undefined,
    currencyCode: string | null | undefined
  ): string => {
    if (val === null || val === undefined || val === "") return "—";
    const code = currencyCode || householdCurrency;
    if (code && code !== householdCurrency) {
      return fmtInCurrency(Number(val), code);
    }
    return fmtRaw(Number(val));
  };
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Current value quick-edit
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Business entities (for property linking)
  const [entities, setEntities] = useState<BusinessEntityResponse[]>([]);

  // Detail edit panel
  const [editingDetails, setEditingDetails] = useState<string | null>(null);
  const [detailForm, setDetailForm] = useState<DetailForm>({
    country: "US", currency_code: "USD",
    purchase_price: "", purchase_date: "", closing_costs: "",
    is_primary_residence: false, is_property_managed: false,
    management_fee_pct: "", leasing_fee_amount: "",
    zillow_url: "", redfin_url: "", county: "", pin: "", entity_id: "",
  });
  const [savingDetails, setSavingDetails] = useState(false);

  const [deleting, setDeleting] = useState<string | null>(null);

  // Add property modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    address: "", city: "", state: "", zip_code: "",
    country: "US", currency_code: "USD", property_type: "",
    is_primary_residence: false, current_value: "",
    purchase_price: "", purchase_date: "", notes: "",
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Per-property tabs and data
  const [activeTab, setActiveTab] = useState<Record<string, string | null>>({});
  const [loans, setLoans] = useState<Record<string, Loan[]>>({});
  const [costs, setCosts] = useState<Record<string, PropertyCost[]>>({});
  const [expenses, setExpenses] = useState<Record<string, MaintenanceExpense[]>>({});
  const [valuations, setValuations] = useState<Record<string, PropertyValuation[]>>({});
  const [documents, setDocuments] = useState<Record<string, PropertyDocument[]>>({});
  const [costStatuses, setCostStatuses] = useState<Record<string, PropertyCostStatus[]>>({});
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null); // "propId-category"
  const [propInsurance, setPropInsurance] = useState<Record<string, InsurancePolicy[]>>({});

  useEffect(() => {
    load();
    listBusinessEntities().then(setEntities).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const props = await listProperties();
      setProperties(props);
      // Load loans + costs for all properties upfront (powers equity bar + monthly cost summary)
      if (props.length > 0) {
        const [allLoans, allCosts, allStatuses] = await Promise.all([
          Promise.all(props.map((p) => listLoans(p.id))),
          Promise.all(props.map((p) => listPropertyCosts(p.id))),
          Promise.all(props.map((p) => listPropertyCostStatuses(p.id))),
        ]);
        setLoans(Object.fromEntries(props.map((p, i) => [p.id, allLoans[i]])));
        setCosts(Object.fromEntries(props.map((p, i) => [p.id, allCosts[i]])));
        setCostStatuses(Object.fromEntries(props.map((p, i) => [p.id, allStatuses[i]])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties");
    } finally {
      setLoading(false);
    }
  }

  // ── Cost status toggle ────────────────────────────────────────────────────
  const CURRENT_YEAR = new Date().getFullYear();

  async function toggleCostStatus(propertyId: string, category: string) {
    const key = `${propertyId}-${category}`;
    if (togglingStatus === key) return;
    const statuses = costStatuses[propertyId] ?? [];
    const existing = statuses.find((s) => s.year === CURRENT_YEAR && s.category === category);
    const newIsPaid = !(existing?.is_paid ?? false);
    setTogglingStatus(key);
    try {
      const updated = await upsertPropertyCostStatus(propertyId, CURRENT_YEAR, category, newIsPaid);
      setCostStatuses((prev) => {
        const list = (prev[propertyId] ?? []).filter(
          (s) => !(s.year === CURRENT_YEAR && s.category === category)
        );
        return { ...prev, [propertyId]: [...list, updated] };
      });
    } catch {
      // silently ignore — UI reverts
    } finally {
      setTogglingStatus(null);
    }
  }

  // ── Tab toggling + lazy data loads ────────────────────────────────────────
  async function toggleTab(propertyId: string, tab: string) {
    const current = activeTab[propertyId];
    if (current === tab) {
      setActiveTab((prev) => ({ ...prev, [propertyId]: null }));
      return;
    }
    setActiveTab((prev) => ({ ...prev, [propertyId]: tab }));
    setEditingDetails(null); // close details panel when opening a tab
    if (tab === "costs") {
      if (costs[propertyId] === undefined) {
        try {
          const data = await listPropertyCosts(propertyId);
          setCosts((prev) => ({ ...prev, [propertyId]: data }));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load costs");
        }
      }
      if (propInsurance[propertyId] === undefined) {
        try {
          const data = await listPolicies({ property_id: propertyId });
          setPropInsurance((prev) => ({ ...prev, [propertyId]: data }));
        } catch { /* silently skip — insurance rows just won't show */ }
      }
    }
    if (tab === "maintenance" && expenses[propertyId] === undefined) {
      try {
        const data = await listMaintenanceExpenses(propertyId);
        setExpenses((prev) => ({ ...prev, [propertyId]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load expenses");
      }
    }
    if (tab === "valuations" && valuations[propertyId] === undefined) {
      try {
        const data = await listPropertyValuations(propertyId);
        setValuations((prev) => ({ ...prev, [propertyId]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load value history");
      }
    }
    if (tab === "documents" && documents[propertyId] === undefined) {
      try {
        const data = await listPropertyDocuments(propertyId);
        setDocuments((prev) => ({ ...prev, [propertyId]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load documents");
      }
    }
    if (tab === "insurance" && propInsurance[propertyId] === undefined) {
      try {
        const data = await listPolicies({ property_id: propertyId });
        setPropInsurance((prev) => ({ ...prev, [propertyId]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load insurance policies");
      }
    }
  }

  // ── Current value quick-edit ──────────────────────────────────────────────
  async function saveValue(id: string) {
    setSaving(true);
    try {
      const updated = await updateProperty(id, { current_value: editValue ? Number(editValue) : undefined });
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
      payload.zillow_url = detailForm.zillow_url.trim() || null;
      payload.redfin_url = detailForm.redfin_url.trim() || null;
      payload.country = detailForm.country || "US";
      payload.currency_code = detailForm.currency_code || "USD";
      payload.county = detailForm.county.trim() || null;
      payload.pin = detailForm.pin.trim() || null;
      payload.entity_id = detailForm.entity_id || null;

      const updated = await updateProperty(id, payload);
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
    if (!confirm("Remove this property?")) return;
    setDeleting(id);
    try {
      await deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete property");
    } finally {
      setDeleting(null);
    }
  }

  async function handleAddProperty(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.address.trim()) return;
    setAddSaving(true);
    setAddError("");
    try {
      const payload: PropertyCreate = {
        address: addForm.address.trim(),
        city: addForm.city || undefined,
        state: addForm.state || undefined,
        zip_code: addForm.zip_code || undefined,
        country: addForm.country || "US",
        currency_code: addForm.currency_code || "USD",
        property_type: addForm.property_type || undefined,
        is_primary_residence: addForm.is_primary_residence,
        current_value: addForm.current_value ? Number(addForm.current_value) : undefined,
        purchase_price: addForm.purchase_price ? Number(addForm.purchase_price) : undefined,
        purchase_date: addForm.purchase_date || undefined,
        notes: addForm.notes || undefined,
      };
      const created = await createProperty(payload);
      setProperties((prev) => [created, ...prev]);
      setShowAddModal(false);
      setAddForm({
        address: "", city: "", state: "", zip_code: "",
        country: "US", currency_code: "USD", property_type: "",
        is_primary_residence: false, current_value: "",
        purchase_price: "", purchase_date: "", notes: "",
      });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add property");
    } finally {
      setAddSaving(false);
    }
  }

  // FX-converted USD totals for summary cards
  const totalValueUSD = properties.reduce((sum, p) => {
    const val = p.current_value ? Number(p.current_value) : 0;
    return sum + convertToUSD(val, p.currency_code || householdCurrency, fxRates);
  }, 0);
  const totalCostBasisUSD = properties.reduce((sum, p) => {
    const basis = costBasis(p);
    return sum + convertToUSD(basis, p.currency_code || householdCurrency, fxRates);
  }, 0);
  // Per-currency breakdown for summary cards (show when portfolio has non-household-currency properties)
  const valuesByCurrency: Record<string, number> = {};
  for (const p of properties) {
    const cur = p.currency_code || householdCurrency;
    valuesByCurrency[cur] = (valuesByCurrency[cur] ?? 0) + (p.current_value ? Number(p.current_value) : 0);
  }
  const currencyBreakdown = Object.keys(valuesByCurrency).some((c) => c !== householdCurrency)
    ? Object.entries(valuesByCurrency).map(([cur, val]) => `${cur} ${fmtInCurrency(val, cur)}`).join(" · ")
    : null;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Real Estate</h2>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition"
        >
          + Add Property
        </button>
      </div>

      {properties.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Current Value</p>
            <p className="text-2xl font-bold">{fmt(String(totalValueUSD))}</p>
            {currencyBreakdown && <p className="text-xs text-gray-400 mt-0.5">{currencyBreakdown}</p>}
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Cost Basis</p>
            <p className="text-2xl font-bold">{fmt(String(totalCostBasisUSD))}</p>
            <p className="text-xs text-gray-400 mt-0.5">Purchase price + closing costs</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Gain / Loss</p>
            <p className={`text-2xl font-bold ${gainColor(String(totalValueUSD), totalCostBasisUSD)}`}>
              {gain(String(totalValueUSD), totalCostBasisUSD, fmt)}
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
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mt-2 px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 transition"
          >
            Add your first property
          </button>
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
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-lg">🏠</span>
                      <h3 className="font-semibold text-gray-900">{p.address}</h3>
                      <span className="text-xs bg-gray-100 text-gray-500 rounded px-2 py-0.5">
                        {typeLabel(p.property_type)}
                      </span>
                      {p.country && p.country !== "US" && (
                        <span className="text-xs bg-blue-50 text-blue-600 rounded px-2 py-0.5 font-medium">
                          {p.country}
                        </span>
                      )}
                      {p.is_primary_residence && (
                        <span className="text-xs bg-green-100 text-green-700 rounded px-2 py-0.5 font-medium">
                          Primary Residence
                        </span>
                      )}
                      {/* ── Cost status indicators ── */}
                      {(() => {
                        const isEscrowed = (loans[p.id] ?? []).some((l) => l.escrow_included);
                        const cats = [
                          { key: "property_tax", label: "Tax", fullLabel: "Property Tax", hint: "Typically Apr & Oct" },
                          { key: "hoa",          label: "HOA", fullLabel: "HOA",          hint: "Monthly"             },
                          { key: "insurance",    label: "Ins", fullLabel: "Insurance",    hint: "Annual renewal"      },
                        ].filter(({ key }) => !(isEscrowed && (key === "property_tax" || key === "insurance")));
                        return (
                          <>
                            <span className="text-xs text-gray-400 font-mono shrink-0">{CURRENT_YEAR}:</span>
                            {cats.map(({ key, label, fullLabel, hint }) => {
                              const status = (costStatuses[p.id] ?? []).find(
                                (s) => s.year === CURRENT_YEAR && s.category === key
                              );
                              const isPaid = status?.is_paid ?? false;
                              const toggleKey = `${p.id}-${key}`;
                              const tipText = `${fullLabel} ${CURRENT_YEAR} — ${isPaid ? "Paid — click to mark due" : `Due (${hint}) — click to mark paid`}`;
                              const icon =
                                key === "property_tax" ? (
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                    <rect x="3" y="2" width="10" height="12" rx="1" />
                                    <line x1="5.5" y1="6" x2="10.5" y2="6" />
                                    <line x1="5.5" y1="9" x2="8.5" y2="9" />
                                  </svg>
                                ) : key === "hoa" ? (
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8 2 L13 7 L13 14 L3 14 L3 7 Z" />
                                    <rect x="6.5" y="10" width="3" height="4" />
                                  </svg>
                                ) : (
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8 2 L13 4 L13 9 C13 12.5 8 14 8 14 C8 14 3 12.5 3 9 L3 4 Z" />
                                  </svg>
                                );
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => toggleCostStatus(p.id, key)}
                                  disabled={togglingStatus === toggleKey}
                                  title={tipText}
                                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-xs font-medium transition-colors ${
                                    isPaid
                                      ? "bg-green-50 text-green-600 border-green-200 hover:bg-green-100"
                                      : "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100"
                                  } ${togglingStatus === toggleKey ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
                                >
                                  {icon}
                                  <span className="hidden sm:inline ml-0.5">{label}</span>
                                </button>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                    {(p.city || p.county || p.state || p.zip_code) && (
                      <p className="text-sm text-gray-500 ml-7">
                        {[p.city, p.county, p.state, p.zip_code].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {p.pin && (
                      <p className="text-xs text-gray-400 ml-7 mt-0.5">
                        PIN: <span className="font-mono">{p.pin}</span>
                      </p>
                    )}
                    {p.notes && <p className="text-xs text-gray-400 ml-7 mt-1">{p.notes}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                    {p.zillow_url && (
                      <a href={p.zillow_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-medium transition">
                        Zillow ↗
                      </a>
                    )}
                    {p.redfin_url && (
                      <a href={p.redfin_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium transition">
                        Redfin ↗
                      </a>
                    )}
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
                    <p className="font-medium text-gray-700">{fmtProp(p.purchase_price, p.currency_code)}</p>
                  </div>
                  {p.purchase_date && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Purchase Date</p>
                      <p className="font-medium text-gray-700">
                        {new Date(p.purchase_date).toLocaleDateString(locale, {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                    </div>
                  )}
                  {p.closing_costs && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Closing Costs</p>
                      <p className="font-medium text-gray-700">{fmtProp(p.closing_costs, p.currency_code)}</p>
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
                        {fmtProp(p.current_value, p.currency_code)}
                        <span className="text-xs text-gray-300 group-hover:text-primary-400">✏</span>
                      </button>
                    )}
                  </div>
                  {loanBalance > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Liability</p>
                      <p className="font-medium text-red-500">{fmtProp(loanBalance, p.currency_code)}</p>
                    </div>
                  )}
                  {monthlyCarrying > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Monthly Cost</p>
                      <p className="font-medium text-orange-600">{fmtProp(monthlyCarrying, p.currency_code)}<span className="text-xs text-gray-400 font-normal">/mo</span></p>
                      {monthlyLoanPayment > 0 && monthlyRecurring > 0 && (
                        <p className="text-xs text-gray-400">
                          {fmtProp(monthlyLoanPayment, p.currency_code)} mortgage + {fmtProp(monthlyRecurring, p.currency_code)} costs
                        </p>
                      )}
                    </div>
                  )}
                  {p.current_value && basis > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Gain / Loss</p>
                      <p className={`font-medium ${gainColor(p.current_value, basis)}`}>
                        {gain(p.current_value, basis, (v) => fmtProp(v, p.currency_code))}
                      </p>
                    </div>
                  )}
                  {p.last_valuation_date && (
                    <div className="ml-auto text-right">
                      <p className="text-xs text-gray-400">Last updated</p>
                      <p className="text-xs text-gray-500">
                        {new Date(p.last_valuation_date).toLocaleDateString(locale, {
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
                            {fmtProp(equity, p.currency_code)} ({equityPct.toFixed(1)}%)
                          </span>
                        </span>
                        <span>
                          Total loan balance{" "}
                          <span className="text-gray-600 font-medium">{fmtProp(loanBalance, p.currency_code)}</span>
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

                    {/* Property Identification */}
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                      Property Identification
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label htmlFor={`prop-country-${p.id}`} className="block text-xs font-medium text-gray-600 mb-1">Country</label>
                        <select
                          id={`prop-country-${p.id}`}
                          value={detailForm.country}
                          onChange={(e) => setDetailForm((f) => ({ ...f, country: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                        >
                          {COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`prop-currency-${p.id}`} className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                        <select
                          id={`prop-currency-${p.id}`}
                          value={detailForm.currency_code}
                          onChange={(e) => setDetailForm((f) => ({ ...f, currency_code: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">County</label>
                        <input
                          type="text"
                          value={detailForm.county}
                          onChange={(e) => setDetailForm((f) => ({ ...f, county: e.target.value }))}
                          placeholder="Cook County"
                          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Property Index Number (PIN)
                        </label>
                        <input
                          type="text"
                          value={detailForm.pin}
                          onChange={(e) => setDetailForm((f) => ({ ...f, pin: e.target.value }))}
                          placeholder="08-12-345-678-0000"
                          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          The parcel number assigned by your county assessor
                        </p>
                      </div>
                    </div>

                    {/* Business Entity Link */}
                    {entities.length > 0 && (
                      <div className="mb-5">
                        <label htmlFor="prop-entity-select" className="block text-xs font-medium text-gray-600 mb-1">
                          Business Entity <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        <select
                          id="prop-entity-select"
                          value={detailForm.entity_id}
                          onChange={(e) => setDetailForm((f) => ({ ...f, entity_id: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                        >
                          <option value="">— Personal (no entity) —</option>
                          {entities.map((e) => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">
                          Link this property to an LLC, trust, or other business entity
                        </p>
                      </div>
                    )}

                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                      Edit Purchase Details
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <CurrencyField
                        label="Purchase Price"
                        value={detailForm.purchase_price}
                        onChange={(v) => setDetailForm((f) => ({ ...f, purchase_price: v }))}
                        placeholder="450000"
                        symbol={currencySymbol(detailForm.currency_code || householdCurrency)}
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
                        symbol={currencySymbol(detailForm.currency_code || householdCurrency)}
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

                    {/* Listing URLs */}
                    <div className="border-t border-gray-100 pt-4 mt-4">
                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                        Listing URLs
                      </p>
                      <p className="text-xs text-gray-400 mb-3">
                        Paste your property&apos;s Zillow or Redfin page URL to get one-click access to the latest estimate.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Zillow URL</label>
                          <input
                            type="url"
                            value={detailForm.zillow_url}
                            onChange={(e) => setDetailForm((f) => ({ ...f, zillow_url: e.target.value }))}
                            placeholder="https://www.zillow.com/homedetails/..."
                            className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Redfin URL</label>
                          <input
                            type="url"
                            value={detailForm.redfin_url}
                            onChange={(e) => setDetailForm((f) => ({ ...f, redfin_url: e.target.value }))}
                            placeholder="https://www.redfin.com/..."
                            className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </div>
                      </div>
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
                  <TabBtn active={curTab === "documents"} onClick={() => toggleTab(p.id, "documents")}>
                    Documents {documents[p.id] && documents[p.id].length > 0 && `(${documents[p.id].length})`}
                  </TabBtn>
                  <TabBtn active={curTab === "insurance"} onClick={() => toggleTab(p.id, "insurance")}>
                    Insurance {propInsurance[p.id]?.length ? `(${propInsurance[p.id].length})` : ""}
                  </TabBtn>
                </div>

                {/* ── Loans tab ── */}
                {curTab === "loans" && (
                  <LoansTab
                    propertyId={p.id}
                    loans={propLoans}
                    currencyCode={p.currency_code}
                    onUpdate={(updated) => setLoans((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Costs tab ── */}
                {curTab === "costs" && (
                  <CostsTab
                    propertyId={p.id}
                    costs={costs[p.id] ?? []}
                    loans={propLoans}
                    insurance={propInsurance[p.id] ?? []}
                    currencyCode={p.currency_code}
                    onUpdate={(updated) => setCosts((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Maintenance tab ── */}
                {curTab === "maintenance" && (
                  <MaintenanceTab
                    propertyId={p.id}
                    expenses={expenses[p.id] ?? []}
                    onUpdate={(updated) => setExpenses((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Value History tab ── */}
                {curTab === "valuations" && (
                  <ValuationsTab
                    propertyId={p.id}
                    purchasePrice={p.purchase_price ? Number(p.purchase_price) : null}
                    valuations={valuations[p.id] ?? []}
                    onUpdate={(updated) => setValuations((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Documents tab ── */}
                {curTab === "documents" && (
                  <DocumentsTab
                    propertyId={p.id}
                    docs={documents[p.id] ?? []}
                    onUpdate={(updated) => setDocuments((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}

                {/* ── Insurance tab ── */}
                {curTab === "insurance" && (
                  <PropertyInsuranceTab
                    propertyId={p.id}
                    policies={propInsurance[p.id] ?? []}
                    onUpdate={(updated) => setPropInsurance((prev) => ({ ...prev, [p.id]: updated }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Property Modal ──────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Add Property</h2>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleAddProperty} className="p-6 space-y-4">
              {addError && (
                <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">{addError}</div>
              )}

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Address *</label>
                <input
                  required
                  value={addForm.address}
                  onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="123 Main St"
                  className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* City / State / ZIP */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                  <input title="City" value={addForm.city} onChange={(e) => setAddForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="City"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                  <input title="State" value={addForm.state} onChange={(e) => setAddForm((f) => ({ ...f, state: e.target.value }))}
                    placeholder="CA"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ZIP</label>
                  <input title="ZIP Code" value={addForm.zip_code} onChange={(e) => setAddForm((f) => ({ ...f, zip_code: e.target.value }))}
                    placeholder="ZIP"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>

              {/* Country / Currency */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
                  <select title="Country" value={addForm.country} onChange={(e) => setAddForm((f) => ({ ...f, country: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                  <select title="Currency" value={addForm.currency_code} onChange={(e) => setAddForm((f) => ({ ...f, currency_code: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Property Type / Primary Residence */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Property Type</label>
                  <select title="Property Type" value={addForm.property_type} onChange={(e) => setAddForm((f) => ({ ...f, property_type: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="">— Select —</option>
                    {(["single_family", "condo", "townhouse", "multi_family", "land", "other"] as const).map((t) => (
                      <option key={t} value={t}>{typeLabel(t)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addForm.is_primary_residence}
                      onChange={(e) => setAddForm((f) => ({ ...f, is_primary_residence: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    Primary Residence
                  </label>
                </div>
              </div>

              {/* Current Value / Purchase Price / Purchase Date */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Current Value</label>
                  <input type="number" min="0" step="any" value={addForm.current_value}
                    onChange={(e) => setAddForm((f) => ({ ...f, current_value: e.target.value }))}
                    placeholder="0"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Purchase Price</label>
                  <input type="number" min="0" step="any" value={addForm.purchase_price}
                    onChange={(e) => setAddForm((f) => ({ ...f, purchase_price: e.target.value }))}
                    placeholder="0"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Purchase Date</label>
                  <input type="date" title="Purchase Date" value={addForm.purchase_date}
                    onChange={(e) => setAddForm((f) => ({ ...f, purchase_date: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea title="Notes" value={addForm.notes} onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2} className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50 transition"
                >
                  {addSaving ? "Adding…" : "Add Property"}
                </button>
              </div>
            </form>
          </div>
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
  const { fmt } = useCurrency();
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
              {a.current_balance ? ` (${fmt(Number(a.current_balance))})` : ""}
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
  propertyId, loans, currencyCode, onUpdate,
}: {
  propertyId: string;
  loans: Loan[];
  currencyCode?: string;
  onUpdate: (updated: Loan[]) => void;
}) {
  const { fmt: fmtHousehold, currency: householdCurrency } = useCurrency();
  const fmtLoan = (val: string | null | number | undefined, decimals = 0): string => {
    if (val === null || val === undefined || val === "") return "—";
    const code = currencyCode || householdCurrency;
    if (code && code !== householdCurrency) {
      return fmtInCurrency(Number(val), code);
    }
    return fmtHousehold(Number(val), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
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
    listAccounts().then(setAccounts).catch(() => {});
  }, []);

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
      const loan = await createLoan(propertyId, addForm as LoanCreate);
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
      const loan = await updateLoan(id, editForm as LoanCreate);
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
      await deleteLoan(id);
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
                    <p className="text-sm font-semibold text-gray-900">{fmtLoan(l.current_balance)}</p>
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
                      {l.monthly_payment ? fmtLoan(l.monthly_payment, 2) : "—"}
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
  category: "other", label: "", amount: 0, frequency: "monthly", is_active: true, is_escrowed: false, effective_date: "", notes: "",
};

function CostsTab({
  propertyId, costs, loans, insurance, currencyCode, onUpdate,
}: {
  propertyId: string;
  costs: PropertyCost[];
  loans: Loan[];
  insurance: InsurancePolicy[];
  currencyCode?: string;
  onUpdate: (updated: PropertyCost[]) => void;
}) {
  const { fmt: fmtHousehold, currency: householdCurrency, locale } = useCurrency();
  const fmt = (val: string | null | number | undefined, opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number }): string => {
    if (val === null || val === undefined || val === "") return "—";
    const code = currencyCode || householdCurrency;
    if (code && code !== householdCurrency) {
      return fmtInCurrency(Number(val), code);
    }
    return fmtHousehold(Number(val), opts);
  };
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
      frequency: c.frequency, is_active: c.is_active, is_escrowed: c.is_escrowed,
      effective_date: c.effective_date ?? "", notes: c.notes ?? "",
    };
  }

  async function handleAdd() {
    setAddSaving(true);
    setTabError("");
    try {
      const created = await createPropertyCost(propertyId, {
        ...addForm, amount: Number(addForm.amount),
        label: addForm.label || undefined, notes: addForm.notes || undefined,
        effective_date: addForm.effective_date || undefined,
      } as PropertyCostCreate);
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
        effective_date: editForm.effective_date || undefined,
      } as PropertyCostCreate);
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
      await deletePropertyCost(id);
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
      const updated = await updatePropertyCost(c.id, { is_active: !c.is_active });
      onUpdate(costs.map((x) => (x.id === c.id ? updated : x)));
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to update cost");
    }
  }

  const activeCosts = costs.filter((c) => c.is_active);
  const hasEscrow = loans.some((l) => l.escrow_included);
  const activeInsurance = hasEscrow
    ? []
    : insurance.filter((i) => i.is_active && i.premium_amount != null);
  const insMonthly = activeInsurance.reduce(
    (s, i) => s + toMonthly(Number(i.premium_amount), i.premium_frequency), 0
  );
  const monthlyTotal =
    activeCosts
      .filter((c) => !c.is_escrowed)
      .reduce((sum, c) => sum + toMonthly(Number(c.amount), c.frequency), 0)
    + insMonthly;

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
        <Field label="Effective From (optional)" value={form.effective_date ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, effective_date: v }))}
          type="date" placeholder="" />
        <Field label="Notes (optional)" value={form.notes ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
        <div className="md:col-span-3 flex items-center gap-2 mt-1">
          <input type="checkbox" id="cost-escrowed" checked={Boolean(form.is_escrowed)}
            onChange={(e) => setForm((f) => ({ ...f, is_escrowed: e.target.checked }))}
            className="rounded" />
          <label htmlFor="cost-escrowed" className="text-sm text-gray-700 cursor-pointer">
            Paid via escrow (included in mortgage payment — tracked for tax records only)
          </label>
        </div>
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
                  {c.is_escrowed && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                      escrowed
                    </span>
                  )}
                  <div>
                    <span className="text-sm text-gray-700">{c.label || "—"}</span>
                    {c.effective_date && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        effective {new Date(c.effective_date + "T00:00:00").toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${c.is_escrowed ? "text-gray-400" : "text-gray-900"}`}>{c.amount != null && c.amount !== "" ? fmt(Number(c.amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</p>
                    <p className="text-xs text-gray-400">{c.frequency}{c.is_escrowed ? " · tax record" : ""}</p>
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

      {activeInsurance.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">From Insurance Policies</p>
          {activeInsurance.map((ins) => (
            <div key={ins.id}
              className="flex items-center justify-between gap-4 rounded-lg px-4 py-2.5 bg-yellow-50 border border-yellow-100">
              <div className="flex items-center gap-3 flex-1">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                  insurance
                </span>
                <div>
                  <span className="text-sm text-gray-700">
                    {ins.provider}{ins.policy_type ? ` — ${ins.policy_type.replace(/_/g, " ")}` : ""}
                  </span>
                  {ins.renewal_date && (
                    <p className="text-xs text-gray-400 mt-0.5">renews {ins.renewal_date}</p>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-gray-900">
                  {fmt(toMonthly(Number(ins.premium_amount), ins.premium_frequency), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                </p>
                <p className="text-xs text-gray-400">
                  {ins.premium_amount != null ? fmt(Number(ins.premium_amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} {ins.premium_frequency}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

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

      {(activeCosts.length > 0 || activeInsurance.length > 0) && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-sm">
          <span className="text-gray-500">
            Monthly equivalent (active, non-escrowed)
            {activeCosts.some((c) => c.is_escrowed) && (
              <span className="ml-1 text-xs text-blue-500" title="Escrowed costs (insurance, property tax) are excluded — already in your mortgage payment">
                · escrowed costs excluded
              </span>
            )}
            {activeInsurance.length > 0 && (
              <span className="ml-1 text-xs text-yellow-600">· includes insurance premiums</span>
            )}
          </span>
          <span className="font-semibold text-gray-900">{fmt(monthlyTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo</span>
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
  propertyId, expenses, onUpdate,
}: {
  propertyId: string;
  expenses: MaintenanceExpense[];
  onUpdate: (updated: MaintenanceExpense[]) => void;
}) {
  const { fmt, locale } = useCurrency();
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
      } as MaintenanceExpenseCreate);
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
      } as MaintenanceExpenseCreate);
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
      await deleteMaintenanceExpense(id);
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
      const result = await importMaintenanceExpenses(propertyId, importFile);
      setImportResult(result);
      if (result.imported > 0) {
        // Reload the expenses list
        const refreshed = await listMaintenanceExpenses(propertyId);
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
                    {new Date(e.expense_date + "T12:00:00").toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${EXPENSE_COLORS[e.category] ?? EXPENSE_COLORS.other}`}>
                    {e.category.replace(/_/g, " ")}
                  </span>
                  {e.is_capex && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0 bg-purple-100 text-purple-700">
                      CapEx
                    </span>
                  )}
                  {e.transaction_id && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0 bg-amber-100 text-amber-700" title="Sourced from a bank transaction — edit from the Transactions page">
                      🔗 From bank
                    </span>
                  )}
                  <span className="text-sm text-gray-700 truncate">{e.description}</span>
                  {e.vendor && <span className="text-xs text-gray-400 truncate">· {e.vendor}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-gray-900">{e.amount != null && e.amount !== "" ? fmt(Number(e.amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</span>
                  {e.transaction_id ? (
                    <span className="text-xs text-amber-500 italic" title="Linked from Transactions page — unlink there to edit">Linked</span>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setEditId(e.id); setEditForm(expenseToForm(e)); }}
                        className="text-xs text-gray-400 hover:text-primary-600 transition">Edit</button>
                      <button type="button" onClick={() => handleDelete(e.id)} disabled={deletingId === e.id}
                        className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-40">Delete</button>
                    </>
                  )}
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
            YTD ({thisYear}): <span className="font-semibold text-gray-900">{fmt(ytdTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
          <span className="text-gray-500">
            All-time: <span className="font-semibold text-gray-900">{fmt(allTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
  propertyId, purchasePrice, valuations, onUpdate,
}: {
  propertyId: string;
  purchasePrice: number | null;
  valuations: PropertyValuation[];
  onUpdate: (updated: PropertyValuation[]) => void;
}) {
  const { fmt, locale } = useCurrency();
  const today = new Date().toISOString().split("T")[0];
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ value: "", source: "manual", valuation_date: today, notes: "" });
  const [saving, setSaving] = useState(false);
  const [tabError, setTabError] = useState("");

  // Chart data — sorted ascending by date for left-to-right rendering
  const chartData = [...valuations]
    .sort((a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime())
    .map((v) => ({
      date: new Date(v.valuation_date).toLocaleDateString(locale, { month: "short", year: "2-digit" }),
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
      });
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
      await deletePropertyValuation(id);
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
                {new Date(v.valuation_date).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
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

// ─── Documents Tab ────────────────────────────────────────────────────────────

const DOCUMENT_CATEGORIES = [
  { value: "property_tax", label: "Property Tax" },
  { value: "hoa", label: "HOA" },
  { value: "insurance", label: "Insurance" },
  { value: "deed", label: "Deed" },
  { value: "inspection", label: "Inspection" },
  { value: "appraisal", label: "Appraisal" },
  { value: "other", label: "Other" },
];

const CATEGORY_COLORS: Record<string, string> = {
  property_tax: "bg-yellow-100 text-yellow-700",
  hoa: "bg-purple-100 text-purple-700",
  insurance: "bg-green-100 text-green-700",
  deed: "bg-blue-100 text-blue-700",
  inspection: "bg-orange-100 text-orange-700",
  appraisal: "bg-indigo-100 text-indigo-700",
  other: "bg-gray-100 text-gray-600",
};

function categoryLabel(cat: string | null): string {
  if (!cat) return "";
  return DOCUMENT_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsTab({
  propertyId,
  docs,
  onUpdate,
}: {
  propertyId: string;
  docs: PropertyDocument[];
  onUpdate: (updated: PropertyDocument[]) => void;
}) {
  const { locale } = useCurrency();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setErr("");
    try {
      const doc = await uploadPropertyDocument(
        propertyId,
        selectedFile,
        category || null,
        description.trim() || null);
      onUpdate([doc, ...docs]);
      setSelectedFile(null);
      setCategory("");
      setDescription("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: PropertyDocument) {
    setDownloading(doc.id);
    try {
      await downloadPropertyDocument(propertyId, doc.id, doc.filename);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    setDeletingDoc(docId);
    try {
      await deletePropertyDocument(propertyId, docId);
      onUpdate(docs.filter((d) => d.id !== docId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingDoc(null);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Upload section */}
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Upload Document</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-1">
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">— Select category —</option>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 2025 Cook County tax bill"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="file"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-white file:text-primary-600 file:hover:bg-gray-50 file:cursor-pointer"
          />
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 shrink-0"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>

      {/* Document list */}
      {docs.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">
          No documents yet. Upload property tax bills, HOA agreements, insurance policies, and more.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{doc.filename}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {doc.category && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[doc.category] ?? "bg-gray-100 text-gray-600"}`}>
                      {categoryLabel(doc.category)}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{fmtFileSize(doc.file_size)}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(doc.uploaded_at).toLocaleDateString(locale)}
                  </span>
                  {doc.description && (
                    <span className="text-xs text-gray-500 italic truncate">{doc.description}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleDownload(doc)}
                  disabled={downloading === doc.id}
                  className="text-xs text-primary-600 hover:text-primary-800 font-medium px-2 py-1 rounded hover:bg-primary-50 transition disabled:opacity-50"
                >
                  {downloading === doc.id ? "..." : "Download"}
                </button>
                <button
                  onClick={() => handleDelete(doc.id)}
                  disabled={deletingDoc === doc.id}
                  className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition disabled:opacity-50"
                >
                  {deletingDoc === doc.id ? "..." : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Property Insurance Tab ────────────────────────────────────────────────────

const POLICY_TYPE_LABEL: Record<string, string> = {
  life_term: "Term Life", life_whole: "Whole Life", life_universal: "Universal Life",
  home: "Home", renters: "Renters", auto: "Auto", umbrella: "Umbrella",
  health: "Health", dental: "Dental", vision: "Vision",
  disability: "Disability", long_term_care: "Long-Term Care",
  business: "Business", other: "Other",
};

const INS_FREQ_LABEL: Record<string, string> = {
  monthly: "/mo", quarterly: "/qtr", semi_annual: "/6mo", annual: "/yr", one_time: " once",
};

const BLANK_INS_FORM = {
  policy_type: "home" as PolicyType,
  provider: "",
  policy_number: "",
  premium_amount: "",
  premium_frequency: "monthly" as PremiumFrequency,
  coverage_amount: "",
  deductible: "",
  start_date: "",
  renewal_date: "",
  auto_renew: false,
  notes: "",
};

function renewalDayColor(dateStr: string | null): string {
  if (!dateStr) return "text-gray-400";
  const days = Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (days < 30) return "text-red-600 font-semibold";
  if (days < 60) return "text-amber-600 font-semibold";
  return "text-gray-700";
}

function PropertyInsuranceTab({
  propertyId,
  policies,
  onUpdate,
}: {
  propertyId: string;
  policies: InsurancePolicy[];
  onUpdate: (updated: InsurancePolicy[]) => void;
}) {
  const { fmt, locale } = useCurrency();
  const [showAddEdit, setShowAddEdit] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<InsurancePolicy | null>(null);
  const [form, setForm] = useState({ ...BLANK_INS_FORM });
  const [showLink, setShowLink] = useState(false);
  const [linkable, setLinkable] = useState<InsurancePolicy[]>([]);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function fmtPremium(p: InsurancePolicy) {
    if (!p.premium_amount) return "—";
    return `${fmt(Number(p.premium_amount))}${INS_FREQ_LABEL[p.premium_frequency] ?? ""}`;
  }

  function openAdd() {
    setEditingPolicy(null);
    setForm({ ...BLANK_INS_FORM });
    setErr(null);
    setShowAddEdit(true);
  }

  function openEdit(p: InsurancePolicy) {
    setEditingPolicy(p);
    setForm({
      policy_type: p.policy_type,
      provider: p.provider,
      policy_number: p.policy_number ?? "",
      premium_amount: p.premium_amount ?? "",
      premium_frequency: p.premium_frequency,
      coverage_amount: p.coverage_amount ?? "",
      deductible: p.deductible ?? "",
      start_date: p.start_date ?? "",
      renewal_date: p.renewal_date ?? "",
      auto_renew: p.auto_renew,
      notes: p.notes ?? "",
    });
    setErr(null);
    setShowAddEdit(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const payload: InsurancePolicyCreate = {
        policy_type: form.policy_type,
        provider: form.provider,
        policy_number: form.policy_number || undefined,
        premium_amount: form.premium_amount ? Number(form.premium_amount) : undefined,
        premium_frequency: form.premium_frequency,
        coverage_amount: form.coverage_amount ? Number(form.coverage_amount) : undefined,
        deductible: form.deductible ? Number(form.deductible) : undefined,
        start_date: form.start_date || undefined,
        renewal_date: form.renewal_date || undefined,
        auto_renew: form.auto_renew,
        notes: form.notes || undefined,
        property_id: propertyId,
      };
      if (editingPolicy) {
        await updatePolicy(editingPolicy.id, payload);
      } else {
        await createPolicy(payload);
      }
      const refreshed = await listPolicies({ property_id: propertyId });
      onUpdate(refreshed);
      setShowAddEdit(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlink(policyId: string) {
    if (!confirm("Unlink this policy from the property? It will remain in the Insurance section.")) return;
    try {
      await updatePolicy(policyId, { property_id: undefined });
      onUpdate(policies.filter((p) => p.id !== policyId));
    } catch {
      // silently ignore
    }
  }

  async function handleDelete(policyId: string) {
    if (!confirm("Permanently delete this insurance policy?")) return;
    try {
      await deletePolicy(policyId);
      onUpdate(policies.filter((p) => p.id !== policyId));
    } catch {
      // silently ignore
    }
  }

  async function openLink() {
    try {
      const all = await listPolicies({ is_active: true });
      setLinkable(all.filter((p) => p.property_id === null));
    } catch {
      setLinkable([]);
    }
    setSelectedLinkId(null);
    setShowLink(true);
  }

  async function handleLink() {
    if (!selectedLinkId) return;
    setSubmitting(true);
    try {
      await updatePolicy(selectedLinkId, { property_id: propertyId });
      const refreshed = await listPolicies({ property_id: propertyId });
      onUpdate(refreshed);
      setShowLink(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Insurance Policies</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={openLink}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
          >
            Link Existing
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="text-xs px-3 py-1.5 rounded bg-primary-600 text-white hover:bg-primary-700 transition"
          >
            + Add Policy
          </button>
        </div>
      </div>

      {/* Empty state */}
      {policies.length === 0 && (
        <p className="text-sm text-gray-400 italic py-4 text-center">
          No insurance policies linked to this property.
        </p>
      )}

      {/* Table */}
      {policies.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Provider</th>
                <th className="px-3 py-2 text-right">Premium</th>
                <th className="px-3 py-2 text-right">Coverage</th>
                <th className="px-3 py-2 text-right">Deductible</th>
                <th className="px-3 py-2 text-left">Renews</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {policies.map((pol) => (
                <Fragment key={pol.id}>
                  <tr
                    className="bg-white hover:bg-gray-50 cursor-pointer transition"
                    onClick={() => setExpandedId(expandedId === pol.id ? null : pol.id)}
                  >
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {POLICY_TYPE_LABEL[pol.policy_type] ?? pol.policy_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{pol.provider}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmtPremium(pol)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">
                      {pol.coverage_amount ? fmt(Number(pol.coverage_amount)) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">
                      {pol.deductible ? fmt(Number(pol.deductible)) : "—"}
                    </td>
                    <td className={`px-3 py-2.5 ${renewalDayColor(pol.renewal_date)}`}>
                      {pol.renewal_date ? new Date(pol.renewal_date).toLocaleDateString(locale) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${pol.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {pol.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openEdit(pol)}
                        className="text-xs text-primary-600 hover:text-primary-800 font-medium px-2 py-1 rounded hover:bg-primary-50 transition"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUnlink(pol.id)}
                        className="text-xs text-amber-600 hover:text-amber-800 font-medium px-2 py-1 rounded hover:bg-amber-50 transition ml-1"
                      >
                        Unlink
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(pol.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition ml-1"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expandedId === pol.id && (
                    <tr>
                      <td colSpan={8} className="px-4 py-3 bg-blue-50/30 text-xs text-gray-600">
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                          {pol.policy_number && <span><strong>Policy #:</strong> {pol.policy_number}</span>}
                          {pol.start_date && <span><strong>Start:</strong> {new Date(pol.start_date).toLocaleDateString(locale)}</span>}
                          <span><strong>Auto-Renew:</strong> {pol.auto_renew ? "Yes" : "No"}</span>
                          {pol.notes && <span><strong>Notes:</strong> {pol.notes}</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-semibold text-gray-900 mb-4">
              {editingPolicy ? "Edit Insurance Policy" : "Add Insurance Policy"}
            </h2>
            {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Policy Type *</label>
                  <select
                    required
                    aria-label="Policy Type"
                    value={form.policy_type}
                    onChange={(e) => setForm((f) => ({ ...f, policy_type: e.target.value as PolicyType }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    {Object.entries(POLICY_TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Provider *</label>
                  <input
                    required
                    value={form.provider}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    placeholder="e.g. State Farm"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Policy Number</label>
                <input
                  placeholder="e.g. ABC-123456"
                  value={form.policy_number}
                  onChange={(e) => setForm((f) => ({ ...f, policy_number: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Premium Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={form.premium_amount}
                    onChange={(e) => setForm((f) => ({ ...f, premium_amount: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Frequency</label>
                  <select
                    aria-label="Premium Frequency"
                    value={form.premium_frequency}
                    onChange={(e) => setForm((f) => ({ ...f, premium_frequency: e.target.value as PremiumFrequency }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="semi_annual">Semi-Annual</option>
                    <option value="annual">Annual</option>
                    <option value="one_time">One-Time</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Coverage Limit</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={form.coverage_amount}
                    onChange={(e) => setForm((f) => ({ ...f, coverage_amount: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Deductible</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={form.deductible}
                    onChange={(e) => setForm((f) => ({ ...f, deductible: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    aria-label="Start Date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Renewal Date</label>
                  <input
                    type="date"
                    aria-label="Renewal Date"
                    value={form.renewal_date}
                    onChange={(e) => setForm((f) => ({ ...f, renewal_date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ins_auto_renew"
                  checked={form.auto_renew}
                  onChange={(e) => setForm((f) => ({ ...f, auto_renew: e.target.checked }))}
                  className="rounded border-gray-300 text-primary-600"
                />
                <label htmlFor="ins_auto_renew" className="text-sm text-gray-700">Auto-Renew</label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional notes about this policy"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddEdit(false)}
                  className="px-4 py-2 text-sm text-gray-600 rounded-lg border border-gray-300 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                >
                  {submitting ? "Saving…" : editingPolicy ? "Save Changes" : "Add Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link Existing Modal */}
      {showLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Link Existing Policy</h2>
            <p className="text-xs text-gray-500 mb-4">
              Select an unlinked household policy to attach to this property.
            </p>
            {linkable.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-2">No unlinked policies available.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {linkable.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      selectedLinkId === p.id
                        ? "border-primary-500 bg-primary-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="link_policy"
                      value={p.id}
                      checked={selectedLinkId === p.id}
                      onChange={() => setSelectedLinkId(p.id)}
                      className="text-primary-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {POLICY_TYPE_LABEL[p.policy_type] ?? p.policy_type} — {p.provider}
                      </p>
                      <p className="text-xs text-gray-500">{fmtPremium(p)}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowLink(false)}
                className="px-4 py-2 text-sm text-gray-600 rounded-lg border border-gray-300 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLink}
                disabled={!selectedLinkId || submitting}
                className="px-4 py-2 text-sm text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
              >
                {submitting ? "Linking…" : "Link Policy"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
