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
  PlaidItem,
  Account,
} from "@/lib/api";

declare global {
  interface Window {
    Plaid: {
      create: (config: {
        token: string;
        onSuccess: (public_token: string, metadata: { institution?: { institution_id: string; name: string } }) => void;
        onExit: (err: unknown) => void;
        onLoad?: () => void;
      }) => { open: () => void; destroy: () => void };
    };
  }
}

function fmt(value: string | number | null, currency = "USD"): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

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

  // Load Plaid Link script
  useEffect(() => {
    const existing = document.querySelector('script[src*="plaid.com/link"]');
    if (existing) { setPlaidReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => setPlaidReady(true);
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) document.body.removeChild(script);
    };
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
      setError("Plaid is still loading, please try again in a moment.");
      return;
    }

    setLinking(true);
    setError("");
    try {
      const { link_token } = await getLinkToken(token);

      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            await exchangePublicToken(
              public_token,
              metadata.institution?.institution_id ?? null,
              metadata.institution?.name ?? null,
              token
            );
            await loadData();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to link account");
          } finally {
            setLinking(false);
          }
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
    setSyncingId(itemId);
    setError("");
    try {
      await syncPlaidItem(itemId, token);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingId(null);
    }
  }

  // Group accounts by plaid_item_id
  const accountsByItem: Record<string, Account[]> = {};
  for (const acct of accounts) {
    if (!accountsByItem[acct.plaid_item_id]) accountsByItem[acct.plaid_item_id] = [];
    accountsByItem[acct.plaid_item_id].push(acct);
  }

  // Summary totals
  const totalAssets = accounts
    .filter((a) => a.type === "depository" || a.type === "investment")
    .reduce((s, a) => s + (a.current_balance ? parseFloat(a.current_balance) : 0), 0);
  const totalLiabilities = accounts
    .filter((a) => a.type === "credit" || a.type === "loan")
    .reduce((s, a) => s + (a.current_balance ? parseFloat(a.current_balance) : 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Accounts</h2>
        <button
          onClick={handleLinkAccount}
          disabled={linking}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition text-sm font-medium disabled:opacity-50"
        >
          {linking ? "Connecting..." : "+ Link Account"}
        </button>
      </div>

      {/* Plaid not configured banner */}
      {plaidNotConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-amber-800 mb-1">Plaid credentials not configured</p>
          <p className="text-sm text-amber-700 mb-2">
            To link bank accounts, add your Plaid API credentials to <code className="bg-amber-100 px-1 rounded">.env</code> and restart the API:
          </p>
          <pre className="text-xs bg-amber-100 rounded p-3 text-amber-900 overflow-x-auto">
{`PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_sandbox_secret
PLAID_ENV=sandbox`}
          </pre>
          <p className="text-xs text-amber-600 mt-2">
            Get free sandbox credentials at <strong>dashboard.plaid.com</strong> → Team Settings → Keys.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
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
            <p className={`text-2xl font-bold ${netWorth >= 0 ? "text-green-600" : "text-red-600"}`}>
              {fmt(netWorth)}
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-lg shadow border border-gray-100 p-12 text-center text-gray-400">
          Loading accounts...
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && !error && (
        <div className="bg-white rounded-lg shadow border border-gray-100">
          <div className="p-12 text-center text-gray-400">
            <div className="text-4xl mb-4">🏦</div>
            <p className="text-lg font-medium mb-2 text-gray-600">No accounts linked yet</p>
            <p className="text-sm mb-6">
              Connect your bank, credit card, or investment accounts to track balances and transactions automatically.
            </p>
            <button
              onClick={handleLinkAccount}
              disabled={linking}
              className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 transition text-sm font-medium disabled:opacity-50"
            >
              {linking ? "Connecting..." : "+ Link Your First Account"}
            </button>
          </div>
        </div>
      )}

      {/* Institution cards */}
      {!loading && items.map((item) => {
        const itemAccounts = accountsByItem[item.id] ?? [];
        const isSyncing = syncingId === item.id;
        const lastSynced = item.last_synced_at
          ? new Date(item.last_synced_at).toLocaleString("en-US", {
              month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit",
            })
          : null;

        return (
          <div key={item.id} className="bg-white rounded-lg shadow border border-gray-100 mb-4">
            {/* Institution header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">{item.institution_name ?? "Bank"}</h3>
                {lastSynced && (
                  <p className="text-xs text-gray-400 mt-0.5">Last synced {lastSynced}</p>
                )}
              </div>
              <button
                onClick={() => handleSync(item.id)}
                disabled={isSyncing}
                className="text-xs text-primary-600 hover:text-primary-700 border border-primary-200 hover:border-primary-400 px-3 py-1.5 rounded-md transition disabled:opacity-50"
              >
                {isSyncing ? "Syncing..." : "↻ Sync"}
              </button>
            </div>

            {/* Accounts list */}
            {itemAccounts.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-400">
                No accounts found — click Sync to pull accounts from this institution.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {itemAccounts.map((acct) => (
                  <div key={acct.id} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{acct.name}</span>
                        {acct.mask && (
                          <span className="text-xs text-gray-400">••• {acct.mask}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(acct.type)}`}>
                          {capitalize(acct.subtype ?? acct.type)}
                        </span>
                        {acct.official_name && acct.official_name !== acct.name && (
                          <span className="text-xs text-gray-400">{acct.official_name}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-900">
                        {fmt(acct.current_balance, acct.currency_code)}
                      </div>
                      {acct.available_balance !== null &&
                        acct.available_balance !== acct.current_balance && (
                          <div className="text-xs text-gray-400">
                            {fmt(acct.available_balance, acct.currency_code)} avail.
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
