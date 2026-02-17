"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  listAllTransactions,
  listAccounts,
  listCustomCategories,
  importCsv,
  updateTransaction,
  createRule,
  Account,
  Transaction,
  CustomCategory,
} from "@/lib/api";

// ─── Category Taxonomy ────────────────────────────────────────────────────────

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

/** Parse a stored "Category > Subcategory" string back into parts. */
function parseCategory(raw: string | null): { group: string; item: string } {
  if (!raw) return { group: "", item: "" };
  if (raw.includes(" > ")) {
    const idx = raw.indexOf(" > ");
    return { group: raw.slice(0, idx).trim(), item: raw.slice(idx + 3).trim() };
  }
  // Check if it matches a known subcategory
  for (const { category, subcategories } of TAXONOMY) {
    if (subcategories.includes(raw)) return { group: category, item: raw };
    if (category === raw) return { group: raw, item: "" };
  }
  return { group: "", item: "" };
}

// ─── CSV Template ─────────────────────────────────────────────────────────────

const CSV_TEMPLATE =
  `date,description,amount,merchant,category,notes\n` +
  `2024-01-15,Grocery Store,85.50,Whole Foods,Food & Drink,Weekly groceries\n` +
  `2024-01-16,Monthly Salary,-3500.00,,Income,January salary\n` +
  `2024-01-17,Electric Bill,120.00,City Electric,Utilities,\n` +
  `2024-01-18,Restaurant Dinner,62.75,Olive Garden,Food & Drink,\n`;

const CSV_NOTES = [
  "date — YYYY-MM-DD, MM/DD/YYYY, or MM/DD/YY",
  "description — required, what the transaction is",
  "amount — positive = expense (money out), negative = income (money in)",
  "merchant — optional, merchant or payee name",
  "category — optional, e.g. Food & Drink, Utilities, Income",
  "notes — optional, any personal notes",
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtAmt(amount: string): { display: string; isExpense: boolean } {
  const n = parseFloat(amount);
  const abs = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Math.abs(n));
  return { display: n > 0 ? `-${abs}` : `+${abs}`, isExpense: n > 0 };
}

