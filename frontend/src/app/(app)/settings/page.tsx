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
  listRules,
  createRule,
  updateRule,
  deleteRule,
  applyRules,
  listCustomCategories,
  createCustomCategory,
  deleteCustomCategory,
  Rule,
  CustomCategory,
} from "@/lib/api";

// ─── Taxonomy (same as transactions page) ────────────────────────────────────
const TAXONOMY: { category: string; subcategories: string[] }[] = [
  { category: "Housing", subcategories: ["Mortgage / Rent", "Property Tax", "HOA Fees", "Home Insurance", "Maintenance & Repairs", "Furnishings", "Cleaning Services", "Lawn / Snow Care", "Security Systems"] },
  { category: "Utilities", subcategories: ["Electricity", "Water & Sewer", "Gas Utility", "Trash / Recycling", "Internet", "Cable / Streaming TV", "Mobile Phone"] },
  { category: "Food & Dining", subcategories: ["Groceries", "Restaurants", "Coffee Shops", "Fast Food", "Food Delivery", "Alcohol & Bars"] },
  { category: "Transportation", subcategories: ["Fuel", "Parking", "Tolls", "Public Transit", "Rideshare (Uber/Lyft)", "Car Payment", "Car Insurance", "Vehicle Maintenance", "DMV / Registration"] },
  { category: "Health & Medical", subcategories: ["Doctor Visits", "Dental", "Vision", "Pharmacy", "Health Insurance", "Therapy / Mental Health", "Medical Equipment", "Fitness / Gym"] },
  { category: "Shopping", subcategories: ["General Merchandise", "Clothing", "Electronics", "Home Improvement", "Gifts", "Personal Care Products", "Kids Items"] },
  { category: "Education", subcategories: ["Tuition", "School Supplies", "Courses / Training", "Books", "Kids Activities", "College Savings (529)"] },
  { category: "Kids & Family", subcategories: ["Childcare / Daycare", "Allowance", "Activities / Sports", "Camps", "Babysitting"] },
  { category: "Income", subcategories: ["Salary", "Bonus", "Interest Income", "Dividends", "Rental Income", "Side Hustle", "Refunds", "Transfers In"] },
  { category: "Savings & Investments", subcategories: ["Brokerage Contributions", "Retirement Contributions (401k / IRA)", "529 Contributions", "Emergency Fund", "Transfers Out"] },
  { category: "Financial", subcategories: ["Bank Fees", "Loan Payments", "Credit Card Payments", "Interest Paid", "Tax Payments", "Tax Refund"] },
  { category: "Travel", subcategories: ["Flights", "Hotels", "Vacation Rentals", "Car Rental", "Travel Insurance", "Attractions", "Travel Dining"] },
  { category: "Entertainment", subcategories: ["Movies", "Events / Concerts", "Streaming Services", "Gaming", "Hobbies", "Subscriptions"] },
  { category: "Personal Care", subcategories: ["Salon / Spa", "Haircuts", "Cosmetics", "Massage", "Wellness"] },
  { category: "Insurance", subcategories: ["Life Insurance", "Disability Insurance", "Umbrella Insurance"] },
  { category: "Business / Work", subcategories: ["Business Expenses", "Professional Fees", "Software", "Office Supplies", "Travel (Work)"] },
  { category: "Taxes", subcategories: ["Federal Tax", "State Tax", "Local Tax", "Estimated Payments"] },
  { category: "Transfers", subcategories: ["Internal Transfer", "Credit Card Payment", "Account Transfer"] },
  { category: "Miscellaneous", subcategories: ["Cash Withdrawal", "Uncategorized", "Adjustment"] },
];

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

  // ── Rules state ────────────────────────────────────────────────────
  const [rules, setRules] = useState<Rule[]>([]);
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    name: "", match_field: "name", match_type: "contains", match_value: "",
    catGroup: "", catItem: "", negate_amount: false, priority: 0,
  });
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState("");
  const [applyResult, setApplyResult] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  // ── Custom Categories state ─────────────────────────────────────────
  const [customCats, setCustomCats] = useState<CustomCategory[]>([]);
  const [catForm, setCatForm] = useState({ name: "", is_income: false });
  const [subForms, setSubForms] = useState<Record<string, string>>({});
  const [catSaving, setCatSaving] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    listRules(token).then(setRules).catch(() => {});
    listCustomCategories(token).then(setCustomCats).catch(() => {});
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

  // ── Rule handlers ──────────────────────────────────────────────────
  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const catStr = ruleForm.catGroup && ruleForm.catItem
      ? `${ruleForm.catGroup} > ${ruleForm.catItem}`
      : ruleForm.catGroup || undefined;
    if (!ruleForm.match_value.trim() && !ruleForm.negate_amount) {
      setRuleError("Match value is required unless only flipping sign."); return;
    }
    setRuleSaving(true); setRuleError("");
    try {
      const r = await createRule({
        name: ruleForm.name || `${catStr || "Rule"} — ${ruleForm.match_value}`,
        match_field: ruleForm.match_field,
        match_type: ruleForm.match_type,
        match_value: ruleForm.match_value,
        category_string: catStr,
        negate_amount: ruleForm.negate_amount,
        priority: ruleForm.priority,
      }, token);
      setRules((prev) => [r, ...prev]);
      setShowAddRule(false);
      setRuleForm({ name: "", match_field: "name", match_type: "contains", match_value: "", catGroup: "", catItem: "", negate_amount: false, priority: 0 });
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setRuleSaving(false);
    }
  }

  async function handleToggleRule(rule: Rule) {
    const token = getToken();
    if (!token) return;
    try {
      const updated = await updateRule(rule.id, { is_active: !rule.is_active }, token);
      setRules((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    } catch {}
  }

  async function handleDeleteRule(id: string) {
    const token = getToken();
    if (!token) return;
    try {
      await deleteRule(id, token);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {}
  }

  async function handleApplyRules() {
    const token = getToken();
    if (!token) return;
    setApplying(true); setApplyResult(null);
    try {
      const res = await applyRules(token);
      setApplyResult(res.applied);
    } catch {} finally {
      setApplying(false);
    }
  }

  async function addCreditCardRule() {
    const token = getToken();
    if (!token) return;
    const r = await createRule({
      name: "Credit Card Sign Flip",
      match_field: "account_type",
      match_type: "exact",
      match_value: "credit",
      negate_amount: true,
      priority: 100,
    }, token);
    setRules((prev) => [r, ...prev]);
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

  const ruleCatSubcategories = TAXONOMY.find((t) => t.category === ruleForm.catGroup)?.subcategories ?? [];

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

        {/* ── Categorization Rules ───────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-lg">Categorization Rules</h3>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={addCreditCardRule}
                className="border border-indigo-200 text-indigo-700 text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition font-medium"
              >
                + Credit Card Sign Flip
              </button>
              <button
                onClick={handleApplyRules}
                disabled={applying}
                className="border border-green-200 text-green-700 text-xs px-3 py-1.5 rounded-lg hover:bg-green-50 transition font-medium disabled:opacity-50"
              >
                {applying ? "Applying..." : "Apply Rules to All Transactions"}
              </button>
              <button
                onClick={() => setShowAddRule((v) => !v)}
                className="bg-primary-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-primary-700 transition font-medium"
              >
                {showAddRule ? "Cancel" : "+ Add Rule"}
              </button>
            </div>
          </div>

          {applyResult !== null && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">
              {applyResult} transaction{applyResult !== 1 ? "s" : ""} categorized.
            </div>
          )}

          <p className="text-xs text-gray-500 mb-4">
            Rules automatically categorize transactions during CSV import and when you click "Apply Rules". The first matching rule wins (higher priority runs first).
          </p>

          {/* Add Rule form */}
          {showAddRule && (
            <form onSubmit={handleAddRule} className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">New Rule</p>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rule Name (optional)</label>
                <input type="text" value={ruleForm.name}
                  onChange={(e) => setRuleForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Auto-generated if blank"
                  className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Match In</label>
                  <select value={ruleForm.match_field}
                    onChange={(e) => setRuleForm((p) => ({ ...p, match_field: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="name">Description</option>
                    <option value="merchant_name">Merchant</option>
                    <option value="account_type">Account Type</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Match Type</label>
                  <select value={ruleForm.match_type}
                    onChange={(e) => setRuleForm((p) => ({ ...p, match_type: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="contains">Contains</option>
                    <option value="exact">Exact Match</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {ruleForm.match_field === "account_type" ? "Account Type (e.g. credit)" : "Keyword"}
                  </label>
                  <input type="text" value={ruleForm.match_value}
                    onChange={(e) => setRuleForm((p) => ({ ...p, match_value: e.target.value }))}
                    placeholder={ruleForm.match_field === "account_type" ? "credit" : "e.g. Amazon"}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Set Category</label>
                  <select value={ruleForm.catGroup}
                    onChange={(e) => setRuleForm((p) => ({ ...p, catGroup: e.target.value, catItem: "" }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="">— None / keep existing —</option>
                    {TAXONOMY.map((t) => <option key={t.category} value={t.category}>{t.category}</option>)}
                  </select>
                </div>
                {ruleForm.catGroup && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subcategory</label>
                    <select value={ruleForm.catItem}
                      onChange={(e) => setRuleForm((p) => ({ ...p, catItem: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                      <option value="">— Select subcategory —</option>
                      {ruleCatSubcategories.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={ruleForm.negate_amount}
                    onChange={(e) => setRuleForm((p) => ({ ...p, negate_amount: e.target.checked }))}
                    className="rounded border-gray-300" />
                  Flip amount to positive (for credit card transactions)
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Priority</label>
                  <input type="number" value={ruleForm.priority}
                    onChange={(e) => setRuleForm((p) => ({ ...p, priority: Number(e.target.value) }))}
                    className="border border-gray-300 rounded px-2 py-1 w-20 text-sm" />
                </div>
              </div>

              {ruleError && <p className="text-red-600 text-sm">{ruleError}</p>}

              <button type="submit" disabled={ruleSaving}
                className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {ruleSaving ? "Saving..." : "Create Rule"}
              </button>
            </form>
          )}

          {/* Rule list */}
          {rules.length === 0 ? (
            <p className="text-sm text-gray-400">No rules yet. Add a rule or click "+ Credit Card Sign Flip" to get started.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {rules.map((rule) => (
                <div key={rule.id} className="py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-sm font-medium text-gray-800">{rule.name}</span>
                      {!rule.is_active && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">inactive</span>
                      )}
                      {rule.negate_amount && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">flip +</span>
                      )}
                      {rule.priority > 0 && (
                        <span className="text-xs text-gray-400">priority {rule.priority}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {rule.match_field === "account_type" ? "Account type" : rule.match_field === "merchant_name" ? "Merchant" : "Description"}{" "}
                      <strong>{rule.match_type}</strong> "{rule.match_value}"
                      {rule.category_string && (
                        <> → <span className="text-indigo-700 font-medium">{rule.category_string}</span></>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleRule(rule)}
                      className={`text-xs px-2 py-1 rounded border ${rule.is_active ? "border-gray-200 text-gray-600 hover:bg-gray-50" : "border-indigo-200 text-indigo-600 hover:bg-indigo-50"}`}
                    >
                      {rule.is_active ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
