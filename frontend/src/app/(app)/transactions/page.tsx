"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useRouter } from "next/navigation";
import {
  listAllTransactions,
  listAccounts,
  listCustomCategories,
  importCsv,
  updateTransaction,
  setTransactionSplits,
  clearTransactionSplits,
  createRule,
  listProperties,
  listUnits,
  listLeases,
  listUnitLeases,
  linkRentalPayment,
  unlinkRentalPayment,
  linkPropertyExpense,
  unlinkPropertyExpense,
  Account,
  Transaction,
  TransactionSplit,
  CustomCategory,
  Property,
  Unit,
  Lease,
  PropertyExpenseLink,
} from "@/lib/api";
import { useCurrency } from "@/lib/currency";

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

const PAGE_SIZE = 50;

const DATE_PRESETS = [
  { value: "all",          label: "All Time" },
  { value: "ytd",          label: "Year to Date" },
  { value: "this_month",   label: "This Month" },
  { value: "last_month",   label: "Last Month" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "last_90_days", label: "Last 90 Days" },
  { value: "last_6_months",label: "Last 6 Months" },
  { value: "last_year",    label: "Last Year" },
  { value: "custom",       label: "Custom Range…" },
];

function resolvePresetRange(preset: string): { from: Date | null; to: Date | null } {
  const now = new Date();
  switch (preset) {
    case "ytd":
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    case "this_month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    case "last_month": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from, to };
    }
    case "last_30_days": {
      const from = new Date(now); from.setDate(from.getDate() - 30);
      return { from, to: now };
    }
    case "last_90_days": {
      const from = new Date(now); from.setDate(from.getDate() - 90);
      return { from, to: now };
    }
    case "last_6_months": {
      const from = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      return { from, to: now };
    }
    case "last_year": {
      const y = now.getFullYear() - 1;
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59) };
    }
    default:
      return { from: null, to: null };
  }
}

function getPageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  if (current > 3) pages.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}


/** A single row in the split editor. */
type SplitLine = { id: string; amount: string; categoryGroup: string; categoryItem: string; notes: string };