function EditModal({ txn, accounts, customTaxonomy, onSave, onClose }: {
  txn: Transaction;
  accounts: Account[];
  customTaxonomy: { category: string; subcategories: string[] }[];
  onSave: (updated: Transaction, newCategory: string | undefined, prevCategory: string | null) => void;
  onClose: () => void;
}) {
  const parsed = parseCategory(txn.plaid_category);
  const [form, setForm] = useState({
    name: txn.name,
    merchant_name: txn.merchant_name ?? "",
    amount: parseFloat(txn.amount).toFixed(2),
    date: txn.date.slice(0, 10),
    categoryGroup: parsed.group,
    categoryItem: parsed.item,
    notes: txn.notes ?? "",
    pending: txn.pending,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allTaxonomy = [...TAXONOMY, ...customTaxonomy];
  const subcategories = allTaxonomy.find((t) => t.category === form.categoryGroup)?.subcategories ?? [];

  function handleGroupChange(group: string) {
    setForm((p) => ({ ...p, categoryGroup: group, categoryItem: "" }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    const amtNum = parseFloat(form.amount);
    if (isNaN(amtNum)) { setError("Amount must be a number"); return; }

    const plaid_category = form.categoryGroup && form.categoryItem
      ? `${form.categoryGroup} > ${form.categoryItem}`
      : form.categoryGroup || undefined;

    setSaving(true); setError("");
    try {
      const updated = await updateTransaction(txn.id, {
        name: form.name || undefined,
        merchant_name: form.merchant_name || undefined,
        amount: amtNum,
        date: form.date ? new Date(form.date + "T00:00:00Z").toISOString() : undefined,
        plaid_category,
        notes: form.notes || undefined,
        pending: form.pending,
      }, token);
      onSave(updated, plaid_category, txn.plaid_category);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const acct = accounts.find((a) => a.id === txn.account_id);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-lg">Edit Transaction</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        {acct && (
          <div className="px-5 py-2 bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
            Account: <span className="font-medium text-gray-700">{acct.name}{acct.mask ? ` ••• ${acct.mask}` : ""}</span>
          </div>
        )}
        <form onSubmit={handleSave} className="p-5 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
            <input type="text" required value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input type="number" step="any" required value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                  className="border border-gray-300 rounded-lg pl-7 pr-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">+ = expense, − = income</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" required value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Merchant / Payee</label>
            <input type="text" value={form.merchant_name}
              onChange={(e) => setForm((p) => ({ ...p, merchant_name: e.target.value }))}
              placeholder="Optional"
              className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>

          {/* Category two-level dropdowns */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={form.categoryGroup}
              onChange={(e) => handleGroupChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="">— Select category —</option>
              {TAXONOMY.map((t) => (
                <option key={t.category} value={t.category}>{t.category}</option>
              ))}
              {customTaxonomy.length > 0 && (
                <optgroup label="── Custom ──">
                  {customTaxonomy.map((t) => (
                    <option key={t.category} value={t.category}>{t.category}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {form.categoryGroup && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subcategory</label>
              <select
                value={form.categoryItem}
                onChange={(e) => setForm((p) => ({ ...p, categoryItem: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">— Select subcategory —</option>
                {subcategories.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Optional notes"
              className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="pending" checked={form.pending}
              onChange={(e) => setForm((p) => ({ ...p, pending: e.target.checked }))}
              className="rounded border-gray-300" />
            <label htmlFor="pending" className="text-sm text-gray-700">Mark as pending</label>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportModal({ accounts, onImported, onClose }: {
  accounts: Account[];
  onImported: () => void;
  onClose: () => void;
}) {
  const [selectedAccount, setSelectedAccount] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: { row: number; error: string }[] } | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "myfintech_transactions_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Please select a CSV file."); return; }
    if (!selectedAccount) { setError("Please select an account."); return; }
    const token = getToken();
    if (!token) return;

    setImporting(true); setError(""); setResult(null);
    try {
      const res = await importCsv(selectedAccount, file, token);
      setResult(res);
      if (res.imported > 0) onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-screen overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-lg">Import Transactions from CSV</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Template download */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-blue-800 mb-1">CSV Template</p>
                <p className="text-xs text-blue-700 mb-2">Download the template and fill it in. Required columns: <strong>date, description, amount</strong>.</p>
                <ul className="text-xs text-blue-600 space-y-0.5">
                  {CSV_NOTES.map((n, i) => <li key={i}>• {n}</li>)}
                </ul>
              </div>
              <button onClick={downloadTemplate}
                className="shrink-0 bg-blue-600 text-white text-xs px-3 py-2 rounded-lg hover:bg-blue-700 transition font-medium">
                ↓ Template
              </button>
            </div>
          </div>

          <form onSubmit={handleImport} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Import into Account <span className="text-red-500">*</span></label>
              {accounts.length === 0 ? (
                <p className="text-sm text-red-600">No accounts found. Add an account first.</p>
              ) : (
                <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.institution_name ? `${a.institution_name} — ` : ""}{a.name}{a.mask ? ` ••• ${a.mask}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CSV File <span className="text-red-500">*</span></label>
              <input type="file" accept=".csv" ref={fileRef}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(""); }}
                className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" />
              {file && <p className="text-xs text-gray-500 mt-1">Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}

            {result && (
              <div className={`rounded-lg p-3 text-sm ${result.imported > 0 ? "bg-green-50 border border-green-200" : "bg-yellow-50 border border-yellow-200"}`}>
                <p className={`font-semibold mb-1 ${result.imported > 0 ? "text-green-700" : "text-yellow-700"}`}>
                  {result.imported > 0 ? `✓ ${result.imported} transaction${result.imported !== 1 ? "s" : ""} imported` : "No transactions imported"}
                </p>
                {result.errors.length > 0 && (
                  <div>
                    <p className="text-yellow-700 font-medium mb-1">{result.errors.length} row{result.errors.length !== 1 ? "s" : ""} skipped:</p>
                    <ul className="text-xs space-y-0.5 text-yellow-800">
                      {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                {result?.imported ? "Close" : "Cancel"}
              </button>
              <button type="submit" disabled={importing || !file || accounts.length === 0}
                className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [showImport, setShowImport] = useState(false);
  // "Save as Rule" prompt state
  const [rulePrompt, setRulePrompt] = useState<{
    category: string; merchantHint: string; nameHint: string;
  } | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);

  const loadData = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    try {
      const [txns, accts, customCats] = await Promise.all([
        listAllTransactions(token, 300),
        listAccounts(token),
        listCustomCategories(token),
      ]);
      setTransactions(txns);
      setAccounts(accts);
      setCustomCategories(customCats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  // Build custom taxonomy from DB categories (parent → children)
  const customTaxonomy: { category: string; subcategories: string[] }[] = [];
  const parentCats = customCategories.filter((c) => !c.parent_id);
  for (const parent of parentCats) {
    const children = customCategories
      .filter((c) => c.parent_id === parent.id)
      .map((c) => c.name);
    customTaxonomy.push({ category: parent.name, subcategories: children });
  }

  const accountMap: Record<string, Account> = {};
  for (const a of accounts) accountMap[a.id] = a;

  const allCategories = [...TAXONOMY.map((t) => t.category), ...parentCats.map((c) => c.name)];

  const filtered = transactions.filter((t) => {
    const matchAccount = selectedAccount === "all" || t.account_id === selectedAccount;
    const matchCategory = selectedCategory === "all" ||
      (t.plaid_category ?? "").toLowerCase().startsWith(selectedCategory.toLowerCase());
    const q = search.toLowerCase();
    const matchSearch = !q ||
      t.name.toLowerCase().includes(q) ||
      (t.merchant_name ?? "").toLowerCase().includes(q) ||
      (t.plaid_category ?? "").toLowerCase().includes(q) ||
      (t.notes ?? "").toLowerCase().includes(q);
    return matchAccount && matchCategory && matchSearch;
  });

  const totalExpenses = filtered.filter((t) => parseFloat(t.amount) > 0 && !t.pending).reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalIncome = filtered.filter((t) => parseFloat(t.amount) < 0 && !t.pending).reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);

  function onTransactionSaved(updated: Transaction, newCategory: string | undefined, prevCategory: string | null) {
    setTransactions((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    setEditTxn(null);
    // Prompt to create a rule if category changed
    if (newCategory && newCategory !== prevCategory) {
      const txn = updated;
      setRulePrompt({
        category: newCategory,
        merchantHint: txn.merchant_name || "",
        nameHint: txn.name || "",
      });
    }
  }

  async function handleCreateRule(matchField: string, matchValue: string) {
    const token = getToken();
    if (!token || !rulePrompt) return;
    setRuleSaving(true);
    try {
      await createRule({
        name: `${rulePrompt.category} — ${matchValue}`,
        match_field: matchField,
        match_type: "contains",
        match_value: matchValue,
        category_string: rulePrompt.category,
      }, token);
    } finally {
      setRuleSaving(false);
      setRulePrompt(null);
    }
  }

  return (
    <div>
      {/* Save-as-Rule prompt banner */}
      {rulePrompt && (
        <div className="fixed bottom-6 right-6 z-50 bg-white border border-indigo-200 shadow-xl rounded-xl p-4 w-80">
          <div className="flex items-start justify-between mb-2">
            <p className="text-sm font-semibold text-gray-800">Create auto-categorization rule?</p>
            <button onClick={() => setRulePrompt(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2">✕</button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Category set to <span className="font-medium text-indigo-700">{rulePrompt.category}</span>. Save as a rule so future matching transactions are auto-categorized.
          </p>
          <div className="space-y-1.5">
            {rulePrompt.merchantHint && (
              <button
                onClick={() => handleCreateRule("merchant_name", rulePrompt.merchantHint)}
                disabled={ruleSaving}
                className="w-full text-left text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-800 px-3 py-2 rounded-lg border border-indigo-100 disabled:opacity-50"
              >
                Match merchant: <strong>"{rulePrompt.merchantHint}"</strong>
              </button>
            )}
            <button
              onClick={() => handleCreateRule("name", rulePrompt.nameHint.split(" ").slice(0, 3).join(" "))}
              disabled={ruleSaving}
              className="w-full text-left text-xs bg-gray-50 hover:bg-gray-100 text-gray-800 px-3 py-2 rounded-lg border border-gray-200 disabled:opacity-50"
            >
              Match description: <strong>"{rulePrompt.nameHint.split(" ").slice(0, 3).join(" ")}"</strong>
            </button>
            <button onClick={() => setRulePrompt(null)} className="w-full text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 text-center">
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {editTxn && (
        <EditModal
          txn={editTxn}
          accounts={accounts}
          customTaxonomy={customTaxonomy}
          onSave={onTransactionSaved}
          onClose={() => setEditTxn(null)}
        />
      )}
      {showImport && (
        <ImportModal
          accounts={accounts}
          onImported={loadData}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Transactions</h2>
        <button
          onClick={() => setShowImport(true)}
          className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-sm font-medium"
        >
          ↑ Import CSV
        </button>
      </div>

      {/* Summary strip */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Expenses</p>
            <p className="text-xl font-bold text-red-600">
              -{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalExpenses)}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Income</p>
            <p className="text-xl font-bold text-green-600">
              +{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalIncome)}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4 col-span-2 md:col-span-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Count</p>
            <p className="text-xl font-bold text-gray-900">{filtered.length}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name, merchant, category, or notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 md:w-52 bg-white"
        >
          <option value="all">All Categories</option>
          {TAXONOMY.map((t) => (
            <option key={t.category} value={t.category}>{t.category}</option>
          ))}
          {customTaxonomy.map((t) => (
            <option key={t.category} value={t.category}>{t.category}</option>
          ))}
        </select>
        <select
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 md:w-52 bg-white"
        >
          <option value="all">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{a.mask ? ` ••• ${a.mask}` : ""}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

      {/* Table */}
      <div className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Description</th>
              <th className="px-5 py-3 hidden md:table-cell">Category</th>
              <th className="px-5 py-3 hidden lg:table-cell">Account</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400">Loading transactions...</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  {transactions.length === 0
                    ? "No transactions yet. Link an account, import a CSV, or sync to pull transactions."
                    : "No transactions match your search."}
                </td>
              </tr>
            )}
            {!loading && filtered.map((txn) => {
              const acct = accountMap[txn.account_id];
              const { display, isExpense } = fmtAmt(txn.amount);

              return (
                <tr key={txn.id} className="hover:bg-gray-50 transition group">
                  <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {fmtDate(txn.date)}
                    {txn.pending && (
                      <span className="ml-1.5 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">Pending</span>
                    )}
                  </td>
                  <td className="px-5 py-3 max-w-xs">
                    <div className="text-sm font-medium text-gray-800 truncate">{txn.name}</div>
                    {txn.merchant_name && txn.merchant_name !== txn.name && (
                      <div className="text-xs text-gray-400 truncate">{txn.merchant_name}</div>
                    )}
                    {txn.notes && <div className="text-xs text-gray-400 italic truncate">{txn.notes}</div>}
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell">
                    {txn.plaid_category ? (() => {
                      const parts = parseCategory(txn.plaid_category);
                      return (
                        <div className="flex flex-col gap-0.5">
                          {parts.group && (
                            <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium w-fit">
                              {parts.group}
                            </span>
                          )}
                          {parts.item && (
                            <span className="text-xs text-gray-500 pl-1">{parts.item}</span>
                          )}
                          {!parts.group && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full w-fit">
                              {txn.plaid_category}
                            </span>
                          )}
                        </div>
                      );
                    })() : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 hidden lg:table-cell text-xs text-gray-600">
                    {acct ? `${acct.name}${acct.mask ? ` ••• ${acct.mask}` : ""}` : "—"}
                  </td>
                  <td className={`px-5 py-3 text-sm font-semibold text-right whitespace-nowrap ${isExpense ? "text-red-600" : "text-green-600"}`}>
                    {display}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => setEditTxn(txn)}
                      className="text-xs text-gray-400 hover:text-primary-600 opacity-0 group-hover:opacity-100 transition px-1"
                      title="Edit"
                    >
                      ✏
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Showing {filtered.length} of {transactions.length} transactions.
          {transactions.length >= 300 ? " Load more not yet supported — use filters to narrow down." : ""}
        </p>
      )}
    </div>
  );
}
