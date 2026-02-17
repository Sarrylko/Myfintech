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

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

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
            <a href="/settings" className="text-primary-600 underline">
              Settings
            </a>{" "}
            to add your first property.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {properties.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-xl shadow border border-gray-100 p-6"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Address + meta */}
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

                {/* Delete */}
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
                {/* Purchase price */}
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
                      <button
                        onClick={() => setEditing(null)}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditing(p.id);
                        setEditValue(p.current_value ? String(Math.round(Number(p.current_value))) : "");
                      }}
                      className="font-semibold text-gray-900 hover:text-primary-600 transition group flex items-center gap-1"
                      title="Click to update value"
                    >
                      {fmt(p.current_value)}
                      <span className="text-xs text-gray-300 group-hover:text-primary-400">✏</span>
                    </button>
                  )}
                </div>

                {/* Gain/loss */}
                {p.current_value && p.purchase_price && (
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Gain / Loss</p>
                    <p className={`font-medium ${gainColor(p.current_value, p.purchase_price)}`}>
                      {gain(p.current_value, p.purchase_price)}
                    </p>
                  </div>
                )}

                {/* Last updated */}
                {p.last_valuation_date && (
                  <div className="ml-auto text-right">
                    <p className="text-xs text-gray-400">Last updated</p>
                    <p className="text-xs text-gray-500">
                      {new Date(p.last_valuation_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                )}
              </div>

              {/* Financial breakdown */}
              {hasFinancials(p) && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Monthly Cash Flow</p>
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
