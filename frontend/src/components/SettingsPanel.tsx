"use client";

import { useState, useEffect } from "react";
import {
  UserResponse,
  UserProfileUpdate,
  updateProfile,
  changePassword,
  listHouseholdMembers,
  addHouseholdMember,
  updateHouseholdMember,
  removeHouseholdMember,
  HouseholdMemberCreate,
  HouseholdMemberUpdate,
  listCustomCategories,
  createCustomCategory,
  deleteCustomCategory,
  seedDefaultCategories,
  CustomCategory,
  getInvestmentSettings,
  updateInvestmentSettings,
  InvestmentRefreshSettings,
} from "@/lib/api";

export type SettingsTab =
  | "profile"
  | "security"
  | "household"
  | "categories"
  | "preferences";

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  profile: UserResponse | null;
  onProfileUpdate: (p: UserResponse) => void;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "household", label: "Household" },
  { id: "categories", label: "Categories" },
  { id: "preferences", label: "Preferences" },
];

// ── Shared input component ───────────────────────────────────────────────────
function Field({
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
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 w-full text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}

function Alert({
  type,
  children,
}: {
  type: "ok" | "err";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`text-sm rounded-lg px-4 py-3 border ${
        type === "ok"
          ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
          : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
      }`}
    >
      {children}
    </div>
  );
}

// ── Profile Tab ──────────────────────────────────────────────────────────────
function ProfileTab({
  profile,
  onProfileUpdate,
}: {
  profile: UserResponse | null;
  onProfileUpdate: (p: UserResponse) => void;
}) {
  const [form, setForm] = useState<UserProfileUpdate>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name ?? "",
        email: profile.email ?? "",
        phone: profile.phone ?? "",
        address_line1: profile.address_line1 ?? "",
        address_line2: profile.address_line2 ?? "",
        city: profile.city ?? "",
        state: profile.state ?? "",
        zip_code: profile.zip_code ?? "",
      });
    }
  }, [profile]);

  function set(field: keyof UserProfileUpdate, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    setMsg(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const updated = await updateProfile(form);
      onProfileUpdate(updated);
      setMsg({ type: "ok", text: "Profile updated successfully." });
      setTimeout(() => setMsg(null), 4000);
    } catch (err) {
      setMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Failed to update profile",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Full Name"
          value={form.full_name ?? ""}
          onChange={(v) => set("full_name", v)}
          placeholder="Jane Smith"
        />
        <Field
          label="Email"
          type="email"
          value={form.email ?? ""}
          onChange={(v) => set("email", v)}
          placeholder="you@example.com"
        />
      </div>

      <div className="max-w-xs">
        <Field
          label="Phone Number"
          type="tel"
          value={form.phone ?? ""}
          onChange={(v) => set("phone", v)}
          placeholder="+1 (555) 000-0000"
        />
      </div>

      <Field
        label="Address Line 1"
        value={form.address_line1 ?? ""}
        onChange={(v) => set("address_line1", v)}
        placeholder="123 Main St"
      />
      <Field
        label="Address Line 2"
        value={form.address_line2 ?? ""}
        onChange={(v) => set("address_line2", v)}
        placeholder="Apt 4B (optional)"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field
          label="City"
          value={form.city ?? ""}
          onChange={(v) => set("city", v)}
          placeholder="Austin"
        />
        <Field
          label="State"
          value={form.state ?? ""}
          onChange={(v) => set("state", v)}
          placeholder="TX"
        />
        <Field
          label="ZIP Code"
          value={form.zip_code ?? ""}
          onChange={(v) => set("zip_code", v)}
          placeholder="78701"
        />
      </div>

      {msg && <Alert type={msg.type}>{msg.text}</Alert>}

      <button
        type="submit"
        disabled={saving || !profile}
        className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Profile"}
      </button>
    </form>
  );
}

