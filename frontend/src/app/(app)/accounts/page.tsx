"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getLinkToken,
  exchangePublicToken,
  listPlaidItems,
  syncPlaidItem,
  deletePlaidItem,
  listAccounts,
  createManualAccount,
  updateAccount,
  deleteAccount,
  listHouseholdMembers,
  listBusinessEntities,
  getSnapTradeConnectUrl,
  listSnapTradeConnections,
  syncSnapTradeAuthorizations,
  syncSnapTradeConnection,
  deleteSnapTradeConnection,
  PlaidItem,
  Account,
  AccountUpdate,
  ManualAccountCreate,
  UserResponse,
  SnapTradeConnection,
  BusinessEntityResponse,
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

function capitalize(s: string | null | undefined): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const DEFAULT_MANUAL: ManualAccountCreate = {
  owner_user_id: null,
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
  const searchParams = useSearchParams();
  const snapSyncedRef = useRef(false);

  const [items, setItems] = useState<PlaidItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<UserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [plaidReady, setPlaidReady] = useState(false);
  const [plaidNotConfigured, setPlaidNotConfigured] = useState(false);

  // SnapTrade state
  const [snapConnections, setSnapConnections] = useState<SnapTradeConnection[]>([]);
  const [snapConnecting, setSnapConnecting] = useState(false);
  const [syncingSnapId, setSyncingSnapId] = useState<string | null>(null);
  const [snapError, setSnapError] = useState("");

  // Manual account modal
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState<ManualAccountCreate>(DEFAULT_MANUAL);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState("");

  // Delete account state
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Edit account state
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<AccountUpdate>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Business entities (for account linking)
  const [entities, setEntities] = useState<BusinessEntityResponse[]>([]);

  // Delete institution (Plaid item) state
  const [deleteItemTarget, setDeleteItemTarget] = useState<PlaidItem | null>(null);
  const [deleteItemSaving, setDeleteItemSaving] = useState(false);
  const [deleteItemError, setDeleteItemError] = useState("");

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
    try {
      const [fetchedItems, fetchedAccounts, fetchedMembers, fetchedSnapConns] = await Promise.all([
        listPlaidItems(),
        listAccounts(),
        listHouseholdMembers(),
        listSnapTradeConnections().catch(() => [] as SnapTradeConnection[]),
      ]);
      setItems(fetchedItems);
      setAccounts(fetchedAccounts);
      setMembers(fetchedMembers);
      setSnapConnections(fetchedSnapConns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { listBusinessEntities().then(setEntities).catch(() => {}); }, []);

  async function handleLinkAccount() {
    if (!plaidReady || !window.Plaid) {
      setError("Plaid is still loading, please try again.");
      return;
    }
    setLinking(true); setError("");
    try {
      const { link_token } = await getLinkToken();
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            await exchangePublicToken(public_token, metadata.institution?.institution_id ?? null, metadata.institution?.name ?? null);
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
    setSyncingId(itemId); setError("");
    try { await syncPlaidItem(itemId); await loadData(); }
    catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setSyncingId(null); }
  }

  async function handleCreateManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manualForm.name.trim()) { setManualError("Account name is required."); return; }

    setManualSaving(true); setManualError("");
    try {
      await createManualAccount({
        ...manualForm,
        mask: manualForm.mask?.trim() || undefined,
        institution_name: manualForm.institution_name?.trim() || undefined,
        subtype: manualForm.subtype || undefined,
        current_balance: manualForm.current_balance || undefined,
      });
      setShowManual(false);
      setManualForm(DEFAULT_MANUAL);
      await loadData();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Failed to create account");
    } finally {
      setManualSaving(false);
    }
  }

  function openEdit(acct: Account) {
    setEditTarget(acct);
    setEditError("");
    setEditForm({
      owner_user_id: acct.owner_user_id ?? null,
      name: acct.name,
      institution_name: acct.institution_name ?? undefined,
      type: acct.type,
      subtype: acct.subtype ?? undefined,
      mask: acct.mask ?? undefined,
      current_balance: acct.current_balance !== null ? parseFloat(acct.current_balance!) : undefined,
      is_hidden: acct.is_hidden,
      entity_id: acct.entity_id ?? null,
      account_scope: acct.account_scope ?? "personal",
    });
  }

  async function handleEditAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true); setEditError("");
    try {
      const updated = await updateAccount(editTarget.id, editForm);
      setAccounts((prev) => prev.map((a) => a.id === updated.id ? updated : a));
      setEditTarget(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteItem(withTransactions: boolean) {
    if (!deleteItemTarget) return;
    setDeleteItemSaving(true); setDeleteItemError("");
    try {
      await deletePlaidItem(deleteItemTarget.id, withTransactions);
      setDeleteItemTarget(null);
      await loadData();
    } catch (e) {
      setDeleteItemError(e instanceof Error ? e.message : "Failed to disconnect institution");
    } finally {
      setDeleteItemSaving(false);
    }
  }

  async function handleDeleteAccount(withTransactions: boolean) {
    if (!deleteTarget) return;
    setDeleteSaving(true); setDeleteError("");
    try {
      await deleteAccount(deleteTarget.id, withTransactions);
      setDeleteTarget(null);
      await loadData();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete account");
    } finally {
      setDeleteSaving(false);
    }
  }

  // SnapTrade handlers
  async function handleConnectSnapTrade() {
    setSnapConnecting(true); setSnapError("");
    try {
      const { redirect_url } = await getSnapTradeConnectUrl();
      window.open(redirect_url, "_blank");
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "Failed to open SnapTrade portal");
    } finally {
      setSnapConnecting(false);
    }
  }

  async function handleSyncSnapAuth() {
    setSnapError("");
    try {
      const conns = await syncSnapTradeAuthorizations();
      setSnapConnections(conns);
      await loadData();
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "SnapTrade sync failed");
    }
  }

  async function handleSyncSnapConnection(connId: string) {
    setSyncingSnapId(connId); setSnapError("");
    try {
      await syncSnapTradeConnection(connId);
      await loadData();
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingSnapId(null);
    }
  }

  async function handleDisconnectSnap(connId: string) {
    if (!window.confirm("Disconnect this brokerage? Accounts will remain but will no longer sync.")) return;
    setSnapError("");
    try {
      await deleteSnapTradeConnection(connId);
      await loadData();
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "Disconnect failed");
    }
  }

  // Detect ?snaptrade_connected=1 redirect and auto-sync authorizations
  useEffect(() => {
    if (searchParams?.get("snaptrade_connected") === "1" && !snapSyncedRef.current) {
      snapSyncedRef.current = true;
      handleSyncSnapAuth();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Group Plaid accounts by plaid_item_id
  const plaidAccounts = accounts.filter((a) => !a.is_manual && !a.snaptrade_connection_id);
  const manualAccounts = accounts.filter((a) => a.is_manual && !a.snaptrade_connection_id);

  const accountsByItem: Record<string, Account[]> = {};
  for (const acct of plaidAccounts) {
    const key = acct.plaid_item_id ?? "unknown";
    if (!accountsByItem[key]) accountsByItem[key] = [];
    accountsByItem[key].push(acct);
  }

  const subtypeOptions = SUBTYPES[manualForm.type] ?? [];

  // ── Summary buckets ────────────────────────────────────────────────────────
  function sumBal(list: Account[]) {
    return list.reduce((s, a) => s + (a.current_balance ? parseFloat(a.current_balance) : 0), 0);
  }
  function fmtK(n: number) {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(n);
  }

  const visibleAccounts = accounts.filter((a) => !a.is_hidden);
  const CHECKING_SUBTYPES = new Set(["checking", "prepaid"]);
  const SAVINGS_SUBTYPES  = new Set(["savings", "cd", "money market", "cash management"]);

  const checkingAccounts   = visibleAccounts.filter((a) => a.type === "depository" && CHECKING_SUBTYPES.has((a.subtype ?? "").toLowerCase()));
  const savingsAccounts    = visibleAccounts.filter((a) => a.type === "depository" && SAVINGS_SUBTYPES.has((a.subtype ?? "").toLowerCase()));
  const otherDepository    = visibleAccounts.filter((a) => a.type === "depository" && !CHECKING_SUBTYPES.has((a.subtype ?? "").toLowerCase()) && !SAVINGS_SUBTYPES.has((a.subtype ?? "").toLowerCase()));
  const creditAccounts     = visibleAccounts.filter((a) => a.type === "credit");
  const investmentAccounts = visibleAccounts.filter((a) => a.type === "investment");
  const loanAccounts       = visibleAccounts.filter((a) => a.type === "loan");

  const totalChecking   = sumBal(checkingAccounts);
  const totalSavings    = sumBal(savingsAccounts);
  const totalCards      = sumBal(creditAccounts);
  const totalInvest     = sumBal(investmentAccounts);
  const totalLoans      = sumBal(loanAccounts);
  const totalOtherDep   = sumBal(otherDepository);
  const netCash         = totalChecking + totalSavings + totalOtherDep - totalCards;

  const summaryBuckets = [
    ...(checkingAccounts.length   > 0 ? [{ label: "Checking",   amount: totalChecking,  count: checkingAccounts.length,   color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-100",  icon: "🏧" }] : []),
    ...(savingsAccounts.length    > 0 ? [{ label: "Savings",    amount: totalSavings,   count: savingsAccounts.length,    color: "text-teal-700",   bg: "bg-teal-50",   border: "border-teal-100",  icon: "🏦" }] : []),
    ...(otherDepository.length    > 0 ? [{ label: "Other Bank", amount: totalOtherDep,  count: otherDepository.length,    color: "text-sky-700",    bg: "bg-sky-50",    border: "border-sky-100",   icon: "🏛️" }] : []),
    ...(creditAccounts.length     > 0 ? [{ label: "Card Balances", amount: -totalCards, count: creditAccounts.length,    color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-100", icon: "💳", debt: true }] : []),
    ...(investmentAccounts.length > 0 ? [{ label: "Investments", amount: totalInvest,  count: investmentAccounts.length, color: "text-green-700",  bg: "bg-green-50",  border: "border-green-100", icon: "📈" }] : []),
    ...(loanAccounts.length       > 0 ? [{ label: "Loans",      amount: -totalLoans,   count: loanAccounts.length,       color: "text-red-700",    bg: "bg-red-50",    border: "border-red-100",   icon: "📋", debt: true }] : []),
    { label: "Net Cash", amount: netCash, count: null, color: netCash >= 0 ? "text-gray-900" : "text-red-700", bg: "bg-gray-900", border: "border-gray-800", icon: "💰", netCard: true },
  ] as const;

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
          <button
            onClick={handleConnectSnapTrade}
            disabled={snapConnecting}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
          >
            {snapConnecting ? "Opening..." : "📊 Connect Brokerage"}
          </button>
        </div>
      </div>

      {/* SnapTrade error */}
      {snapError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {snapError}
        </div>
      )}

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

              {members.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Owner</label>
                  <select
                    value={manualForm.owner_user_id ?? ""}
                    onChange={(e) => setManualForm((p) => ({ ...p, owner_user_id: e.target.value || null }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="">— Household (shared) —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

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

      {/* Edit Account Modal */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-lg">Edit Account</h3>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleEditAccount} className="p-5 space-y-4">
              {/* Name — always editable */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Name <span className="text-red-500">*</span></label>
                <input
                  type="text" required
                  value={editForm.name ?? ""}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Institution name — always shown (Plaid accounts use it for display) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Institution / Bank Name</label>
                <input
                  type="text"
                  value={editForm.institution_name ?? ""}
                  onChange={(e) => setEditForm((p) => ({ ...p, institution_name: e.target.value || undefined }))}
                  placeholder={editTarget.is_manual ? "Chase, Bank of America…" : editTarget.institution_name ?? ""}
                  className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Owner — shown when household has multiple members */}
              {members.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Owner</label>
                  <select
                    value={editForm.owner_user_id ?? ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, owner_user_id: e.target.value || null }))}
                    className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="">— Household (shared) —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Type + Subtype — only for manual accounts */}
              {editTarget.is_manual && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                    <select
                      value={editForm.type ?? ""}
                      onChange={(e) => setEditForm((p) => ({ ...p, type: e.target.value, subtype: SUBTYPES[e.target.value]?.[0]?.value ?? "" }))}
                      className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subtype</label>
                    {(SUBTYPES[editForm.type ?? ""] ?? []).length > 0 ? (
                      <select
                        value={editForm.subtype ?? ""}
                        onChange={(e) => setEditForm((p) => ({ ...p, subtype: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {(SUBTYPES[editForm.type ?? ""] ?? []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={editForm.subtype ?? ""}
                        onChange={(e) => setEditForm((p) => ({ ...p, subtype: e.target.value }))}
                        placeholder="e.g. savings"
                        className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    )}
                  </div>
                </div>
              )}

              {/* Mask + Balance */}
              <div className="grid grid-cols-2 gap-3">
                {editTarget.is_manual && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last 4 Digits</label>
                    <input
                      type="text" maxLength={4}
                      value={editForm.mask ?? ""}
                      onChange={(e) => setEditForm((p) => ({ ...p, mask: e.target.value.replace(/\D/g, "") }))}
                      placeholder="1234"
                      className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}
                <div className={editTarget.is_manual ? "" : "col-span-2"}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {editTarget.is_manual ? "Current Balance" : "Balance Override"}
                    {!editTarget.is_manual && (
                      <span className="text-xs text-gray-400 ml-1">(optional — overrides Plaid balance)</span>
                    )}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number" min="0" step="any"
                      value={editForm.current_balance ?? ""}
                      onChange={(e) => setEditForm((p) => ({ ...p, current_balance: e.target.value ? Number(e.target.value) : undefined }))}
                      placeholder="0.00"
                      className="border border-gray-300 rounded-lg pl-7 pr-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>

              {/* Business entity + scope */}
              {entities.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="acct-entity-select" className="block text-sm font-medium text-gray-700 mb-1">
                      Business Entity
                    </label>
                    <select
                      id="acct-entity-select"
                      value={editForm.entity_id ?? ""}
                      onChange={(e) => setEditForm((p) => ({ ...p, entity_id: e.target.value || null }))}
                      className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                      <option value="">— Personal —</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="acct-scope-select" className="block text-sm font-medium text-gray-700 mb-1">
                      Account Scope
                    </label>
                    <select
                      id="acct-scope-select"
                      value={editForm.account_scope ?? "personal"}
                      onChange={(e) => setEditForm((p) => ({ ...p, account_scope: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                      <option value="personal">Personal</option>
                      <option value="business">Business</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Hidden toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.is_hidden ?? false}
                  onChange={(e) => setEditForm((p) => ({ ...p, is_hidden: e.target.checked }))}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Hide this account from dashboards</span>
              </label>

              {editError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{editError}</div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEditTarget(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">Cancel</button>
                <button type="submit" disabled={editSaving}
                  className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50">
                  {editSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Institution (Plaid Item) Confirmation Modal */}
      {deleteItemTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-lg text-gray-900">Disconnect Institution</h3>
              <button onClick={() => { setDeleteItemTarget(null); setDeleteItemError(""); }}
                className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-700 mb-1">
                You are about to disconnect{" "}
                <span className="font-semibold text-gray-900">
                  {deleteItemTarget.institution_name ?? "this institution"}
                </span>{" "}
                and remove all its linked accounts.
              </p>
              <p className="text-sm text-gray-500 mb-5">
                What should happen to the transactions from this institution?
              </p>

              {deleteItemError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
                  {deleteItemError}
                </div>
              )}

              <div className="space-y-3">
                <button
                  onClick={() => handleDeleteItem(true)}
                  disabled={deleteItemSaving}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-red-200 bg-red-50 hover:bg-red-100 transition disabled:opacity-50 group"
                >
                  <p className="text-sm font-semibold text-red-700 group-hover:text-red-800">
                    Disconnect and delete all transactions
                  </p>
                  <p className="text-xs text-red-500 mt-0.5">
                    Permanently removes the connection, all linked accounts, and every transaction.
                  </p>
                </button>

                <button
                  onClick={() => handleDeleteItem(false)}
                  disabled={deleteItemSaving}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-50 group"
                >
                  <p className="text-sm font-semibold text-amber-700 group-hover:text-amber-800">
                    Disconnect and keep transactions
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Removes the connection and accounts but keeps transaction history. Transactions will show as unlinked.
                  </p>
                </button>

                <button
                  onClick={() => { setDeleteItemTarget(null); setDeleteItemError(""); }}
                  disabled={deleteItemSaving}
                  className="w-full text-center px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
                >
                  Cancel
                </button>
              </div>

              {deleteItemSaving && (
                <p className="text-xs text-gray-400 text-center mt-3">Disconnecting...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-lg text-gray-900">Delete Account</h3>
              <button onClick={() => { setDeleteTarget(null); setDeleteError(""); }}
                className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-700 mb-2">
                You are about to delete{" "}
                <span className="font-semibold text-gray-900">
                  {deleteTarget.name}{deleteTarget.mask ? ` ••• ${deleteTarget.mask}` : ""}
                </span>.
              </p>
              <p className="text-sm text-gray-500 mb-5">
                What should happen to this account&apos;s transactions?
              </p>

              {deleteError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
                  {deleteError}
                </div>
              )}

              <div className="space-y-3">
                <button
                  onClick={() => handleDeleteAccount(true)}
                  disabled={deleteSaving}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-red-200 bg-red-50 hover:bg-red-100 transition disabled:opacity-50 group"
                >
                  <p className="text-sm font-semibold text-red-700 group-hover:text-red-800">
                    Delete account and all its transactions
                  </p>
                  <p className="text-xs text-red-500 mt-0.5">
                    Permanently removes the account and every transaction linked to it.
                  </p>
                </button>

                <button
                  onClick={() => handleDeleteAccount(false)}
                  disabled={deleteSaving}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-50 group"
                >
                  <p className="text-sm font-semibold text-amber-700 group-hover:text-amber-800">
                    Delete account, keep transactions
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Removes the account but keeps its transaction history. Transactions will show as unlinked.
                  </p>
                </button>

                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(""); }}
                  disabled={deleteSaving}
                  className="w-full text-center px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
                >
                  Cancel
                </button>
              </div>

              {deleteSaving && (
                <p className="text-xs text-gray-400 text-center mt-3">Deleting...</p>
              )}
            </div>
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

      {/* Account-type summary strip */}
      {!loading && visibleAccounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
          {summaryBuckets.map((b) => (
            <div
              key={b.label}
              className={`rounded-xl border p-4 flex flex-col gap-1 ${
                (b as { netCard?: boolean }).netCard
                  ? "bg-gray-900 border-gray-800"
                  : `${b.bg} ${b.border}`
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-base">{b.icon}</span>
                {(b as { count?: number | null }).count !== null && (
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                    (b as { netCard?: boolean }).netCard ? "bg-gray-700 text-gray-300" : "bg-white/60 text-gray-500"
                  }`}>
                    {(b as { count?: number | null }).count}
                  </span>
                )}
              </div>
              <p className={`text-xs font-medium mt-1 ${
                (b as { netCard?: boolean }).netCard ? "text-gray-400" : "text-gray-500"
              }`}>
                {b.label}
              </p>
              <p className={`text-lg font-bold leading-tight ${
                (b as { netCard?: boolean }).netCard
                  ? (b.amount >= 0 ? "text-white" : "text-red-400")
                  : (b as { debt?: boolean }).debt
                  ? (b.amount < 0 ? "text-red-600" : b.color)
                  : b.color
              }`}>
                {(b as { debt?: boolean }).debt && b.amount < 0 ? `−${fmtK(-b.amount)}` : fmtK(Math.abs(b.amount))}
              </p>
              {(b as { debt?: boolean }).debt && (
                <p className={`text-xs ${(b as { netCard?: boolean }).netCard ? "text-gray-500" : "text-gray-400"}`}>
                  owed
                </p>
              )}
            </div>
          ))}
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
              <AccountRow key={acct.id} acct={acct} members={members}
                onEdit={() => openEdit(acct)}
                onDelete={() => { setDeleteTarget(acct); setDeleteError(""); }} />
            ))}
          </div>
        </div>
      )}

      {/* SnapTrade brokerage connection cards */}
      {!loading && snapConnections.map((conn) => {
        const snapAccounts = accounts.filter((a) => a.snaptrade_connection_id === conn.id);
        const isSyncing = syncingSnapId === conn.id;
        const lastSynced = conn.last_synced_at
          ? new Date(conn.last_synced_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : null;

        return (
          <div key={conn.id} className="bg-white rounded-lg shadow border border-gray-100 mb-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{conn.brokerage_name ?? "Brokerage"}</h3>
                  <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">Via SnapTrade</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {lastSynced ? `Last synced ${lastSynced}` : "Not yet synced"}
                  {" · "}{conn.account_count} account{conn.account_count !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSyncSnapConnection(conn.id)}
                  disabled={isSyncing}
                  className="text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-400 px-3 py-1.5 rounded-md transition disabled:opacity-50"
                >
                  {isSyncing ? "Syncing..." : "↻ Sync"}
                </button>
                <button
                  onClick={() => handleDisconnectSnap(conn.id)}
                  className="text-xs text-gray-400 hover:text-red-600 border border-gray-200 hover:border-red-300 px-3 py-1.5 rounded-md transition"
                  title="Disconnect brokerage"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {snapAccounts.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-400">No accounts found — click Sync to pull from this brokerage.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {snapAccounts.map((acct) => (
                  <AccountRow key={acct.id} acct={acct} members={members}
                    onEdit={() => openEdit(acct)}
                    onDelete={() => { setDeleteTarget(acct); setDeleteError(""); }} />
                ))}
              </div>
            )}
          </div>
        );
      })}

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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSync(item.id)}
                  disabled={isSyncing}
                  className="text-xs text-primary-600 hover:text-primary-700 border border-primary-200 hover:border-primary-400 px-3 py-1.5 rounded-md transition disabled:opacity-50"
                >
                  {isSyncing ? "Syncing..." : "↻ Sync"}
                </button>
                <button
                  onClick={() => { setDeleteItemTarget(item); setDeleteItemError(""); }}
                  className="text-xs text-gray-400 hover:text-red-600 border border-gray-200 hover:border-red-300 px-3 py-1.5 rounded-md transition"
                  title="Disconnect institution"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {itemAccounts.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-400">No accounts found — click Sync to pull from this institution.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {itemAccounts.map((acct) => (
                  <AccountRow key={acct.id} acct={acct} members={members}
                    onEdit={() => openEdit(acct)}
                    onDelete={() => { setDeleteTarget(acct); setDeleteError(""); }} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountRow({ acct, members, onEdit, onDelete }: { acct: Account; members: UserResponse[]; onEdit: () => void; onDelete: () => void }) {
  const addedDate = new Date(acct.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const owner = members.find((m) => m.id === acct.owner_user_id);

  return (
    <div className="flex items-center justify-between px-6 py-3 group">
      <div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${acct.is_hidden ? "text-gray-400 line-through" : "text-gray-800"}`}>{acct.name}</span>
          {acct.mask && <span className="text-xs text-gray-400">••• {acct.mask}</span>}
          {acct.is_hidden && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Hidden</span>}
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
          {owner && (
            <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium" title="Account owner">
              {owner.full_name}
            </span>
          )}
          <span className="text-xs text-gray-400">Added {addedDate}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={onEdit}
            className="text-gray-300 hover:text-primary-600 transition p-1 rounded"
            title="Edit account"
          >
            ✏
          </button>
          <button
            onClick={onDelete}
            className="text-gray-300 hover:text-red-500 transition p-1 rounded"
            title="Delete account"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
