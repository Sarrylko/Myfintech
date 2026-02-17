"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  createProperty,
  PropertyCreate,
  getProfile,
  updateProfile,
  changePassword,
  UserResponse,
  UserProfileUpdate,
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
  mortgage_balance: undefined,
  monthly_rent: undefined,
  mortgage_monthly: undefined,
  property_tax_annual: undefined,
  insurance_annual: undefined,
  hoa_monthly: undefined,
  maintenance_monthly: undefined,
};

function InputField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        required={required}
      />
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();

  // ── Property form ──────────────────────────────────────────────────
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
          mortgage_balance: form.mortgage_balance || undefined,
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

  // ── Profile form ───────────────────────────────────────────────────
  const [profile, setProfile] = useState<UserResponse | null>(null);
  const [profileForm, setProfileForm] = useState<UserProfileUpdate>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    getProfile(token).then((u) => {
      setProfile(u);
      setProfileForm({
        full_name: u.full_name ?? "",
        email: u.email ?? "",
        phone: u.phone ?? "",
        address_line1: u.address_line1 ?? "",
        address_line2: u.address_line2 ?? "",
        city: u.city ?? "",
        state: u.state ?? "",
        zip_code: u.zip_code ?? "",
      });
    }).catch(() => router.replace("/login"));
  }, [router]);

  function updateProfile_field(field: keyof UserProfileUpdate, value: string) {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
    setProfileSuccess(false);
    setProfileError("");
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) { router.replace("/login"); return; }

    // Only send changed fields (non-empty or explicitly changed)
    const payload: UserProfileUpdate = {};
    const keys: (keyof UserProfileUpdate)[] = [
      "full_name", "email", "phone", "address_line1", "address_line2", "city", "state", "zip_code",
    ];
    for (const k of keys) {
      const v = profileForm[k];
      if (v !== undefined) payload[k] = v as string;
    }

    setProfileSaving(true);
    setProfileError("");
    try {
      const updated = await updateProfile(payload, token);
      setProfile(updated);
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 4000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  }

  // ── Password change ────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState("");

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) { router.replace("/login"); return; }

    if (pwForm.next !== pwForm.confirm) {
      setPwError("New passwords do not match.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }

    setPwSaving(true);
    setPwError("");
    try {
      await changePassword(pwForm.current, pwForm.next, token);
      setPwSuccess(true);
      setPwForm({ current: "", next: "", confirm: "" });
      setTimeout(() => setPwSuccess(false), 4000);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <div className="space-y-6">

        {/* ── Profile ──────────────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Profile</h3>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            {/* Name & Email */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="Full Name"
                value={profileForm.full_name ?? ""}
                onChange={(v) => updateProfile_field("full_name", v)}
                placeholder="Jane Smith"
              />
              <InputField
                label="Email"
                type="email"
                value={profileForm.email ?? ""}
                onChange={(v) => updateProfile_field("email", v)}
                placeholder="you@example.com"
              />
            </div>

            {/* Phone */}
            <div className="max-w-xs">
              <InputField
                label="Phone Number"
                type="tel"
                value={profileForm.phone ?? ""}
                onChange={(v) => updateProfile_field("phone", v)}
                placeholder="+1 (555) 000-0000"
              />
            </div>

            {/* Address */}
            <div>
              <InputField
                label="Address Line 1"
                value={profileForm.address_line1 ?? ""}
                onChange={(v) => updateProfile_field("address_line1", v)}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <InputField
                label="Address Line 2"
                value={profileForm.address_line2 ?? ""}
                onChange={(v) => updateProfile_field("address_line2", v)}
                placeholder="Apt 4B (optional)"
              />
            </div>

            {/* City / State / ZIP */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <InputField
                label="City"
                value={profileForm.city ?? ""}
                onChange={(v) => updateProfile_field("city", v)}
                placeholder="Austin"
              />
              <InputField
                label="State"
                value={profileForm.state ?? ""}
                onChange={(v) => updateProfile_field("state", v)}
                placeholder="TX"
              />
              <InputField
                label="ZIP Code"
                value={profileForm.zip_code ?? ""}
                onChange={(v) => updateProfile_field("zip_code", v)}
                placeholder="78701"
              />
            </div>

            {profileError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {profileError}
              </div>
            )}
            {profileSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
                Profile updated successfully.
              </div>
            )}

            <button
              type="submit"
              disabled={profileSaving || !profile}
              className="bg-primary-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {profileSaving ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </section>

        {/* ── Change Password ───────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Change Password</h3>

          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <InputField
              label="Current Password"
              type="password"
              value={pwForm.current}
              onChange={(v) => { setPwForm((p) => ({ ...p, current: v })); setPwError(""); setPwSuccess(false); }}
              placeholder="Your current password"
            />
            <InputField
              label="New Password"
              type="password"
              value={pwForm.next}
              onChange={(v) => { setPwForm((p) => ({ ...p, next: v })); setPwError(""); setPwSuccess(false); }}
              placeholder="At least 8 characters"
            />
            <InputField
              label="Confirm New Password"
              type="password"
              value={pwForm.confirm}
              onChange={(v) => { setPwForm((p) => ({ ...p, confirm: v })); setPwError(""); setPwSuccess(false); }}
              placeholder="Repeat new password"
            />

            {pwError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {pwError}
              </div>
            )}
            {pwSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
                Password changed successfully.
              </div>
            )}

            <button
              type="submit"
              disabled={pwSaving}
              className="bg-primary-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {pwSaving ? "Updating..." : "Change Password"}
            </button>
          </form>
        </section>

        {/* ── Add Property ─────────────────────────────────────────── */}
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
                    step="any"
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
                    step="any"
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

              {/* Mortgage Balance */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mortgage Balance Remaining
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.mortgage_balance ?? ""}
                    onChange={(e) => numField("mortgage_balance", e)}
                    className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="280,000"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Used to calculate equity %. Leave blank if paid off or no mortgage.</p>
              </div>

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
                    step="any"
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
                      step="any"
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
                      step="any"
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
                      step="any"
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
                      step="any"
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
                      step="any"
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
