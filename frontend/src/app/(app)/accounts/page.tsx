"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  getLinkToken,
  exchangePublicToken,
  listPlaidItems,
  syncPlaidItem,
  listAccounts,
  createManualAccount,
  PlaidItem,
  Account,
  ManualAccountCreate,
} from "@/lib/api";

declare global {
  interface Window {
    Plaid: {
      create: (config: {
        token: string;
        onSuccess: (public_token: string, metadata: { institution?: { institution_id: string; name: string } }) => void;
        onExit: (err: unknown) => void;
      }) => { open: () => void; destroy: () => void };
    };
  }
}

const ACCOUNT_TYPES = [
  { value: "depository", label: "Bank Account (Checking / Savings)" },
  { value: "credit", label: "Credit Card" },
  { value: "investment", label: "Investment / Brokerage" },
  { value: "loan", label: "Loan / Mortgage" },
  { value: "other", label: "Other" },
];

const SUBTYPES: Record<string, { value: string; label: string }[]> = {
  depository: [
    { value: "checking", label: "Checking" },
    { value: "savings", label: "Savings" },
    { value: "cd", label: "CD / Certificate of Deposit" },
    { value: "money market", label: "Money Market" },
  ],
  credit: [
    { value: "credit card", label: "Credit Card" },
    { value: "paypal", label: "PayPal" },
  ],
  investment: [
    { value: "brokerage", label: "Brokerage" },
    { value: "401k", label: "401(k)" },
    { value: "ira", label: "IRA" },
    { value: "roth", label: "Roth IRA" },
  ],
  loan: [
    { value: "mortgage", label: "Mortgage" },
    { value: "auto", label: "Auto Loan" },
    { value: "student", label: "Student Loan" },
    { value: "personal", label: "Personal Loan" },
  ],
};

