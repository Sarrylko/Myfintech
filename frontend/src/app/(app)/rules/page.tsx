"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  applyRules,
  Rule,
} from "@/lib/api";

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

const EMPTY_FORM = {
  name: "", match_field: "name", match_type: "contains", match_value: "",
  action: "categorize", catGroup: "", catItem: "", negate_amount: false, priority: 0,
};

function RuleForm({
  value,
  onChange,
  onSubmit,
  saving,
  error,
  submitLabel,
  onCancel,
}: {
  value: typeof EMPTY_FORM;
  onChange: (v: typeof EMPTY_FORM) => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  error: string;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const subs = TAXONOMY.find((t) => t.category === value.catGroup)?.subcategories ?? [];
  const set = (patch: Partial<typeof EMPTY_FORM>) => onChange({ ...value, ...patch });

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Rule Name (optional)</label>
        <input type="text" value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Auto-generated if blank"
          className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </div>

      {/* Match fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Match In</label>
          <select value={value.match_field} onChange={(e) => set({ match_field: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="name">Description</option>
            <option value="merchant_name">Merchant</option>
            <option value="account_type">Account Type</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Match Type</label>
          <select value={value.match_type} onChange={(e) => set({ match_type: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="contains">Contains</option>
            <option value="exact">Exact Match</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {value.match_field === "account_type" ? "Account Type (e.g. credit)" : "Keyword"}
          </label>
          <input type="text" value={value.match_value}
            onChange={(e) => set({ match_value: e.target.value })}
            placeholder={value.match_field === "account_type" ? "credit" : "e.g. Amazon"}
            className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
      </div>

      {/* Action */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
        <select value={value.action} onChange={(e) => set({ action: e.target.value })}
          className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
          <option value="categorize">Categorize transaction</option>
          <option value="ignore">Ignore transaction (hide from list)</option>
        </select>
      </div>

      {/* Category (only when action = categorize) */}
      {value.action === "categorize" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Set Category</label>
            <select value={value.catGroup} onChange={(e) => set({ catGroup: e.target.value, catItem: "" })}
              className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">— None / keep existing —</option>
              {TAXONOMY.map((t) => <option key={t.category} value={t.category}>{t.category}</option>)}
            </select>
          </div>
          {value.catGroup && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subcategory</label>
              <select value={value.catItem} onChange={(e) => set({ catItem: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="">— Select subcategory —</option>
                {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Flip sign + priority (only when categorize) */}
      {value.action === "categorize" && (
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={value.negate_amount}
              onChange={(e) => set({ negate_amount: e.target.checked })}
              className="rounded border-gray-300" />
            Flip amount to positive (credit card)
          </label>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Priority</label>
            <input type="number" value={value.priority}
              onChange={(e) => set({ priority: Number(e.target.value) })}
              className="border border-gray-300 rounded px-2 py-1 w-20 text-sm" />
          </div>
        </div>
      )}

      {/* Priority for ignore rules */}
      {value.action === "ignore" && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">Priority</label>
          <input type="number" value={value.priority}
            onChange={(e) => set({ priority: Number(e.target.value) })}
            className="border border-gray-300 rounded px-2 py-1 w-20 text-sm" />
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {saving ? "Saving..." : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="border border-gray-300 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function RulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Apply
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<number | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    listRules(token)
      .then(setRules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  function formToPayload(f: typeof EMPTY_FORM) {
    const catStr = f.action === "categorize" && f.catGroup && f.catItem
      ? `${f.catGroup} > ${f.catItem}`
      : f.action === "categorize" && f.catGroup
      ? f.catGroup
      : undefined;
    return {
      name: f.name || undefined,
      match_field: f.match_field,
      match_type: f.match_type,
      match_value: f.match_value,
      action: f.action,
      category_string: catStr ?? undefined,
      negate_amount: f.action === "categorize" ? f.negate_amount : false,
      priority: f.priority,
    };
  }

  function ruleToForm(rule: Rule): typeof EMPTY_FORM {
    const parts = rule.category_string?.split(" > ") ?? [];
    return {
      name: rule.name,
      match_field: rule.match_field,
      match_type: rule.match_type,
      match_value: rule.match_value,
      action: rule.action ?? "categorize",
      catGroup: parts[0] ?? "",
      catItem: parts[1] ?? "",
      negate_amount: rule.negate_amount,
      priority: rule.priority,
    };
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    if (!addForm.match_value.trim() && addForm.action !== "ignore") {
      setAddError("Match value is required."); return;
    }
    setAddSaving(true); setAddError("");
    try {
      const payload = formToPayload(addForm);
      const r = await createRule({
        ...payload,
        name: payload.name || `${payload.category_string || payload.action} — ${addForm.match_value}`,
      }, token);
      setRules((prev) => [r, ...prev]);
      setShowAdd(false);
      setAddForm({ ...EMPTY_FORM });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token || !editingId) return;
    setEditSaving(true); setEditError("");
    try {
      const payload = formToPayload(editForm);
      const updated = await updateRule(editingId, { ...payload, name: editForm.name || undefined }, token);
      setRules((prev) => prev.map((r) => r.id === updated.id ? updated : r));
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update rule");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleToggle(rule: Rule) {
    const token = getToken();
    if (!token) return;
    try {
      const updated = await updateRule(rule.id, { is_active: !rule.is_active }, token);
      setRules((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    } catch {}
  }

  async function handleDelete(id: string) {
    const token = getToken();
    if (!token) return;
    if (!confirm("Delete this rule?")) return;
    try {
      await deleteRule(id, token);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {}
  }

  async function handleApply() {
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
      action: "categorize",
      negate_amount: true,
      priority: 100,
    }, token);
    setRules((prev) => [r, ...prev]);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Categorization Rules</h2>
          <p className="text-sm text-gray-500 mt-1">
            Rules run automatically during CSV import and when you click "Apply All". First match wins (higher priority runs first).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={addCreditCardRule}
            className="border border-indigo-200 text-indigo-700 text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition font-medium">
            + Credit Card Sign Flip
          </button>
          <button onClick={handleApply} disabled={applying}
            className="border border-green-200 text-green-700 text-xs px-3 py-1.5 rounded-lg hover:bg-green-50 transition font-medium disabled:opacity-50">
            {applying ? "Applying..." : "Apply All to Transactions"}
          </button>
          <button onClick={() => setShowAdd((v) => !v)}
            className="bg-primary-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-primary-700 transition font-medium">
            {showAdd ? "Cancel" : "+ Add Rule"}
          </button>
        </div>
      </div>

      {applyResult !== null && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">
          {applyResult} transaction{applyResult !== 1 ? "s" : ""} updated.
        </div>
      )}

      {/* Add Rule form */}
      {showAdd && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-3">New Rule</p>
          <RuleForm
            value={addForm}
            onChange={setAddForm}
            onSubmit={handleAdd}
            saving={addSaving}
            error={addError}
            submitLabel="Create Rule"
            onCancel={() => { setShowAdd(false); setAddForm({ ...EMPTY_FORM }); }}
          />
        </div>
      )}

      {/* Rule list */}
      <div className="bg-white rounded-lg shadow border border-gray-100">
        {loading ? (
          <p className="text-sm text-gray-400 p-6">Loading rules...</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-gray-400 p-6">No rules yet. Add a rule or click "+ Credit Card Sign Flip" to get started.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {rules.map((rule) => (
              <div key={rule.id} className="p-4">
                {editingId === rule.id ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">Edit Rule</p>
                    <RuleForm
                      value={editForm}
                      onChange={setEditForm}
                      onSubmit={handleSaveEdit}
                      saving={editSaving}
                      error={editError}
                      submitLabel="Save Changes"
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-sm font-medium text-gray-800">{rule.name}</span>
                        {!rule.is_active && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">inactive</span>
                        )}
                        {rule.action === "ignore" ? (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">ignore</span>
                        ) : (
                          rule.negate_amount && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">flip +</span>
                          )
                        )}
                        {rule.priority > 0 && (
                          <span className="text-xs text-gray-400">priority {rule.priority}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {rule.match_field === "account_type" ? "Account type" : rule.match_field === "merchant_name" ? "Merchant" : "Description"}{" "}
                        <strong>{rule.match_type}</strong> &ldquo;{rule.match_value}&rdquo;
                        {rule.action === "ignore" ? (
                          <span className="text-orange-600 font-medium"> → ignore</span>
                        ) : rule.category_string ? (
                          <> → <span className="text-indigo-700 font-medium">{rule.category_string}</span></>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => { setEditForm(ruleToForm(rule)); setEditingId(rule.id); setEditError(""); }}
                        className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">
                        Edit
                      </button>
                      <button onClick={() => handleToggle(rule)}
                        className={`text-xs px-2 py-1 rounded border ${rule.is_active ? "border-gray-200 text-gray-600 hover:bg-gray-50" : "border-indigo-200 text-indigo-600 hover:bg-indigo-50"}`}>
                        {rule.is_active ? "Disable" : "Enable"}
                      </button>
                      <button onClick={() => handleDelete(rule.id)}
                        className="text-xs text-red-400 hover:text-red-600 px-2 py-1">
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
