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
  listHouseholdMembers,
  addHouseholdMember,
  removeHouseholdMember,
  HouseholdMemberCreate,
  UserResponse,
  UserProfileUpdate,
  listCustomCategories,
  createCustomCategory,
  deleteCustomCategory,
  CustomCategory,
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
  purchase_date: undefined,
  closing_costs: undefined,
  current_value: undefined,
  notes: "",
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
          purchase_date: form.purchase_date || undefined,
          closing_costs: form.closing_costs || undefined,
          current_value: form.current_value || undefined,
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

  // ── Custom Categories state ─────────────────────────────────────────
  const [customCats, setCustomCats] = useState<CustomCategory[]>([]);
  const [catForm, setCatForm] = useState({ name: "", is_income: false });
  const [subForms, setSubForms] = useState<Record<string, string>>({});
  const [catSaving, setCatSaving] = useState(false);

  // ── Household members state ─────────────────────────────────────────
  const [members, setMembers] = useState<UserResponse[]>([]);
  const [memberForm, setMemberForm] = useState<HouseholdMemberCreate>({ full_name: "", email: "", password: "", role: "member" });
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [memberSuccess, setMemberSuccess] = useState("");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    listCustomCategories(token).then(setCustomCats).catch(() => {});
    listHouseholdMembers(token).then(setMembers).catch(() => {});
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

  // ── Household member handlers ───────────────────────────────────────
  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    setMemberSaving(true); setMemberError("");
    try {
      const m = await addHouseholdMember(memberForm, token);
      setMembers((prev) => [...prev, m]);
      setMemberForm({ full_name: "", email: "", password: "", role: "member" });
      setShowAddMember(false);
      setMemberSuccess(`${m.full_name} added successfully.`);
      setTimeout(() => setMemberSuccess(""), 4000);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setMemberSaving(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm("Remove this member from the household?")) return;
    const token = getToken();
    if (!token) return;
    setRemovingMemberId(memberId);
    try {
      await removeHouseholdMember(memberId, token);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingMemberId(null);
    }
  }

  // ── Custom Category handlers ────────────────────────────────────────
  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token || !catForm.name.trim()) return;
    setCatSaving(true);
    try {
      const c = await createCustomCategory({ name: catForm.name, is_income: catForm.is_income }, token);
      setCustomCats((prev) => [...prev, c]);
      setCatForm({ name: "", is_income: false });
    } catch {} finally {
      setCatSaving(false);
    }
  }

  async function handleAddSubcategory(parentId: string) {
    const token = getToken();
    const name = subForms[parentId]?.trim();
    if (!token || !name) return;
    try {
      const c = await createCustomCategory({ name, parent_id: parentId }, token);
      setCustomCats((prev) => [...prev, c]);
      setSubForms((p) => ({ ...p, [parentId]: "" }));
    } catch {}
  }

  async function handleDeleteCategory(id: string) {
    const token = getToken();
    if (!token) return;
    try {
      await deleteCustomCategory(id, token);
      setCustomCats((prev) => prev.filter((c) => c.id !== id));
    } catch {}
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

            {/* Purchase Price / Purchase Date */}
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
                  Purchase Date
                </label>
                <input
                  type="date"
                  value={form.purchase_date ?? ""}
                  onChange={(e) => update("purchase_date", e.target.value)}
                  className="border border-gray-300 rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {/* Closing Costs / Current Value */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Closing Costs
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.closing_costs ?? ""}
                    onChange={(e) => numField("closing_costs", e)}
                    className="border border-gray-300 rounded-lg pl-7 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="8,500"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Title, escrow, inspection, agent fees, etc.</p>
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

        {/* Household Members */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Household Members</h3>
            {profile?.role === "owner" && (
              <button
                onClick={() => { setShowAddMember((v) => !v); setMemberError(""); }}
                className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition"
              >
                + Add Member
              </button>
            )}
          </div>

          {memberSuccess && (
            <div className="mb-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">{memberSuccess}</div>
          )}

          {/* Member list */}
          <div className="space-y-2 mb-4">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold shrink-0">
                    {m.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {m.full_name}
                      {m.id === profile?.id && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                    </p>
                    <p className="text-xs text-gray-400">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.role === "owner" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                    {m.role === "owner" ? "Owner" : "Member"}
                  </span>
                  {profile?.role === "owner" && m.id !== profile.id && (
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      disabled={removingMemberId === m.id}
                      className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-40 ml-1"
                      title="Remove from household"
                    >
                      {removingMemberId === m.id ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-sm text-gray-400">No members yet.</p>
            )}
          </div>

          {/* Add member form */}
          {showAddMember && profile?.role === "owner" && (
            <form onSubmit={handleAddMember} className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
              <p className="text-sm font-medium text-gray-700">Add a Family Member</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input
                    required type="text"
                    value={memberForm.full_name}
                    onChange={(e) => setMemberForm((p) => ({ ...p, full_name: e.target.value }))}
                    placeholder="Jane Doe"
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email <span className="text-red-500">*</span></label>
                  <input
                    required type="email"
                    value={memberForm.email}
                    onChange={(e) => setMemberForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="jane@example.com"
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Password <span className="text-red-500">*</span></label>
                  <input
                    required type="password" minLength={8}
                    value={memberForm.password}
                    onChange={(e) => setMemberForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="Min 8 characters"
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                  <select
                    value={memberForm.role}
                    onChange={(e) => setMemberForm((p) => ({ ...p, role: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="member">Member (view & edit)</option>
                    <option value="owner">Owner (full access)</option>
                  </select>
                </div>
              </div>
              {memberError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{memberError}</div>
              )}
              <div className="flex gap-2">
                <button type="submit" disabled={memberSaving}
                  className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">
                  {memberSaving ? "Adding…" : "Add Member"}
                </button>
                <button type="button" onClick={() => setShowAddMember(false)}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancel</button>
              </div>
            </form>
          )}

          {profile?.role !== "owner" && (
            <p className="text-xs text-gray-400 mt-2">Only the household owner can add or remove members.</p>
          )}
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

        {/* ── Categorization Rules link ──────────────────────────────── */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg mb-1">Categorization Rules</h3>
              <p className="text-sm text-gray-500">
                Create keyword rules to auto-categorize or ignore transactions during import and in bulk.
              </p>
            </div>
            <a
              href="/rules"
              className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition whitespace-nowrap"
            >
              Manage Rules →
            </a>
          </div>
        </section>

        {/* ── Custom Categories ──────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-1">Custom Categories</h3>
          <p className="text-sm text-gray-500 mb-4">
            Add your own categories and subcategories. They'll appear in the transaction editor alongside the built-in taxonomy.
          </p>

          {/* Add parent category */}
          <form onSubmit={handleAddCategory} className="flex gap-2 items-end mb-6">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">New Category</label>
              <input type="text" value={catForm.name}
                onChange={(e) => setCatForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Pets, Side Business"
                className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-700 pb-2">
              <input type="checkbox" checked={catForm.is_income}
                onChange={(e) => setCatForm((p) => ({ ...p, is_income: e.target.checked }))}
                className="rounded border-gray-300" />
              Income
            </label>
            <button type="submit" disabled={catSaving || !catForm.name.trim()}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap">
              Add Category
            </button>
          </form>

          {/* List custom categories */}
          {customCats.filter((c) => !c.parent_id).length === 0 ? (
            <p className="text-sm text-gray-400">No custom categories yet.</p>
          ) : (
            <div className="space-y-4">
              {customCats.filter((c) => !c.parent_id).map((parent) => {
                const children = customCats.filter((c) => c.parent_id === parent.id);
                return (
                  <div key={parent.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800">{parent.name}</span>
                        {parent.is_income && (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">income</span>
                        )}
                      </div>
                      <button onClick={() => handleDeleteCategory(parent.id)}
                        className="text-xs text-red-400 hover:text-red-600">Delete</button>
                    </div>
                    {/* Subcategories */}
                    {children.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {children.map((child) => (
                          <span key={child.id} className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                            {child.name}
                            <button onClick={() => handleDeleteCategory(child.id)}
                              className="text-gray-400 hover:text-red-500 ml-0.5 leading-none">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Add subcategory inline */}
                    <div className="flex gap-2">
                      <input type="text"
                        value={subForms[parent.id] ?? ""}
                        onChange={(e) => setSubForms((p) => ({ ...p, [parent.id]: e.target.value }))}
                        placeholder="Add subcategory..."
                        className="border border-gray-200 rounded px-2 py-1 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-primary-400" />
                      <button type="button"
                        onClick={() => handleAddSubcategory(parent.id)}
                        disabled={!(subForms[parent.id]?.trim())}
                        className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40 font-medium">
                        + Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