function CategorySelect({ group, item, taxonomy, onGroupChange, onItemChange }: {
  group: string; item: string;
  taxonomy: { category: string; subcategories: string[] }[];
  onGroupChange: (g: string) => void;
  onItemChange: (i: string) => void;
}) {
  const subcategories = taxonomy.find((t) => t.category === group)?.subcategories ?? [];
  return (
    <div className="flex gap-1.5">
      <select title="Category" value={group} onChange={(e) => onGroupChange(e.target.value)}
        className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white flex-1 min-w-0">
        <option value="">— Category —</option>
        {taxonomy.map((t) => <option key={t.category} value={t.category}>{t.category}</option>)}
      </select>
      {group && (
        <select title="Subcategory" value={item} onChange={(e) => onItemChange(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white flex-1 min-w-0">
          <option value="">— Sub —</option>
          {subcategories.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
    </div>
  );
}

interface RentalLinkLine {
  id: string;
  propertyId: string;
  leaseId: string;
  amount: string;
}

interface PropertyExpLinkLine {
  id: string;
  propertyId: string;
  expenseCategory: string;
  amount: string;
  isCapex: boolean;
  notes: string;
}

// Categories that trigger the property expense link panel
const PROPERTY_EXPENSE_ITEMS = new Set([
  "Property Tax", "HOA Fees", "Home Insurance", "Maintenance & Repairs",
  "Home Improvement", "Lawn / Snow Care", "Cleaning Services",
]);

function isPropertyExpenseCategory(group: string, item: string): boolean {
  return PROPERTY_EXPENSE_ITEMS.has(item) ||
    group.toLowerCase() === "rental" ||
    (group === "Housing" && item !== "Mortgage / Rent" && item !== "Furnishings" && item !== "Security Systems") ||
    false;
}

function EditModal({ txn, accounts, customTaxonomy, properties, units, leases, onSave, onClose }: {
  txn: Transaction;
  accounts: Account[];
  customTaxonomy: { category: string; subcategories: string[] }[];
  properties: Property[];
  units: Unit[];
  leases: Lease[];
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

  // ── Rental link state ────────────────────────────────────────────────────────
  const isRentalIncomeCategory = (group: string, item: string) =>
    (group === "Income" && item === "Rental Income") ||
    group.toLowerCase() === "rental income";

  const initRentalLines = (): RentalLinkLine[] => {
    const abs = Math.abs(parseFloat(txn.amount));
    return [{ id: "rl-1", propertyId: "", leaseId: "", amount: abs.toFixed(2) }];
  };
  const [rentalLinks, setRentalLinks] = useState<RentalLinkLine[]>(initRentalLines);

  const rentalActive = isRentalIncomeCategory(form.categoryGroup, form.categoryItem) || txn.is_rental_income;
  const rentalTotal = rentalLinks.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const txnAbs2 = Math.abs(parseFloat(form.amount) || 0);
  const rentalRemaining = parseFloat((txnAbs2 - rentalTotal).toFixed(2));

  function updateRentalLine(id: string, field: keyof RentalLinkLine, value: string) {
    setRentalLinks((prev) => prev.map((l) =>
      l.id === id ? { ...l, [field]: value, ...(field === "propertyId" ? { leaseId: "" } : {}) } : l
    ));
  }

  function addRentalLine() {
    const rem = parseFloat((txnAbs2 - rentalTotal).toFixed(2));
    setRentalLinks((prev) => [...prev, {
      id: `rl-${Date.now()}`,
      propertyId: "", leaseId: "",
      amount: rem > 0 ? rem.toFixed(2) : "0.00",
    }]);
  }

  function removeRentalLine(id: string) {
    setRentalLinks((prev) => prev.filter((l) => l.id !== id));
  }

  // Filter leases for a given property (via unit)
  function leasesForProperty(propertyId: string): Lease[] {
    const unitIds = units.filter((u) => u.property_id === propertyId).map((u) => u.id);
    return leases.filter((l) => unitIds.includes(l.unit_id) && l.status === "active");
  }

  // ── Property expense link state ──────────────────────────────────────────────
  const initPropExpLines = (): PropertyExpLinkLine[] => {
    const abs = Math.abs(parseFloat(txn.amount));
    return [{ id: "pe-1", propertyId: properties.length === 1 ? properties[0].id : "", expenseCategory: "repair", amount: abs.toFixed(2), isCapex: false, notes: "" }];
  };
  const [propExpLinks, setPropExpLinks] = useState<PropertyExpLinkLine[]>(initPropExpLines);

  const propExpActive = isPropertyExpenseCategory(form.categoryGroup, form.categoryItem) || txn.is_property_expense;
  const propExpTotal = propExpLinks.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const propExpRemaining = parseFloat((Math.abs(parseFloat(form.amount) || 0) - propExpTotal).toFixed(2));

  function updatePropExpLine(id: string, field: keyof PropertyExpLinkLine, value: string | boolean) {
    setPropExpLinks((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value } : l));
  }

  function addPropExpLine() {
    const rem = parseFloat((Math.abs(parseFloat(form.amount) || 0) - propExpTotal).toFixed(2));
    setPropExpLinks((prev) => [...prev, {
      id: `pe-${Date.now()}`,
      propertyId: "", expenseCategory: "repair",
      amount: rem > 0 ? rem.toFixed(2) : "0.00",
      isCapex: false, notes: "",
    }]);
  }

  function removePropExpLine(id: string) {
    setPropExpLinks((prev) => prev.filter((l) => l.id !== id));
  }

  // ── Split state ──────────────────────────────────────────────────────────────
  const [splitActive, setSplitActive] = useState(txn.has_splits);
  const initSplitLines = (): SplitLine[] => {
    if (txn.has_splits && txn.splits.length >= 2) {
      return txn.splits.map((s) => {
        const p = parseCategory(s.category);
        return { id: s.id, amount: parseFloat(s.amount).toFixed(2), categoryGroup: p.group, categoryItem: p.item, notes: s.notes ?? "" };
      });
    }
    const abs = Math.abs(parseFloat(txn.amount));
    const half = (abs / 2).toFixed(2);
    const rest = (abs - parseFloat(half)).toFixed(2);
    return [
      { id: "new-1", amount: half, categoryGroup: parsed.group, categoryItem: parsed.item, notes: "" },
      { id: "new-2", amount: rest, categoryGroup: "", categoryItem: "", notes: "" },
    ];
  };
  const [splitLines, setSplitLines] = useState<SplitLine[]>(initSplitLines);

  const allTaxonomy = [...TAXONOMY, ...customTaxonomy];
  const subcategories = allTaxonomy.find((t) => t.category === form.categoryGroup)?.subcategories ?? [];

  function handleGroupChange(group: string) {
    setForm((p) => ({ ...p, categoryGroup: group, categoryItem: "" }));
  }

  // ── Split helpers ────────────────────────────────────────────────────────────
  const txnAbs = Math.abs(parseFloat(form.amount) || 0);
  const splitTotal = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const splitRemaining = parseFloat((txnAbs - splitTotal).toFixed(2));

  function updateSplitLine(id: string, field: keyof SplitLine, value: string) {
    setSplitLines((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value, ...(field === "categoryGroup" ? { categoryItem: "" } : {}) } : l));
  }

  function addSplitLine() {
    const remaining = parseFloat((txnAbs - splitTotal).toFixed(2));
    setSplitLines((prev) => [...prev, {
      id: `new-${Date.now()}`,
      amount: remaining > 0 ? remaining.toFixed(2) : "0.00",
      categoryGroup: "", categoryItem: "", notes: "",
    }]);
  }

  function removeSplitLine(id: string) {
    setSplitLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function handleCancelSplit() {
    setSaving(true); setError("");
    try {
      if (txn.has_splits) await clearTransactionSplits(txn.id);
      setSplitActive(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove splits");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    const amtNum = parseFloat(form.amount);
    if (isNaN(amtNum)) { setError("Amount must be a number"); return; }

    const plaid_category = form.categoryGroup && form.categoryItem
      ? `${form.categoryGroup} > ${form.categoryItem}`
      : form.categoryGroup || undefined;

    // Validate splits
    if (splitActive) {
      if (splitLines.length < 2) { setError("At least 2 split lines are required"); return; }
      if (Math.abs(splitRemaining) > 0.01) {
        setError(`Split amounts must total $${Math.abs(amtNum).toFixed(2)} (${splitRemaining > 0 ? `$${splitRemaining.toFixed(2)} remaining` : `$${Math.abs(splitRemaining).toFixed(2)} over`})`);
        return;
      }
      for (const l of splitLines) {
        if (!l.categoryGroup) { setError("All split lines must have a category"); return; }
      }
    }

    // Validate property expense links if applicable
    const savingPropExpLinks = propExpActive && !splitActive;
    if (savingPropExpLinks) {
      for (const l of propExpLinks) {
        if (!l.propertyId) { setError("All property expense assignments need a property selected"); return; }
        if (!(parseFloat(l.amount) > 0)) { setError("All property expense amounts must be greater than 0"); return; }
      }
      if (Math.abs(propExpRemaining) > 0.01) {
        setError(`Property expense amounts must total $${Math.abs(parseFloat(form.amount) || 0).toFixed(2)}`);
        return;
      }
    }

    // Validate rental links if applicable
    const savingRentalLinks = rentalActive && !splitActive;
    if (savingRentalLinks) {
      for (const l of rentalLinks) {
        if (!l.leaseId) { setError("All rental assignments need a lease selected"); return; }
        if (!(parseFloat(l.amount) > 0)) { setError("All rental amounts must be greater than 0"); return; }
      }
      if (Math.abs(rentalRemaining) > 0.01) {
        setError(`Rental amounts must total $${txnAbs2.toFixed(2)}`);
        return;
      }
    }

    setSaving(true); setError("");
    try {
      // Always save core transaction fields
      const updated = await updateTransaction(txn.id, {
        name: form.name || undefined,
        merchant_name: form.merchant_name || undefined,
        amount: amtNum,
        date: form.date ? new Date(form.date + "T00:00:00Z").toISOString() : undefined,
        plaid_category: splitActive ? undefined : plaid_category,
        notes: form.notes || undefined,
        pending: form.pending,
      });

      if (splitActive) {
        // Save splits — PUT replaces all existing splits
        await setTransactionSplits(txn.id, splitLines.map((l) => ({
          amount: parseFloat(l.amount),
          category: l.categoryGroup && l.categoryItem ? `${l.categoryGroup} > ${l.categoryItem}` : l.categoryGroup,
          notes: l.notes || undefined,
        })));
        // If was rental income or property expense, unlink (split takes over)
        if (txn.is_rental_income) await unlinkRentalPayment(txn.id).catch(() => {});
        if (txn.is_property_expense) await unlinkPropertyExpense(txn.id).catch(() => {});
        onSave({ ...updated, has_splits: true, splits: [] }, undefined, txn.plaid_category);
      } else {
        // Handle rental link save/remove
        if (savingRentalLinks && rentalLinks.some((l) => l.leaseId)) {
          await linkRentalPayment(txn.id, rentalLinks.map((l) => ({
            lease_id: l.leaseId,
            amount: parseFloat(l.amount),
          })));
        } else if (!rentalActive && txn.is_rental_income) {
          // Category was changed away from rental income — remove links
          await unlinkRentalPayment(txn.id).catch(() => {});
        }

        // Property expense links
        if (savingPropExpLinks && propExpLinks.some((l) => l.propertyId)) {
          await linkPropertyExpense(txn.id, propExpLinks.map((l) => ({
            property_id: l.propertyId,
            expense_category: l.expenseCategory,
            amount: parseFloat(l.amount),
            is_capex: l.isCapex,
            notes: l.notes || undefined,
          } as PropertyExpenseLink)));
        } else if (!propExpActive && txn.is_property_expense) {
          await unlinkPropertyExpense(txn.id).catch(() => {});
        }

        onSave(updated, plaid_category, txn.plaid_category);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const acct = accounts.find((a) => a.id === txn.account_id);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
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

          {/* Category (only shown when split is NOT active) */}
          {!splitActive && (
            <>
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
                    title="Subcategory"
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
            </>
          )}

          {/* ── Split Transaction section ──────────────────────────── */}
          <div className={`rounded-lg border ${splitActive ? "border-indigo-200 bg-indigo-50/40" : "border-gray-200"}`}>
            <button
              type="button"
              onClick={() => { if (!splitActive) setSplitActive(true); }}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium rounded-lg transition ${
                splitActive
                  ? "text-indigo-700 cursor-default"
                  : "text-gray-600 hover:text-indigo-700 hover:bg-indigo-50"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>✂</span>
                {splitActive ? `Split Transaction — Total $${Math.abs(parseFloat(form.amount) || 0).toFixed(2)}` : "Split this transaction…"}
              </span>
              {!splitActive && <span className="text-xs text-gray-400">Divide across categories</span>}
            </button>

            {splitActive && (
              <div className="px-4 pb-4 space-y-2">
                {/* Split rows */}
                {splitLines.map((line, idx) => (
                  <div key={line.id} className="flex gap-1.5 items-start">
                    <div className="relative w-24 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input
                        type="number" step="0.01" min="0.01"
                        title="Split amount"
                        value={line.amount}
                        onChange={(e) => updateSplitLine(line.id, "amount", e.target.value)}
                        className="border border-gray-200 rounded px-2 pl-5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CategorySelect
                        group={line.categoryGroup}
                        item={line.categoryItem}
                        taxonomy={allTaxonomy}
                        onGroupChange={(g) => updateSplitLine(line.id, "categoryGroup", g)}
                        onItemChange={(i) => updateSplitLine(line.id, "categoryItem", i)}
                      />
                    </div>
                    <input
                      type="text"
                      value={line.notes}
                      onChange={(e) => updateSplitLine(line.id, "notes", e.target.value)}
                      placeholder="Note"
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs w-24 shrink-0 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeSplitLine(line.id)}
                      disabled={splitLines.length <= 2}
                      className="text-gray-300 hover:text-red-400 text-sm px-1 py-1 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      title="Remove line"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* Footer row */}
                <div className="flex items-center justify-between pt-1">
                  <div className={`text-xs font-medium ${Math.abs(splitRemaining) <= 0.01 ? "text-green-600" : "text-red-500"}`}>
                    {Math.abs(splitRemaining) <= 0.01
                      ? "✓ Balanced"
                      : splitRemaining > 0
                        ? `$${splitRemaining.toFixed(2)} remaining`
                        : `$${Math.abs(splitRemaining).toFixed(2)} over`}
                  </div>
                  <button type="button" onClick={addSplitLine}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50">
                    + Add line
                  </button>
                </div>

                <button type="button" onClick={handleCancelSplit} disabled={saving}
                  className="text-xs text-gray-400 hover:text-red-500 mt-1 disabled:opacity-50">
                  ✕ Cancel split
                </button>
              </div>
            )}
          </div>

          {/* ── Rental Income Link section ──────────────────────────── */}
          {rentalActive && !splitActive && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-amber-600 text-sm">🏘️</span>
                <p className="text-sm font-semibold text-amber-800">Link to Rental Property</p>
                <span className="text-xs text-amber-600 ml-auto">Excluded from personal income</span>
              </div>
              <p className="text-xs text-amber-700">Assign this payment to a lease — it will appear in the Rentals page as a received payment.</p>

              {rentalLinks.map((line, idx) => {
                const propLeases = leasesForProperty(line.propertyId);
                const leaseUnit = (leaseId: string) => {
                  const lease = leases.find((l) => l.id === leaseId);
                  if (!lease) return "";
                  const unit = units.find((u) => u.id === lease.unit_id);
                  return unit ? unit.unit_label : "";
                };
                return (
                  <div key={line.id} className="flex flex-col gap-1.5">
                    {rentalLinks.length > 1 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-amber-700">Property {idx + 1}</span>
                        <button type="button" onClick={() => removeRentalLine(line.id)}
                          className="text-xs text-amber-400 hover:text-red-500">✕ Remove</button>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-amber-700 mb-0.5">Property</label>
                        <select
                          title="Property"
                          value={line.propertyId}
                          onChange={(e) => updateRentalLine(line.id, "propertyId", e.target.value)}
                          className="border border-amber-200 rounded-lg px-2 py-1.5 w-full text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        >
                          <option value="">— Select property —</option>
                          {properties.map((p) => (
                            <option key={p.id} value={p.id}>{p.address}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-amber-700 mb-0.5">Lease / Unit</label>
                        <select
                          title="Lease"
                          value={line.leaseId}
                          onChange={(e) => updateRentalLine(line.id, "leaseId", e.target.value)}
                          disabled={!line.propertyId || propLeases.length === 0}
                          className="border border-amber-200 rounded-lg px-2 py-1.5 w-full text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50"
                        >
                          <option value="">— Select lease —</option>
                          {propLeases.map((l) => (
                            <option key={l.id} value={l.id}>
                              {leaseUnit(l.id)} — ${parseFloat(l.monthly_rent).toFixed(0)}/mo
                            </option>
                          ))}
                        </select>
                        {line.propertyId && propLeases.length === 0 && (
                          <p className="text-[10px] text-amber-600 mt-0.5">No active leases for this property</p>
                        )}
                      </div>
                    </div>
                    {rentalLinks.length > 1 && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-amber-700 shrink-0">Amount ($)</label>
                        <div className="relative w-32">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                          <input type="number" step="0.01" min="0.01"
                            title="Amount"
                            value={line.amount}
                            onChange={(e) => updateRentalLine(line.id, "amount", e.target.value)}
                            className="border border-amber-200 rounded px-2 pl-5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-amber-400"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {rentalLinks.length > 1 && (
                <div className={`text-xs font-medium ${Math.abs(rentalRemaining) <= 0.01 ? "text-green-600" : "text-red-500"}`}>
                  {Math.abs(rentalRemaining) <= 0.01 ? "✓ Balanced" : `$${Math.abs(rentalRemaining).toFixed(2)} ${rentalRemaining > 0 ? "remaining" : "over"}`}
                </div>
              )}

              <button type="button" onClick={addRentalLine}
                className="text-xs text-amber-700 hover:text-amber-900 font-medium">
                + Split across another property
              </button>
            </div>
          )}

          {/* ── Property Expense Link section ──────────────────────────── */}
          {propExpActive && !splitActive && !rentalActive && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-teal-600 text-sm">🏠</span>
                <p className="text-sm font-semibold text-teal-800">Link to Property Expense</p>
                <span className="text-xs text-teal-600 ml-auto">Excluded from personal expenses</span>
              </div>
              <p className="text-xs text-teal-700">Assign this expense to a property — it will appear in the property&apos;s maintenance records.</p>

              {propExpLinks.map((line, idx) => (
                <div key={line.id} className="flex flex-col gap-1.5">
                  {propExpLinks.length > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-teal-700">Property {idx + 1}</span>
                      <button type="button" onClick={() => removePropExpLine(line.id)}
                        className="text-xs text-teal-400 hover:text-red-500">✕ Remove</button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-teal-700 mb-0.5">Property</label>
                      <select
                        title="Property"
                        value={line.propertyId}
                        onChange={(e) => updatePropExpLine(line.id, "propertyId", e.target.value)}
                        className="border border-teal-200 rounded-lg px-2 py-1.5 w-full text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-400"
                      >
                        <option value="">— Select property —</option>
                        {properties.map((p) => (
                          <option key={p.id} value={p.id}>{p.address}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-teal-700 mb-0.5">Expense Type</label>
                      <select
                        title="Expense category"
                        value={line.expenseCategory}
                        onChange={(e) => updatePropExpLine(line.id, "expenseCategory", e.target.value)}
                        className="border border-teal-200 rounded-lg px-2 py-1.5 w-full text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-400"
                      >
                        <option value="repair">Repair / Maintenance</option>
                        <option value="property_tax">Property Tax</option>
                        <option value="hoa">HOA</option>
                        <option value="insurance">Insurance</option>
                        <option value="utility">Utility</option>
                        <option value="appliance">Appliance</option>
                        <option value="landscaping">Landscaping / Lawn</option>
                        <option value="cleaning">Cleaning</option>
                        <option value="inspection">Inspection</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {propExpLinks.length > 1 && (
                      <div className="relative w-28 shrink-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                        <input type="number" step="0.01" min="0.01"
                          title="Amount"
                          value={line.amount}
                          onChange={(e) => updatePropExpLine(line.id, "amount", e.target.value)}
                          className="border border-teal-200 rounded px-2 pl-5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      </div>
                    )}
                    {!["property_tax", "hoa", "insurance"].includes(line.expenseCategory) && (
                      <label className="flex items-center gap-1.5 text-xs text-teal-700 cursor-pointer">
                        <input type="checkbox" checked={line.isCapex}
                          onChange={(e) => updatePropExpLine(line.id, "isCapex", e.target.checked)}
                          className="rounded border-teal-300" />
                        Capital improvement (CapEx)
                      </label>
                    )}
                  </div>
                  <input
                    type="text"
                    value={line.notes}
                    onChange={(e) => updatePropExpLine(line.id, "notes", e.target.value)}
                    placeholder="Vendor / notes (optional)"
                    className="border border-teal-200 rounded-lg px-2 py-1.5 w-full text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                </div>
              ))}

              {propExpLinks.length > 1 && (
                <div className={`text-xs font-medium ${Math.abs(propExpRemaining) <= 0.01 ? "text-green-600" : "text-red-500"}`}>
                  {Math.abs(propExpRemaining) <= 0.01 ? "✓ Balanced" : `$${Math.abs(propExpRemaining).toFixed(2)} ${propExpRemaining > 0 ? "remaining" : "over"}`}
                </div>
              )}

              <button type="button" onClick={addPropExpLine}
                className="text-xs text-teal-700 hover:text-teal-900 font-medium">
                + Split across another property
              </button>
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
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: { row: number; error: string }[] } | null>(null);
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

    setImporting(true); setError(""); setResult(null);
    try {
      const res = await importCsv(selectedAccount, file);
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
              <div className={`rounded-lg p-3 text-sm space-y-2 ${result.imported > 0 ? "bg-green-50 border border-green-200" : "bg-yellow-50 border border-yellow-200"}`}>
                <p className={`font-semibold ${result.imported > 0 ? "text-green-700" : "text-yellow-700"}`}>
                  {result.imported > 0
                    ? `✓ ${result.imported} transaction${result.imported !== 1 ? "s" : ""} imported`
                    : "No new transactions imported"}
                </p>
                {result.duplicates > 0 && (
                  <p className="text-blue-700 text-xs">
                    {result.duplicates} duplicate{result.duplicates !== 1 ? "s" : ""} skipped — already exist in this account.
                  </p>
                )}
                {result.errors.length > 0 && (
                  <div>
                    <p className="text-yellow-700 font-medium mb-1">{result.errors.length} row{result.errors.length !== 1 ? "s" : ""} had errors:</p>
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
  const { fmt, fmtDate, locale } = useCurrency();
  const router = useRouter();

  function fmtAmt(amount: string): { display: string; isExpense: boolean } {
    const n = parseFloat(amount);
    const abs = fmt(Math.abs(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { display: n > 0 ? `-${abs}` : `+${abs}`, isExpense: n > 0 };
  }
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showCharts, setShowCharts] = useState(true);
  const [showIgnored, setShowIgnored] = useState(false);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [rentalProperties, setRentalProperties] = useState<Property[]>([]);
  const [rentalUnits, setRentalUnits] = useState<Unit[]>([]);
  const [rentalLeases, setRentalLeases] = useState<Lease[]>([]);
  // "Save as Rule" prompt state
  const [rulePrompt, setRulePrompt] = useState<{
    category: string; merchantHint: string; nameHint: string;
  } | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [txns, accts, customCats] = await Promise.all([
        listAllTransactions(300),
        listAccounts(),
        listCustomCategories(),
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

  // Load rental properties/units/leases whenever the edit modal opens (needed for rental income + property expense panels)
  useEffect(() => {
    if (!editTxn || rentalProperties.length > 0) return;
    (async () => {
      try {
        const props = await listProperties();
        setRentalProperties(props);
        const allUnits = (await Promise.all(props.map((p) => listUnits(p.id)))).flat();
        setRentalUnits(allUnits);
        const allLeases = (await Promise.all(allUnits.map((u) => listUnitLeases(u.id).catch(() => [])))).flat();
        setRentalLeases(allLeases);
      } catch { /* silent — user will just see empty dropdowns */ }
    })();
  }, [editTxn]);

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

  // Resolve date range from preset or custom inputs
  const { from: presetFrom, to: presetTo } = datePreset !== "custom" ? resolvePresetRange(datePreset) : { from: null, to: null };
  const effectiveFrom = datePreset === "custom" ? (dateFrom ? new Date(dateFrom + "T00:00:00") : null) : presetFrom;
  const effectiveTo   = datePreset === "custom" ? (dateTo   ? new Date(dateTo   + "T23:59:59") : null) : presetTo;

  const filtered = transactions.filter((t) => {
    if (!showIgnored && t.is_ignored) return false;
    const matchAccount = selectedAccount === "all" || t.account_id === selectedAccount;
    const matchCategory = selectedCategory === "all" ||
      (t.plaid_category ?? "").toLowerCase().startsWith(selectedCategory.toLowerCase());
    const q = search.toLowerCase();
    const matchSearch = !q ||
      t.name.toLowerCase().includes(q) ||
      (t.merchant_name ?? "").toLowerCase().includes(q) ||
      (t.plaid_category ?? "").toLowerCase().includes(q) ||
      (t.notes ?? "").toLowerCase().includes(q);
    const txnDate = new Date(t.date);
    const matchDate =
      (!effectiveFrom || txnDate >= effectiveFrom) &&
      (!effectiveTo   || txnDate <= effectiveTo);
    return matchAccount && matchCategory && matchSearch && matchDate;
  });

  const totalExpenses = filtered.filter((t) => parseFloat(t.amount) > 0 && !t.pending && !t.is_transfer && !t.is_property_expense && !t.is_business).reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalIncome = filtered.filter((t) => parseFloat(t.amount) < 0 && !t.pending && !t.is_transfer && !t.is_rental_income && !t.is_business).reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);
  const netCashFlow = totalIncome - totalExpenses;

  // ── Chart data ──────────────────────────────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const months: Record<string, { key: string; label: string; expenses: number; income: number }> = {};
    for (const t of filtered) {
      if (t.pending || t.is_transfer || t.is_rental_income || t.is_property_expense || t.is_business) continue;
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString(locale, { month: "short", year: "2-digit" });
      if (!months[key]) months[key] = { key, label, expenses: 0, income: 0 };
      const amt = parseFloat(t.amount);
      if (amt > 0) months[key].expenses += amt;
      else months[key].income += Math.abs(amt);
    }
    return Object.values(months)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12);
  }, [filtered]);

  const categorySpend = useMemo(() => {
    const spend: Record<string, number> = {};
    for (const t of filtered) {
      const amt = parseFloat(t.amount);
      if (amt <= 0 || t.pending || t.is_transfer || t.is_business) continue;
      if (t.has_splits && t.splits.length > 0) {
        // Distribute per split line
        for (const s of t.splits) {
          const sAmt = parseFloat(s.amount);
          if (sAmt <= 0) continue;
          const cat = parseCategory(s.category).group || "Uncategorized";
          spend[cat] = (spend[cat] || 0) + sAmt;
        }
      } else {
        const cat = parseCategory(t.plaid_category).group || "Uncategorized";
        spend[cat] = (spend[cat] || 0) + amt;
      }
    }
    return Object.entries(spend)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, amount]) => ({ name, amount }));
  }, [filtered]);

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortField === "date") return mul * (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return mul * (parseFloat(a.amount) - parseFloat(b.amount));
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedTxns = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [search, selectedAccount, selectedCategory, datePreset, dateFrom, dateTo, showIgnored]);

  async function handleIgnoreTxn(txn: Transaction) {
    try {
      const updated = await updateTransaction(txn.id, { is_ignored: !txn.is_ignored });
      setTransactions((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    } catch {}
  }

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
    if (!rulePrompt) return;
    setRuleSaving(true);
    try {
      await createRule({
        name: `${rulePrompt.category} — ${matchValue}`,
        match_field: matchField,
        match_type: "contains",
        match_value: matchValue,
        category_string: rulePrompt.category,
      });
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
          properties={rentalProperties}
          units={rentalUnits}
          leases={rentalLeases}
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
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Transactions</h2>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">Track, categorize and analyze your spending</p>
        </div>
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="inline-flex items-center gap-2 border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          Import CSV
        </button>
      </div>

      {/* Summary strip */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-gradient-to-br from-red-50 to-white dark:from-red-950/40 dark:to-slate-800 rounded-xl border border-red-100 dark:border-red-900/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" /></svg>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">Expenses</p>
            </div>
            <p className="text-xl font-bold text-red-600 dark:text-red-400 tabular-nums">-{fmt(totalExpenses)}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Transfers & property expenses excluded</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-800 rounded-xl border border-emerald-100 dark:border-emerald-900/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" /></svg>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">Income</p>
            </div>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">+{fmt(totalIncome)}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Transfers excluded</p>
          </div>
          <div className={`bg-gradient-to-br ${netCashFlow >= 0 ? "from-blue-50 to-white dark:from-blue-950/40 dark:to-slate-800 border-blue-100 dark:border-blue-900/30" : "from-orange-50 to-white dark:from-orange-950/40 dark:to-slate-800 border-orange-100 dark:border-orange-900/30"} rounded-xl border p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${netCashFlow >= 0 ? "bg-blue-100 dark:bg-blue-900/50" : "bg-orange-100 dark:bg-orange-900/50"}`}>
                <svg className={`w-3.5 h-3.5 ${netCashFlow >= 0 ? "text-blue-500" : "text-orange-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">Net Flow</p>
            </div>
            <p className={`text-xl font-bold tabular-nums ${netCashFlow >= 0 ? "text-blue-600 dark:text-blue-400" : "text-orange-600 dark:text-orange-400"}`}>
              {netCashFlow >= 0 ? "+" : "-"}{fmt(Math.abs(netCashFlow))}
            </p>
          </div>
          <div className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-700/40 dark:to-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">Transactions</p>
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{filtered.length.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* ── Analytics ────────────────────────────────────────────── */}
      {filtered.length > 0 && monthlyTrend.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Analytics</p>
            <button
              type="button"
              onClick={() => setShowCharts((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition flex items-center gap-1"
            >
              {showCharts ? (
                <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>Hide</>
              ) : (
                <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>Show</>
              )}
            </button>
          </div>

          {showCharts && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

              {/* Monthly Cash Flow */}
              <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Monthly Cash Flow</p>
                    <p className="text-xs text-gray-400 mt-0.5">Income vs expenses over time</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />Income</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />Expenses</span>
                  </div>
                </div>
                {monthlyTrend.length === 0 ? (
                  <p className="text-xs text-gray-400 py-8 text-center">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={monthlyTrend} barSize={12} barCategoryGap="35%">
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "#9ca3af" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) =>
                          v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                        }
                        width={42}
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(v: number, name: string) => [
                          fmt(v),
                          name.charAt(0).toUpperCase() + name.slice(1),
                        ]}
                        contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                        cursor={{ fill: "rgba(0,0,0,0.03)" }}
                      />
                      <Bar dataKey="income"   name="income"   fill="#34d399" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expenses" name="expenses" fill="#fb7185" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Top Spending Categories */}
              <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Top Spending</p>
                  <p className="text-xs text-gray-400 mt-0.5">By category this period</p>
                </div>
                {categorySpend.length === 0 ? (
                  <p className="text-xs text-gray-400 py-8 text-center">No expense data</p>
                ) : (
                  <div className="space-y-3">
                    {categorySpend.map(({ name, amount }, idx) => {
                      const pct = Math.round((amount / totalExpenses) * 100);
                      const barPct = Math.round((amount / categorySpend[0].amount) * 100);
                      const barColors = [
                        "bg-gradient-to-r from-indigo-400 to-indigo-500",
                        "bg-gradient-to-r from-violet-400 to-violet-500",
                        "bg-gradient-to-r from-blue-400 to-blue-500",
                        "bg-gradient-to-r from-sky-400 to-sky-500",
                        "bg-gradient-to-r from-teal-400 to-teal-500",
                        "bg-gradient-to-r from-cyan-400 to-cyan-500",
                      ];
                      return (
                        <div key={name} className="group">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="w-4 h-4 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">{name}</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">{pct}%</span>
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0 tabular-nums ml-1">{fmt(amount)}</span>
                          </div>
                          <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden ml-6">
                            <div
                              className={`h-full ${barColors[idx % barColors.length]} rounded-full transition-all duration-700 ease-out`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-50/80 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-700 p-3 mb-4">
        <div className="flex flex-col md:flex-row gap-2.5 mb-2.5">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              placeholder="Search by name, merchant, category, or notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 dark:border-slate-600 rounded-lg pl-9 pr-4 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-slate-800 dark:text-gray-200 dark:placeholder-gray-500"
            />
          </div>
          <select
            title="Date range"
            value={datePreset}
            onChange={(e) => { setDatePreset(e.target.value); setDateFrom(""); setDateTo(""); }}
            className="border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 md:w-44 bg-white dark:bg-slate-800 dark:text-gray-200"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col md:flex-row gap-2.5">
          <select
            title="Filter by category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 md:w-52 bg-white dark:bg-slate-800 dark:text-gray-200"
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
            title="Filter by account"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 md:w-52 bg-white dark:bg-slate-800 dark:text-gray-200"
          >
            <option value="all">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.mask ? ` ••• ${a.mask}` : ""}
              </option>
            ))}
          </select>
          {datePreset === "custom" && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">From</label>
                <input type="date" title="Start date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-slate-800 dark:text-gray-200" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">To</label>
                <input type="date" title="End date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-slate-800 dark:text-gray-200" />
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowIgnored((v) => !v)}
            className={`text-xs px-3 py-2 rounded-lg border transition whitespace-nowrap ${
              showIgnored
                ? "bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400"
                : "border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-slate-700"
            }`}
            title={showIgnored ? "Hide ignored transactions" : "Show ignored transactions"}
          >
            {showIgnored ? "Hide Ignored" : "Show Ignored"}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/80 text-left">
              <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider">
                <button type="button" onClick={() => { if (sortField === "date") setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortField("date"); setSortDir("desc"); } setPage(1); }}
                  className="flex items-center gap-1 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                  Date {sortField === "date" ? (sortDir === "desc" ? "↓" : "↑") : <span className="opacity-30">↕</span>}
                </button>
              </th>
              <th className="px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Description</th>
              <th className="px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hidden md:table-cell">Category</th>
              <th className="px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hidden lg:table-cell">Account</th>
              <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-right">
                <button type="button" onClick={() => { if (sortField === "amount") setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortField("amount"); setSortDir("desc"); } setPage(1); }}
                  className="flex items-center gap-1 ml-auto text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                  Amount {sortField === "amount" ? (sortDir === "desc" ? "↓" : "↑") : <span className="opacity-30">↕</span>}
                </button>
              </th>
              <th className="px-5 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {loading && (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400 dark:text-gray-500">Loading transactions...</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                  {transactions.length === 0
                    ? "No transactions yet. Link an account, import a CSV, or sync to pull transactions."
                    : "No transactions match your search."}
                </td>
              </tr>
            )}
            {!loading && paginatedTxns.map((txn) => {
              const acct = txn.account_id ? accountMap[txn.account_id] : undefined;
              const { display, isExpense } = fmtAmt(txn.amount);

              return (
                <tr key={txn.id} className={`hover:bg-gray-50/80 dark:hover:bg-slate-700/40 transition group ${txn.is_ignored ? "opacity-40" : ""}`}>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{fmtDate(txn.date)}</span>
                    {txn.pending && (
                      <span className="ml-1.5 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">Pending</span>
                    )}
                    {txn.is_transfer && (
                      <span className="ml-1.5 text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full font-medium">Transfer</span>
                    )}
                    {txn.is_rental_income && (
                      <span className="ml-1.5 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">🏘️ Rental</span>
                    )}
                    {txn.is_property_expense && (
                      <span className="ml-1.5 text-[10px] bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full font-medium">🏠 Property</span>
                    )}
                    {txn.is_business && (
                      <span className="ml-1.5 text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded-full font-medium">🏢 Business</span>
                    )}
                    {txn.is_ignored && (
                      <span className="ml-1.5 text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full font-medium">Ignored</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 max-w-xs">
                    <div className={`text-sm font-medium text-gray-800 dark:text-gray-200 truncate ${txn.is_ignored ? "line-through" : ""}`}>{txn.name}</div>
                    {txn.merchant_name && txn.merchant_name !== txn.name && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{txn.merchant_name}</div>
                    )}
                    {txn.notes && <div className="text-xs text-gray-400 dark:text-gray-500 italic truncate">{txn.notes}</div>}
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    {txn.has_splits && txn.splits.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full font-medium w-fit">✂ Split</span>
                        {txn.splits.slice(0, 2).map((s) => {
                          const p = parseCategory(s.category);
                          return (
                            <span key={s.id} className="text-xs text-gray-500 dark:text-gray-400 pl-1 truncate max-w-[160px]">
                              {p.group || s.category} — ${parseFloat(s.amount).toFixed(2)}
                            </span>
                          );
                        })}
                        {txn.splits.length > 2 && (
                          <span className="text-xs text-gray-400 pl-1">+{txn.splits.length - 2} more</span>
                        )}
                      </div>
                    ) : txn.plaid_category ? (() => {
                      const parts = parseCategory(txn.plaid_category);
                      return (
                        <div className="flex flex-col gap-0.5">
                          {parts.group && (
                            <span className="text-[11px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-full font-semibold w-fit">
                              {parts.group}
                            </span>
                          )}
                          {parts.item && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 pl-1">{parts.item}</span>
                          )}
                          {!parts.group && (
                            <span className="text-[11px] bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full w-fit">
                              {txn.plaid_category}
                            </span>
                          )}
                        </div>
                      );
                    })() : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell text-xs text-gray-500 dark:text-gray-400">
                    {acct ? `${acct.name}${acct.mask ? ` ••• ${acct.mask}` : ""}` : "—"}
                  </td>
                  <td className={`px-5 py-3.5 text-sm font-bold text-right whitespace-nowrap tabular-nums ${isExpense ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {display}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={() => setEditTxn(txn)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
                        title="Edit"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleIgnoreTxn(txn)}
                        className={`w-6 h-6 rounded-md flex items-center justify-center transition ${txn.is_ignored ? "text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30" : "text-gray-300 dark:text-gray-600 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30"}`}
                        title={txn.is_ignored ? "Un-ignore" : "Ignore"}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-5">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Page {safePage} of {totalPages} — <span className="font-medium text-gray-600 dark:text-gray-400">{filtered.length.toLocaleString()}</span> transactions
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-default transition"
            >
              ← Prev
            </button>
            {getPageNumbers(safePage, totalPages).map((pg, i) =>
              pg === "…" ? (
                <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm select-none">…</span>
              ) : (
                <button
                  type="button"
                  key={pg}
                  onClick={() => setPage(pg as number)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                    safePage === pg
                      ? "bg-indigo-600 text-white border-indigo-600 font-semibold shadow-sm"
                      : "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {pg}
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-default transition"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {filtered.length > 0 && totalPages === 1 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
          {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