// ── Security Tab ─────────────────────────────────────────────────────────────
function SecurityTab() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function set(field: keyof typeof form, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    setMsg(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.next !== form.confirm) {
      setMsg({ type: "err", text: "New passwords do not match." });
      return;
    }
    if (form.next.length < 12) {
      setMsg({ type: "err", text: "Password must be at least 12 characters." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await changePassword(form.current, form.next);
      setForm({ current: "", next: "", confirm: "" });
      setMsg({ type: "ok", text: "Password changed successfully." });
      setTimeout(() => setMsg(null), 4000);
    } catch (err) {
      setMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Failed to change password",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      <Field
        label="Current Password"
        type="password"
        value={form.current}
        onChange={(v) => set("current", v)}
        placeholder="Your current password"
      />
      <Field
        label="New Password"
        type="password"
        value={form.next}
        onChange={(v) => set("next", v)}
        placeholder="Min 12 characters"
      />
      <Field
        label="Confirm New Password"
        type="password"
        value={form.confirm}
        onChange={(v) => set("confirm", v)}
        placeholder="Repeat new password"
      />

      {msg && <Alert type={msg.type}>{msg.text}</Alert>}

      <button
        type="submit"
        disabled={saving}
        className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
      >
        {saving ? "Updating…" : "Change Password"}
      </button>
    </form>
  );
}

// ── Household Tab ────────────────────────────────────────────────────────────
function HouseholdTab({ profile }: { profile: UserResponse | null }) {
  const [members, setMembers] = useState<UserResponse[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [memberForm, setMemberForm] = useState<HouseholdMemberCreate>({
    full_name: "",
    email: "",
    password: "",
    role: "member",
  });
  const [showAdd, setShowAdd] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [memberSuccess, setMemberSuccess] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<HouseholdMemberUpdate>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    listHouseholdMembers()
      .then((m) => { setMembers(m); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setMemberSaving(true);
    setMemberError("");
    try {
      const m = await addHouseholdMember(memberForm);
      setMembers((prev) => [...prev, m]);
      setMemberForm({ full_name: "", email: "", password: "", role: "member" });
      setShowAdd(false);
      setMemberSuccess(`${m.full_name} added successfully.`);
      setTimeout(() => setMemberSuccess(""), 4000);
    } catch (err) {
      setMemberError(
        err instanceof Error ? err.message : "Failed to add member"
      );
    } finally {
      setMemberSaving(false);
    }
  }

  function startEdit(m: UserResponse) {
    setEditingId(m.id);
    setEditForm({ full_name: m.full_name, email: m.email, phone: m.phone ?? "" });
    setEditError("");
  }

  async function handleSaveMember(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditSaving(true);
    setEditError("");
    try {
      const updated = await updateHouseholdMember(editingId, editForm);
      setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditingId(null);
      setMemberSuccess(`${updated.full_name} updated.`);
      setTimeout(() => setMemberSuccess(""), 4000);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to update member"
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this member from the household?")) return;
    setRemovingId(id);
    try {
      await removeHouseholdMember(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  }

  if (!loaded) {
    return <p className="text-sm text-gray-400">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Manage who has access to this household.
        </p>
        {profile?.role === "owner" && (
          <button
            onClick={() => { setShowAdd((v) => !v); setMemberError(""); }}
            className="bg-primary-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-primary-700 transition whitespace-nowrap"
          >
            + Add Member
          </button>
        )}
      </div>

      {memberSuccess && (
        <Alert type="ok">{memberSuccess}</Alert>
      )}

      {/* Member list */}
      <div className="space-y-2">
        {members.map((m) => (
          <div
            key={m.id}
            className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700"
          >
            {editingId === m.id ? (
              <form onSubmit={handleSaveMember} className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Full Name
                    </label>
                    <input
                      required
                      type="text"
                      value={editForm.full_name ?? ""}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, full_name: e.target.value }))
                      }
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 w-full text-sm bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Email
                    </label>
                    <input
                      required
                      type="email"
                      value={editForm.email ?? ""}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, email: e.target.value }))
                      }
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 w-full text-sm bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Phone (WhatsApp)
                    </label>
                    <input
                      type="tel"
                      value={editForm.phone ?? ""}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, phone: e.target.value }))
                      }
                      placeholder="+1 555 000 0000"
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 w-full text-sm bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
                {editError && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {editError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="bg-primary-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-primary-700 disabled:opacity-50 transition"
                  >
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingId(null); setEditError(""); }}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 flex items-center justify-center text-sm font-semibold shrink-0">
                    {m.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {m.full_name}
                      {m.id === profile?.id && (
                        <span className="ml-1.5 text-xs text-gray-400">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {m.email}
                      {m.phone ? ` · ${m.phone}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.role === "owner"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    }`}
                  >
                    {m.role === "owner" ? "Owner" : "Member"}
                  </span>
                  {profile?.role === "owner" && m.id !== profile.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="text-xs text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(m.id)}
                        disabled={removingId === m.id}
                        className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-40"
                      >
                        {removingId === m.id ? "Removing…" : "Remove"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="text-sm text-gray-400">No members yet.</p>
        )}
      </div>

      {/* Add member form */}
      {showAdd && profile?.role === "owner" && (
        <form
          onSubmit={handleAddMember}
          className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50 space-y-3"
        >
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Add a Family Member
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="text"
                value={memberForm.full_name}
                onChange={(e) =>
                  setMemberForm((p) => ({ ...p, full_name: e.target.value }))
                }
                placeholder="Jane Doe"
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 w-full text-sm bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="email"
                value={memberForm.email}
                onChange={(e) =>
                  setMemberForm((p) => ({ ...p, email: e.target.value }))
                }
                placeholder="jane@example.com"
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 w-full text-sm bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="password"
                minLength={12}
                value={memberForm.password}
                onChange={(e) =>
                  setMemberForm((p) => ({ ...p, password: e.target.value }))
                }
                placeholder="Min 12 characters"
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 w-full text-sm bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Role
              </label>
              <select
                value={memberForm.role}
                onChange={(e) =>
                  setMemberForm((p) => ({ ...p, role: e.target.value }))
                }
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 w-full text-sm bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="member">Member (view & edit)</option>
                <option value="owner">Owner (full access)</option>
              </select>
            </div>
          </div>
          {memberError && <Alert type="err">{memberError}</Alert>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={memberSaving}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition"
            >
              {memberSaving ? "Adding…" : "Add Member"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {profile?.role !== "owner" && (
        <p className="text-xs text-gray-400">
          Only the household owner can add or remove members.
        </p>
      )}
    </div>
  );
}

// ── Categories Tab — split-pane ───────────────────────────────────────────────
function CategoriesTab() {
  const [customCats, setCustomCats] = useState<CustomCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({ name: "", is_income: false });
  const [subInput, setSubInput] = useState("");
  const [catSaving, setCatSaving] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);

  useEffect(() => {
    listCustomCategories()
      .then((cats) => {
        setCustomCats(cats);
        const parents = cats.filter((c) => !c.parent_id);
        if (parents.length > 0) setSelectedCatId(parents[0].id);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const parentCats = customCats.filter((c) => !c.parent_id);
  const selectedParent = parentCats.find((c) => c.id === selectedCatId) ?? null;
  const childCats = selectedCatId
    ? customCats.filter((c) => c.parent_id === selectedCatId)
    : [];

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catForm.name.trim()) return;
    setCatSaving(true);
    try {
      const c = await createCustomCategory({
        name: catForm.name,
        is_income: catForm.is_income,
      });
      setCustomCats((prev) => [...prev, c]);
      if (!selectedCatId) setSelectedCatId(c.id);
      setCatForm({ name: "", is_income: false });
    } catch {
      // silent
    } finally {
      setCatSaving(false);
    }
  }

  async function handleAddSubcategory() {
    if (!selectedCatId || !subInput.trim()) return;
    const name = subInput.trim();
    setSubInput("");
    try {
      const c = await createCustomCategory({ name, parent_id: selectedCatId });
      setCustomCats((prev) => [...prev, c]);
    } catch {
      // silent
    }
  }

  async function handleDeleteCategory(id: string) {
    try {
      await deleteCustomCategory(id);
      setCustomCats((prev) =>
        prev.filter((c) => c.id !== id && c.parent_id !== id)
      );
      if (selectedCatId === id) {
        const remaining = parentCats.filter((c) => c.id !== id);
        setSelectedCatId(remaining[0]?.id ?? null);
      }
    } catch {
      // silent
    }
  }

  async function handleSeedDefaults() {
    setSeedLoading(true);
    try {
      const all = await seedDefaultCategories();
      setCustomCats(all);
      const parents = all.filter((c) => !c.parent_id);
      if (parents.length > 0) setSelectedCatId(parents[0].id);
    } catch {
      // silent
    } finally {
      setSeedLoading(false);
    }
  }

  if (!loaded) {
    return <p className="text-sm text-gray-400">Loading…</p>;
  }

  return (
    <div className="flex flex-col sm:flex-row border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden min-h-[380px]">
      {/* ── Left pane: parent categories ── */}
      <div className="sm:w-52 shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-gray-200 dark:border-gray-700">
        {/* Add parent form */}
        <form
          onSubmit={handleAddCategory}
          className="p-3 space-y-2 border-b border-gray-200 dark:border-gray-700"
        >
          <input
            type="text"
            value={catForm.name}
            onChange={(e) =>
              setCatForm((p) => ({ ...p, name: e.target.value }))
            }
            placeholder="New category name…"
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 w-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={catForm.is_income}
                onChange={(e) =>
                  setCatForm((p) => ({ ...p, is_income: e.target.checked }))
                }
                className="rounded border-gray-300 text-primary-600"
              />
              Income
            </label>
            <button
              type="submit"
              disabled={catSaving || !catForm.name.trim()}
              className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:text-primary-700 disabled:opacity-40 transition"
            >
              {catSaving ? "Adding…" : "+ Add"}
            </button>
          </div>
        </form>

        {/* Category list */}
        <ul className="flex-1 overflow-y-auto">
          {parentCats.length === 0 && (
            <li className="px-4 py-3 text-xs text-gray-400 italic">
              No categories yet.
            </li>
          )}
          {parentCats.map((cat) => {
            const childCount = customCats.filter(
              (c) => c.parent_id === cat.id
            ).length;
            return (
              <li
                key={cat.id}
                onClick={() => {
                  setSelectedCatId(cat.id);
                  setSubInput("");
                }}
                className={`flex items-center justify-between px-3 py-2.5 cursor-pointer text-sm transition border-b border-gray-100 dark:border-gray-700/50 last:border-0 ${
                  selectedCatId === cat.id
                    ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-xs">{cat.name}</span>
                  {cat.is_income && (
                    <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1 rounded shrink-0 font-medium">
                      $
                    </span>
                  )}
                  {childCount > 0 && (
                    <span className="text-xs text-gray-400 shrink-0">
                      ({childCount})
                    </span>
                  )}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCategory(cat.id);
                  }}
                  className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition shrink-0 ml-1 text-lg leading-none"
                  title="Delete category"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>

        {/* Seed defaults */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleSeedDefaults}
            disabled={seedLoading}
            className="text-xs text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition disabled:opacity-40"
          >
            {seedLoading ? "Seeding…" : "Seed default categories"}
          </button>
        </div>
      </div>

      {/* ── Right pane: subcategories ── */}
      <div className="flex-1 p-4 flex flex-col">
        {!selectedParent ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400 text-center">
              {parentCats.length === 0
                ? "Add a category on the left to get started."
                : "Select a category to manage subcategories."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              {selectedParent.name} — Subcategories
            </p>

            {/* Subcategory chips */}
            <div className="flex flex-wrap gap-1.5 mb-4 min-h-[2rem]">
              {childCats.length === 0 && (
                <span className="text-xs text-gray-400 italic">
                  No subcategories yet.
                </span>
              )}
              {childCats.map((child) => (
                <span
                  key={child.id}
                  className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2.5 py-1 rounded-full"
                >
                  {child.name}
                  <button
                    onClick={() => handleDeleteCategory(child.id)}
                    className="text-gray-400 hover:text-red-500 transition ml-0.5 leading-none text-sm"
                    aria-label={`Remove ${child.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            {/* Add subcategory input */}
            <div className="flex gap-2 mt-auto">
              <input
                type="text"
                value={subInput}
                onChange={(e) => setSubInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSubcategory();
                  }
                }}
                placeholder="Add subcategory…"
                className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs flex-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
              <button
                onClick={handleAddSubcategory}
                disabled={!subInput.trim()}
                className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:text-primary-700 disabled:opacity-40 transition whitespace-nowrap"
              >
                + Add
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Preferences Tab ──────────────────────────────────────────────────────────
function PreferencesTab() {
  const [settings, setSettings] = useState<InvestmentRefreshSettings>({
    price_refresh_enabled: true,
    price_refresh_interval_minutes: 15,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    getInvestmentSettings()
      .then((s) => { setSettings(s); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const updated = await updateInvestmentSettings(settings);
      setSettings(updated);
      setMsg({ type: "ok", text: "Settings saved." });
      setTimeout(() => setMsg(null), 3000);
    } catch (err) {
      setMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Failed to save settings",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <p className="text-sm text-gray-400">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
          Investment Price Refresh
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Automatically update holding prices during NYSE market hours
          (Mon–Fri, 9:30 AM – 4:00 PM ET).
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={settings.price_refresh_enabled}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    price_refresh_enabled: e.target.checked,
                  }))
                }
                className="sr-only peer"
              />
              <div className="w-10 h-6 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors" />
              <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {settings.price_refresh_enabled
                ? "Auto-refresh enabled"
                : "Auto-refresh disabled"}
            </span>
          </label>

          {settings.price_refresh_enabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Refresh interval
              </label>
              <select
                value={settings.price_refresh_interval_minutes}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    price_refresh_interval_minutes: Number(e.target.value),
                  }))
                }
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={5}>Every 5 minutes</option>
                <option value={10}>Every 10 minutes</option>
                <option value={15}>Every 15 minutes (default)</option>
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every hour</option>
              </select>
            </div>
          )}

          {msg && <Alert type={msg.type}>{msg.text}</Alert>}

          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main SettingsPanel component ─────────────────────────────────────────────
export default function SettingsPanel({
  open,
  onClose,
  initialTab = "profile",
  profile,
  onProfileUpdate,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Sync tab when opened with a specific tab
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Body scroll lock
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[560px] z-50 bg-white dark:bg-gray-900 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            aria-label="Close settings"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 shrink-0 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition border-b-2 ${
                activeTab === t.id
                  ? "border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === "profile" && (
            <ProfileTab profile={profile} onProfileUpdate={onProfileUpdate} />
          )}
          {activeTab === "security" && <SecurityTab />}
          {activeTab === "household" && <HouseholdTab profile={profile} />}
          {activeTab === "categories" && <CategoriesTab />}
          {activeTab === "preferences" && <PreferencesTab />}
        </div>
      </div>
    </>
  );
}
