"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  listAllTransactions,
  listAccounts,
  Account,
  Transaction,
} from "@/lib/api";

function fmt(value: string): string {
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(abs);
  // In Plaid: positive = debit (expense), negative = credit (income)
  return n > 0 ? `-${formatted}` : `+${formatted}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("all");

  const loadData = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    try {
      const [txns, accts] = await Promise.all([
        listAllTransactions(token, 200),
        listAccounts(token),
      ]);
      setTransactions(txns);
      setAccounts(accts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  const accountMap: Record<string, Account> = {};
  for (const a of accounts) accountMap[a.id] = a;

  const filtered = transactions.filter((t) => {
    const matchAccount = selectedAccount === "all" || t.account_id === selectedAccount;
    const q = search.toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) ||
      (t.merchant_name ?? "").toLowerCase().includes(q) ||
      (t.plaid_category ?? "").toLowerCase().includes(q);
    return matchAccount && matchSearch;
  });

  // Income vs expense totals (for filtered set)
  const totalExpenses = filtered
    .filter((t) => parseFloat(t.amount) > 0 && !t.pending)
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalIncome = filtered
    .filter((t) => parseFloat(t.amount) < 0 && !t.pending)
    .reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Transactions</h2>

      {/* Summary strip */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Expenses</p>
            <p className="text-xl font-bold text-red-600">
              -{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalExpenses)}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Income</p>
            <p className="text-xl font-bold text-green-600">
              +{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalIncome)}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4 col-span-2 md:col-span-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Transactions</p>
            <p className="text-xl font-bold text-gray-900">{filtered.length}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search transactions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 md:w-56"
        >
          <option value="all">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{a.mask ? ` ••• ${a.mask}` : ""}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Transactions table */}
      <div className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-6 py-3">Date</th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3 hidden md:table-cell">Category</th>
              <th className="px-6 py-3 hidden md:table-cell">Account</th>
              <th className="px-6 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                  Loading transactions...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                  {transactions.length === 0
                    ? "No transactions yet. Link an account and sync to see transactions."
                    : "No transactions match your search."}
                </td>
              </tr>
            )}
            {!loading && filtered.map((txn) => {
              const acct = accountMap[txn.account_id];
              const amount = parseFloat(txn.amount);
              const isExpense = amount > 0;
              const displayAmt = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
              }).format(Math.abs(amount));

              return (
                <tr key={txn.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {fmtDate(txn.date)}
                    {txn.pending && (
                      <span className="ml-1.5 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <div className="text-sm font-medium text-gray-800">{txn.name}</div>
                    {txn.merchant_name && txn.merchant_name !== txn.name && (
                      <div className="text-xs text-gray-400">{txn.merchant_name}</div>
                    )}
                  </td>
                  <td className="px-6 py-3 hidden md:table-cell">
                    {txn.plaid_category ? (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                        {txn.plaid_category.split(", ").pop()}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3 hidden md:table-cell">
                    {acct ? (
                      <span className="text-xs text-gray-600">
                        {acct.name}{acct.mask ? ` ••• ${acct.mask}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className={`px-6 py-3 text-sm font-semibold text-right ${isExpense ? "text-red-600" : "text-green-600"}`}>
                    {isExpense ? `-${displayAmt}` : `+${displayAmt}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Showing {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}.{" "}
          {transactions.length > filtered.length ? `${transactions.length - filtered.length} hidden by filter.` : ""}
          {" "}Go to Accounts → Sync to refresh.
        </p>
      )}
    </div>
  );
}
