"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  createProperty,
  PropertyCreate,
} from "@/lib/api";

const PROPERTY_TYPES = [
  { value: "single_family", label: "Single Family Home" },
  { value: "condo", label: "Condo / Co-op" },
  { value: "townhouse", label: "Townhouse" },
  { value: "multi_family", label: "Multi-Family" },
  { value: "land", label: "Land" },
  { value: "other", label: "Other" },
];

const DEFAULT_FORM: PropertyCreate = {
  address: "",
  city: "",
  state: "",
  zip_code: "",
  property_type: "single_family",
  purchase_price: undefined,
  current_value: undefined,
  notes: "",
  monthly_rent: undefined,
  mortgage_monthly: undefined,
  property_tax_annual: undefined,
  insurance_annual: undefined,
  hoa_monthly: undefined,
  maintenance_monthly: undefined,
};

export default function SettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<PropertyCreate>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  function update(field: keyof PropertyCreate, value: string | number | undefined) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSuccess(false);
    setError("");
  }

  function numField(field: keyof PropertyCreate, e: React.ChangeEvent<HTMLInputElement>) {
    update(field, e.target.value ? Number(e.target.value) : undefined);
  }

  async function handleAddProperty(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    if (!form.address.trim()) { setError("Address is required."); return; }

    setSaving(true);
    setError("");
    try {
      await createProperty(
        {
          ...form,
          purchase_price: form.purchase_price || undefined,
          current_value: form.current_value || undefined,
          monthly_rent: form.monthly_rent || undefined,
          mortgage_monthly: form.mortgage_monthly || undefined,
          property_tax_annual: form.property_tax_annual || undefined,
          insurance_annual: form.insurance_annual || undefined,
          hoa_monthly: form.hoa_monthly || undefined,
          maintenance_monthly: form.maintenance_monthly || undefined,
        },
        token
      );
      setSuccess(true);
      setForm(DEFAULT_FORM);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save property");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <div className="space-y-6">
        {/* Profile */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Full Name</label>
              <input
                type="text"
                className="border border-gray-300 rounded-lg px-4 py-2 w-full"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Email</label>
              <input
                type="email"
                className="border border-gray-300 rounded-lg px-4 py-2 w-full"
                placeholder="you@example.com"
              />
            </div>
          </div>
        </section>

        {/* Properties */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-lg">Add Property</h3>
            <a
              href="/properties"
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              View all properties →
            </a>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Enter the details for a property you own. You can update the current
            value at any time to keep your net worth accurate.
          </p>

          <form onSubmit={handleAddProperty} className="space-y-4">
            {/* Address */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Street Address <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="123 Main St"
              />
            </div>

            {/* City / State / ZIP */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input
                  type="text"
                  value={form.city ?? ""}
                  onChange={(e) => update("city", e.target.value)}
                  className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Austin"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input
                  type="text"
                  value={form.state ?? ""}
                  onChange={(e) => update("state", e.target.value)}
                  className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="TX"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ZIP Code</label>
                <input
                  type="text"
                  value={form.zip_code ?? ""}
                  onChange={(e) => update("zip_code", e.target.value)}
                  className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="78701"
                />
              </div>
            </div>

            {/* Property Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Property Type
              </label>
              <select
                value={form.property_type ?? "single_family"}
                onChange={(e) => update("property_type", e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Purchase Price / Current Value */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Purchase Price
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={form.purchase_price ?? ""}
                    onChange={(e) => numField("purchase_price", e)}
                    className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="450,000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Estimated Value
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={form.current_value ?? ""}
                    onChange={(e) => numField("current_value", e)}
                    className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="520,000"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => update("notes", e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Primary residence, rental property, etc."
              />
            </div>

            {/* ── Financial Details ───────────────────────────────── */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-3">Financial Details <span className="font-normal text-gray-400">(optional)</span></p>

              {/* Rental Income */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Monthly Rent Income
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={form.monthly_rent ?? ""}
                    onChange={(e) => numField("monthly_rent", e)}
                    className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="2,000"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Leave blank if owner-occupied</p>
              </div>

              {/* Monthly Costs */}
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Monthly Costs</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mortgage Payment</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="50"
                      value={form.mortgage_monthly ?? ""}
                      onChange={(e) => numField("mortgage_monthly", e)}
                      className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="1,800"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">HOA</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="10"
                      value={form.hoa_monthly ?? ""}
                      onChange={(e) => numField("hoa_monthly", e)}
                      className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="250"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Maintenance Budget</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="10"
                      value={form.maintenance_monthly ?? ""}
                      onChange={(e) => numField("maintenance_monthly", e)}
                      className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="200"
                    />
                  </div>
                </div>
              </div>

              {/* Annual Costs */}
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Annual Costs</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Property Tax <span className="font-normal text-gray-400">(annual)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={form.property_tax_annual ?? ""}
                      onChange={(e) => numField("property_tax_annual", e)}
                      className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="4,800"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Insurance <span className="font-normal text-gray-400">(annual)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={form.insurance_annual ?? ""}
                      onChange={(e) => numField("insurance_annual", e)}
                      className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="1,200"
                    />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
                Property added.{" "}
                <a href="/properties" className="underline font-medium">
                  View properties →
                </a>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-primary-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {saving ? "Adding..." : "Add Property"}
            </button>
          </form>
        </section>

        {/* Household */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Household</h3>
          <p className="text-sm text-gray-500 mb-4">
            Manage household members and roles.
          </p>
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition text-sm">
            Invite Member
          </button>
        </section>

        {/* Linked Accounts */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Linked Accounts</h3>
          <p className="text-sm text-gray-400">
            No accounts linked. Go to Accounts to link your first institution.
          </p>
        </section>

        {/* Export */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Data Export</h3>
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition text-sm">
            Export Transactions (CSV)
          </button>
        </section>
      </div>
    </div>
  );
}
