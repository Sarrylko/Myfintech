"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  listProperties,
  updateProperty,
  deleteProperty,
  Property,
} from "@/lib/api";

function fmt(val: string | null | number): string {
  if (val === null || val === undefined || val === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(val));
}

function gain(current: string | null, purchase: string | null): string {
  if (!current || !purchase) return "—";
  const diff = Number(current) - Number(purchase);
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${fmt(String(diff))}`;
}

function gainColor(current: string | null, purchase: string | null): string {
  if (!current || !purchase) return "text-gray-400";
  return Number(current) >= Number(purchase) ? "text-green-600" : "text-red-600";
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

function monthlyExpenses(p: Property): number {
  return (
    Number(p.mortgage_monthly ?? 0) +
    Number(p.property_tax_annual ?? 0) / 12 +
    Number(p.insurance_annual ?? 0) / 12 +
    Number(p.hoa_monthly ?? 0) +
    Number(p.maintenance_monthly ?? 0)
  );
}

function netCashFlow(p: Property): number {
  return Number(p.monthly_rent ?? 0) - monthlyExpenses(p);
}

function hasFinancials(p: Property): boolean {
  return !!(
    p.monthly_rent ||
    p.mortgage_monthly ||
    p.property_tax_annual ||
    p.insurance_annual ||
    p.hoa_monthly ||
    p.maintenance_monthly
  );
}

interface FinancialForm {
  mortgage_balance: string;
  monthly_rent: string;
  mortgage_monthly: string;
  property_tax_annual: string;
  insurance_annual: string;
  hoa_monthly: string;
  maintenance_monthly: string;
}

function toFinancialForm(p: Property): FinancialForm {
  return {
    mortgage_balance: p.mortgage_balance ? String(Number(p.mortgage_balance)) : "",
    monthly_rent: p.monthly_rent ? String(Number(p.monthly_rent)) : "",
    mortgage_monthly: p.mortgage_monthly ? String(Number(p.mortgage_monthly)) : "",
    property_tax_annual: p.property_tax_annual ? String(Number(p.property_tax_annual)) : "",
    insurance_annual: p.insurance_annual ? String(Number(p.insurance_annual)) : "",
    hoa_monthly: p.hoa_monthly ? String(Number(p.hoa_monthly)) : "",
    maintenance_monthly: p.maintenance_monthly ? String(Number(p.maintenance_monthly)) : "",
  };
}

function CurrencyInput({
  label,
  sublabel,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  sublabel?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {sublabel && <span className="font-normal text-gray-400 ml-1">{sublabel}</span>}
      </label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
        <input
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border border-gray-300 rounded-lg pl-6 pr-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder={placeholder ?? "0"}
        />
      </div>
    </div>
  );
}

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Financial edit state
  const [editingFinancials, setEditingFinancials] = useState<string | null>(null);
  const [financialForm, setFinancialForm] = useState<FinancialForm>({
    mortgage_balance: "", monthly_rent: "", mortgage_monthly: "",
    property_tax_annual: "", insurance_annual: "", hoa_monthly: "", maintenance_monthly: "",
  });
  const [savingFinancials, setSavingFinancials] = useState(false);

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
      const data = await listProperties(token);
      setProperties(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties");
    } finally {
      setLoading(false);
    }
  }

  async function saveValue(id: string) {
    if (!token) return;
    setSaving(true);
    try {
      const updated = await updateProperty(
        id,
        { current_value: editValue ? Number(editValue) : undefined },
        token
      );
      setProperties((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update value");
    } finally {
      setSaving(false);
    }
  }

  function openFinancialEdit(p: Property) {
    setFinancialForm(toFinancialForm(p));
    setEditingFinancials(p.id);
  }

  async function saveFinancials(id: string) {
    if (!token) return;
    setSavingFinancials(true);
    try {
      const updated = await updateProperty(
        id,
        {
          mortgage_balance: financialForm.mortgage_balance ? Number(financialForm.mortgage_balance) : undefined,
          monthly_rent: financialForm.monthly_rent ? Number(financialForm.monthly_rent) : undefined,
          mortgage_monthly: financialForm.mortgage_monthly ? Number(financialForm.mortgage_monthly) : undefined,
          property_tax_annual: financialForm.property_tax_annual ? Number(financialForm.property_tax_annual) : undefined,
          insurance_annual: financialForm.insurance_annual ? Number(financialForm.insurance_annual) : undefined,
          hoa_monthly: financialForm.hoa_monthly ? Number(financialForm.hoa_monthly) : undefined,
          maintenance_monthly: financialForm.maintenance_monthly ? Number(financialForm.maintenance_monthly) : undefined,
        },
        token
      );
      setProperties((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setEditingFinancials(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update financials");
    } finally {
      setSavingFinancials(false);
    }
  }

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

  const totalValue = properties.reduce(
    (sum, p) => sum + (p.current_value ? Number(p.current_value) : 0),
    0
  );
  const totalPurchase = properties.reduce(
    (sum, p) => sum + (p.purchase_price ? Number(p.purchase_price) : 0),
    0
  );
  const totalNetCashFlow = properties
    .filter(hasFinancials)
    .reduce((sum, p) => sum + netCashFlow(p), 0);
  const hasSomeFinancials = properties.some(hasFinancials);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Real Estate</h2>
        <a
          href="/settings"
          className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition"
        >
          + Add Property
        </a>
      </div>

      {/* Summary cards */}
      {properties.length > 0 && (
        <div className={`grid grid-cols-1 gap-4 mb-6 ${hasSomeFinancials ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Current Value</p>
            <p className="text-2xl font-bold">{fmt(String(totalValue))}</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Cost Basis</p>
            <p className="text-2xl font-bold">{fmt(String(totalPurchase))}</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-sm text-gray-500 mb-1">Total Gain / Loss</p>
            <p className={`text-2xl font-bold ${gainColor(String(totalValue), String(totalPurchase))}`}>
              {gain(String(totalValue), String(totalPurchase))}
            </p>
          </div>
          {hasSomeFinancials && (
            <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
              <p className="text-sm text-gray-500 mb-1">Monthly Net Cash Flow</p>
              <p className={`text-2xl font-bold ${totalNetCashFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
                {totalNetCashFlow >= 0 ? "+" : ""}{fmt(totalNetCashFlow)}
              </p>
            </div>
          )}
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
            Go to{" "}
            <a href="/settings" className="text-primary-600 underline">Settings</a>{" "}
            to add your first property.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {properties.map((p) => (
            <div key={p.id} className="bg-white rounded-xl shadow border border-gray-100 p-6">

              {/* Header row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🏠</span>
                    <h3 className="font-semibold text-gray-900">{p.address}</h3>
                    <span className="text-xs bg-gray-100 text-gray-500 rounded px-2 py-0.5">
                      {typeLabel(p.property_type)}
                    </span>
                  </div>
                  {(p.city || p.state || p.zip_code) && (
                    <p className="text-sm text-gray-500 ml-7">
                      {[p.city, p.state, p.zip_code].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {p.notes && (
                    <p className="text-xs text-gray-400 ml-7 mt-1">{p.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(p.id)}
                  disabled={deleting === p.id}
                  className="text-gray-300 hover:text-red-400 transition text-sm shrink-0 disabled:opacity-50"
                  title="Remove property"
                >
                  ✕
                </button>
              </div>

              {/* Value row */}
              <div className="mt-4 flex flex-wrap gap-6 items-end">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Purchase Price</p>
                  <p className="font-medium text-gray-700">{fmt(p.purchase_price)}</p>
                </div>

                {/* Current value — inline edit */}
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Current Value</p>
                  {editing === p.id ? (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="border border-primary-400 rounded px-2 pl-5 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveValue(p.id);
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      </div>
                      <button
                        onClick={() => saveValue(p.id)}
                        disabled={saving}
                        className="text-xs bg-primary-600 text-white px-2 py-1 rounded hover:bg-primary-700 transition disabled:opacity-50"
                      >
                        {saving ? "..." : "Save"}
                      </button>
                      <button onClick={() => setEditing(null)} className="text-xs text-gray-400 hover:text-gray-600">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditing(p.id);
                        setEditValue(p.current_value ? String(Number(p.current_value)) : "");
                      }}
                      className="font-semibold text-gray-900 hover:text-primary-600 transition group flex items-center gap-1"
                      title="Click to update value"
                    >
                      {fmt(p.current_value)}
                      <span className="text-xs text-gray-300 group-hover:text-primary-400">✏</span>
                    </button>
                  )}
                </div>

                {p.current_value && p.purchase_price && (
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Gain / Loss</p>
                    <p className={`font-medium ${gainColor(p.current_value, p.purchase_price)}`}>
                      {gain(p.current_value, p.purchase_price)}
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

              {/* ── Equity bar ── */}
              {p.current_value && p.mortgage_balance && (() => {
                const value = Number(p.current_value);
                const balance = Number(p.mortgage_balance);
                const equity = value - balance;
                const equityPct = Math.max(0, Math.min(100, (equity / value) * 100));
                return (
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Equity <span className={equity >= 0 ? "text-green-600 font-medium" : "text-red-500 font-medium"}>{fmt(equity)} ({equityPct.toFixed(1)}%)</span></span>
                      <span>Mortgage balance <span className="text-gray-600 font-medium">{fmt(balance)}</span></span>
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

              {/* ── Financial section ── */}
              {editingFinancials === p.id ? (
                /* Edit form */
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Edit Financials</p>
                  <div className="space-y-3">
                    <CurrencyInput
                      label="Mortgage Balance Remaining"
                      sublabel="(for equity tracking)"
                      value={financialForm.mortgage_balance}
                      onChange={(v) => setFinancialForm((f) => ({ ...f, mortgage_balance: v }))}
                      placeholder="280000"
                    />
                    <CurrencyInput
                      label="Monthly Rent Income"
                      sublabel="(leave blank if owner-occupied)"
                      value={financialForm.monthly_rent}
                      onChange={(v) => setFinancialForm((f) => ({ ...f, monthly_rent: v }))}
                      placeholder="2000"
                    />
                    <p className="text-xs text-gray-400 uppercase tracking-wide pt-1">Monthly Costs</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <CurrencyInput
                        label="Mortgage"
                        value={financialForm.mortgage_monthly}
                        onChange={(v) => setFinancialForm((f) => ({ ...f, mortgage_monthly: v }))}
                        placeholder="1800"
                      />
                      <CurrencyInput
                        label="HOA"
                        value={financialForm.hoa_monthly}
                        onChange={(v) => setFinancialForm((f) => ({ ...f, hoa_monthly: v }))}
                        placeholder="250"
                      />
                      <CurrencyInput
                        label="Maintenance"
                        value={financialForm.maintenance_monthly}
                        onChange={(v) => setFinancialForm((f) => ({ ...f, maintenance_monthly: v }))}
                        placeholder="200"
                      />
                    </div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide pt-1">Annual Costs</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <CurrencyInput
                        label="Property Tax"
                        sublabel="(annual)"
                        value={financialForm.property_tax_annual}
                        onChange={(v) => setFinancialForm((f) => ({ ...f, property_tax_annual: v }))}
                        placeholder="4800"
                      />
                      <CurrencyInput
                        label="Insurance"
                        sublabel="(annual)"
                        value={financialForm.insurance_annual}
                        onChange={(v) => setFinancialForm((f) => ({ ...f, insurance_annual: v }))}
                        placeholder="1200"
                      />
                    </div>
                  </div>
                  {/* Live preview */}
                  {(financialForm.monthly_rent || financialForm.mortgage_monthly || financialForm.property_tax_annual || financialForm.insurance_annual || financialForm.hoa_monthly || financialForm.maintenance_monthly) && (() => {
                    const previewRent = Number(financialForm.monthly_rent || 0);
                    const previewExp =
                      Number(financialForm.mortgage_monthly || 0) +
                      Number(financialForm.property_tax_annual || 0) / 12 +
                      Number(financialForm.insurance_annual || 0) / 12 +
                      Number(financialForm.hoa_monthly || 0) +
                      Number(financialForm.maintenance_monthly || 0);
                    const previewNet = previewRent - previewExp;
                    return (
                      <div className="mt-4 p-3 bg-gray-50 rounded-lg flex flex-wrap gap-6 items-center">
                        <p className="text-xs text-gray-400 uppercase tracking-wide w-full mb-1">Preview</p>
                        {previewRent > 0 && (
                          <div>
                            <p className="text-xs text-gray-400">Rent Income</p>
                            <p className="text-sm font-medium text-green-600">+{fmt(previewRent)}</p>
                          </div>
                        )}
                        {previewExp > 0 && (
                          <div>
                            <p className="text-xs text-gray-400">Total Expenses</p>
                            <p className="text-sm font-medium text-gray-700">{fmt(previewExp)}</p>
                          </div>
                        )}
                        <div className="pl-4 border-l border-gray-300">
                          <p className="text-xs text-gray-400">Net / Month</p>
                          <p className={`text-sm font-bold ${previewNet >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {previewNet >= 0 ? "+" : ""}{fmt(previewNet)}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => saveFinancials(p.id)}
                      disabled={savingFinancials}
                      className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
                    >
                      {savingFinancials ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingFinancials(null)}
                      className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Display / empty state */
                <div className="mt-5 pt-4 border-t border-gray-100">
                  {hasFinancials(p) ? (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-gray-400 uppercase tracking-wide">Monthly Cash Flow</p>
                        <button
                          onClick={() => openFinancialEdit(p)}
                          className="text-xs text-primary-600 hover:text-primary-700"
                        >
                          Edit ✏
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-8 gap-y-3">
                        {p.monthly_rent && (
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Rent Income</p>
                            <p className="text-sm font-medium text-green-600">+{fmt(p.monthly_rent)}</p>
                          </div>
                        )}
                        {p.mortgage_monthly && (
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Mortgage</p>
                            <p className="text-sm font-medium text-gray-700">{fmt(p.mortgage_monthly)}</p>
                          </div>
                        )}
                        {p.property_tax_annual && (
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Tax <span className="text-gray-300">(÷12)</span></p>
                            <p className="text-sm font-medium text-gray-700">{fmt(Number(p.property_tax_annual) / 12)}</p>
                          </div>
                        )}
                        {p.insurance_annual && (
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Insurance <span className="text-gray-300">(÷12)</span></p>
                            <p className="text-sm font-medium text-gray-700">{fmt(Number(p.insurance_annual) / 12)}</p>
                          </div>
                        )}
                        {p.hoa_monthly && (
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">HOA</p>
                            <p className="text-sm font-medium text-gray-700">{fmt(p.hoa_monthly)}</p>
                          </div>
                        )}
                        {p.maintenance_monthly && (
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Maintenance</p>
                            <p className="text-sm font-medium text-gray-700">{fmt(p.maintenance_monthly)}</p>
                          </div>
                        )}
                        <div className="pl-4 border-l border-gray-200">
                          <p className="text-xs text-gray-400 mb-0.5">Net / Month</p>
                          <p className={`text-sm font-bold ${netCashFlow(p) >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {netCashFlow(p) >= 0 ? "+" : ""}{fmt(netCashFlow(p))}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => openFinancialEdit(p)}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      + Add rent / mortgage / expenses
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