function fmt(value: string | number | null, currency = "USD"): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "number" ? value : parseFloat(value as string);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function typeColor(type: string): string {
  switch (type.toLowerCase()) {
    case "depository": return "bg-blue-100 text-blue-700";
    case "credit": return "bg-orange-100 text-orange-700";
    case "investment": return "bg-green-100 text-green-700";
    case "loan": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

function capitalize(s: string | null | undefined): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const DEFAULT_MANUAL: ManualAccountCreate = {
  name: "",
  institution_name: "",
  type: "depository",
  subtype: "checking",
  mask: "",
  current_balance: undefined,
  currency_code: "USD",
};

export default function AccountsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [plaidReady, setPlaidReady] = useState(false);
  const [plaidNotConfigured, setPlaidNotConfigured] = useState(false);

  // Manual account modal
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState<ManualAccountCreate>(DEFAULT_MANUAL);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState("");

  // Load Plaid Link script
  useEffect(() => {
    const existing = document.querySelector('script[src*="plaid.com/link"]');
    if (existing) { setPlaidReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => setPlaidReady(true);
    document.body.appendChild(script);
    return () => { if (document.body.contains(script)) document.body.removeChild(script); };
  }, []);

  const loadData = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    try {
      const [fetchedItems, fetchedAccounts] = await Promise.all([
        listPlaidItems(token),
        listAccounts(token),
      ]);
      setItems(fetchedItems);
      setAccounts(fetchedAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleLinkAccount() {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    if (!plaidReady || !window.Plaid) {
      setError("Plaid is still loading, please try again.");
      return;
    }
    setLinking(true); setError("");
    try {
      const { link_token } = await getLinkToken(token);
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            await exchangePublicToken(public_token, metadata.institution?.institution_id ?? null, metadata.institution?.name ?? null, token);
            await loadData();
          } catch (e) { setError(e instanceof Error ? e.message : "Failed to link account"); }
          finally { setLinking(false); }
        },
        onExit: () => { setLinking(false); },
      });
      handler.open();
    } catch (e) {
      setLinking(false);
      if (e instanceof Error && e.message.toLowerCase().includes("plaid not configured")) {
        setPlaidNotConfigured(true);
      } else {
        setError(e instanceof Error ? e.message : "Failed to open Plaid Link");
      }
    }
  }

  async function handleSync(itemId: string) {
    const token = getToken();
    if (!token) return;
    setSyncingId(itemId); setError("");
    try { await syncPlaidItem(itemId, token); await loadData(); }
    catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setSyncingId(null); }
  }

  async function handleCreateManual(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    if (!manualForm.name.trim()) { setManualError("Account name is required."); return; }

    setManualSaving(true); setManualError("");
    try {
      await createManualAccount({
        ...manualForm,
        mask: manualForm.mask?.trim() || undefined,
        institution_name: manualForm.institution_name?.trim() || undefined,
        subtype: manualForm.subtype || undefined,
        current_balance: manualForm.current_balance || undefined,
      }, token);
      setShowManual(false);
      setManualForm(DEFAULT_MANUAL);
      await loadData();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Failed to create account");
    } finally {
      setManualSaving(false);
    }
  }

  // Group Plaid accounts by plaid_item_id
  const plaidAccounts = accounts.filter((a) => !a.is_manual);
  const manualAccounts = accounts.filter((a) => a.is_manual);

  const accountsByItem: Record<string, Account[]> = {};
  for (const acct of plaidAccounts) {
    const key = acct.plaid_item_id ?? "unknown";
    if (!accountsByItem[key]) accountsByItem[key] = [];
    accountsByItem[key].push(acct);
  }

  const totalAssets = accounts
    .filter((a) => a.type === "depository" || a.type === "investment")
    .reduce((s, a) => s + (a.current_balance ? parseFloat(a.current_balance) : 0), 0);
  const totalLiabilities = accounts
    .filter((a) => a.type === "credit" || a.type === "loan")
    .reduce((s, a) => s + (a.current_balance ? parseFloat(a.current_balance) : 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  const subtypeOptions = SUBTYPES[manualForm.type] ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Accounts</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowManual(true); setManualError(""); }}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-sm font-medium"
          >
            + Add Manually
          </button>
          <button
            onClick={handleLinkAccount}
            disabled={linking}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition text-sm font-medium disabled:opacity-50"
          >
            {linking ? "Connecting..." : "🔗 Link via Plaid"}
          </button>
        </div>
      </div>

      {/* Manual Account Modal */}
      {showManual && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-lg">Add Account Manually</h3>
              <button onClick={() => setShowManual(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleCreateManual} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Name <span className="text-red-500">*</span></label>
                <input
                  type="text" required
                  value={manualForm.name}
                  onChange={(e) => setManualForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="My Checking Account"
                  className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Institution / Bank Name</label>
                <input
                  type="text"
                  value={manualForm.institution_name ?? ""}
                  onChange={(e) => setManualForm((p) => ({ ...p, institution_name: e.target.value }))}
                  placeholder="Chase, Bank of America, etc."
                  className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Type <span className="text-red-500">*</span></label>
                  <select
                    value={manualForm.type}
                    onChange={(e) => setManualForm((p) => ({ ...p, type: e.target.value, subtype: SUBTYPES[e.target.value]?.[0]?.value ?? "" }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subtype</label>
                  {subtypeOptions.length > 0 ? (
                    <select
                      value={manualForm.subtype ?? ""}
                      onChange={(e) => setManualForm((p) => ({ ...p, subtype: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {subtypeOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={manualForm.subtype ?? ""} onChange={(e) => setManualForm((p) => ({ ...p, subtype: e.target.value }))}
                      placeholder="e.g. savings" className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last 4 Digits</label>
                  <input
                    type="text" maxLength={4}
                    value={manualForm.mask ?? ""}
                    onChange={(e) => setManualForm((p) => ({ ...p, mask: e.target.value.replace(/\D/g, "") }))}
                    placeholder="1234"
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Balance</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number" min="0" step="any"
                      value={manualForm.current_balance ?? ""}
                      onChange={(e) => setManualForm((p) => ({ ...p, current_balance: e.target.value ? Number(e.target.value) : undefined }))}
                      placeholder="0.00"
                      className="border border-gray-300 rounded-lg pl-7 pr-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>

              {manualError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{manualError}</div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowManual(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">Cancel</button>
                <button type="submit" disabled={manualSaving}
                  className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50">
                  {manualSaving ? "Saving..." : "Add Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Plaid not configured banner */}
      {plaidNotConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-amber-800 mb-1">Plaid credentials not configured</p>
          <p className="text-sm text-amber-700 mb-2">Add to <code className="bg-amber-100 px-1 rounded">.env</code> and restart the API:</p>
          <pre className="text-xs bg-amber-100 rounded p-3 text-amber-900 overflow-x-auto">
{`PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_sandbox_secret
PLAID_ENV=sandbox`}
          </pre>
          <p className="text-xs text-amber-600 mt-2">Get free sandbox credentials at <strong>dashboard.plaid.com</strong> → Team Settings → Keys.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      {/* Summary cards */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Assets</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(totalAssets)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Liabilities</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(totalLiabilities)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 shadow p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Worth</p>
            <p className={`text-2xl font-bold ${netWorth >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(netWorth)}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-lg shadow border border-gray-100 p-12 text-center text-gray-400">Loading accounts...</div>
      )}

      {/* Empty state */}
      {!loading && accounts.length === 0 && !error && (
        <div className="bg-white rounded-lg shadow border border-gray-100">
          <div className="p-12 text-center text-gray-400">
            <div className="text-4xl mb-4">🏦</div>
            <p className="text-lg font-medium mb-2 text-gray-600">No accounts yet</p>
            <p className="text-sm mb-6">Link via Plaid to auto-import transactions, or add an account manually to track balances.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setShowManual(true)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium">+ Add Manually</button>
              <button onClick={handleLinkAccount} disabled={linking}
                className="bg-primary-600 text-white px-5 py-2 rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
                {linking ? "Connecting..." : "🔗 Link via Plaid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual accounts section */}
      {!loading && manualAccounts.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-100 mb-4">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h3 className="font-semibold text-gray-900">Manually Added Accounts</h3>
              <p className="text-xs text-gray-400 mt-0.5">Added manually — balances not auto-synced</p>
            </div>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">Manual</span>
          </div>
          <div className="divide-y divide-gray-50">
            {manualAccounts.map((acct) => (
              <AccountRow key={acct.id} acct={acct} />
            ))}
          </div>
        </div>
      )}

      {/* Plaid-linked institution cards */}
      {!loading && items.map((item) => {
        const itemAccounts = accountsByItem[item.id] ?? [];
        const isSyncing = syncingId === item.id;
        const lastSynced = item.last_synced_at
          ? new Date(item.last_synced_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : null;

        return (
          <div key={item.id} className="bg-white rounded-lg shadow border border-gray-100 mb-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{item.institution_name ?? "Bank"}</h3>
                  <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full font-medium">Via Plaid</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {lastSynced ? `Last synced ${lastSynced}` : "Not yet synced"}
                  {" · "}{item.account_count} account{item.account_count !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={() => handleSync(item.id)}
                disabled={isSyncing}
                className="text-xs text-primary-600 hover:text-primary-700 border border-primary-200 hover:border-primary-400 px-3 py-1.5 rounded-md transition disabled:opacity-50"
              >
                {isSyncing ? "Syncing..." : "↻ Sync"}
              </button>
            </div>

            {itemAccounts.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-400">No accounts found — click Sync to pull from this institution.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {itemAccounts.map((acct) => <AccountRow key={acct.id} acct={acct} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountRow({ acct }: { acct: Account }) {
  const addedDate = new Date(acct.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="flex items-center justify-between px-6 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{acct.name}</span>
          {acct.mask && <span className="text-xs text-gray-400">••• {acct.mask}</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            acct.type === "depository" ? "bg-blue-100 text-blue-700" :
            acct.type === "credit" ? "bg-orange-100 text-orange-700" :
            acct.type === "investment" ? "bg-green-100 text-green-700" :
            acct.type === "loan" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
          }`}>
            {capitalize(acct.subtype ?? acct.type)}
          </span>
          {acct.institution_name && acct.is_manual && (
            <span className="text-xs text-gray-500">{acct.institution_name}</span>
          )}
          <span className="text-xs text-gray-400">Added {addedDate}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-gray-900">
          {acct.current_balance !== null
            ? new Intl.NumberFormat("en-US", { style: "currency", currency: acct.currency_code, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parseFloat(acct.current_balance!))
            : "—"}
        </div>
        {acct.available_balance !== null && acct.available_balance !== acct.current_balance && (
          <div className="text-xs text-gray-400">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: acct.currency_code, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parseFloat(acct.available_balance!))} avail.
          </div>
        )}
      </div>
    </div>
  );
}
