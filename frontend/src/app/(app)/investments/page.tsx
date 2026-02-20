"use client";

import { useEffect, useState, useCallback } from "react";
import { getToken, listAccounts, listHouseholdMembers, listHoldings, Account, Holding, UserResponse } from "@/lib/api";

// ─── Subtype classification ───────────────────────────────────────────────────

const RETIREMENT_SUBTYPES = new Set([
  "401k", "401a", "403b", "457b", "457plan",
  "ira", "roth", "roth 401k",
  "sep ira", "simple ira",
  "pension", "529", "529 plan",
  "hsa", "keogh",
  "non-taxable brokerage account", "retirement",
  "profit sharing plan", "rdsp", "rrif", "rrsp", "sarsep", "tfsa",
]);

function isRetirement(subtype: string | null): boolean {
  if (!subtype) return false;
  return RETIREMENT_SUBTYPES.has(subtype.toLowerCase());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(val: string | number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || val === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(val));
}

function fmtQty(val: string | null): string {
  if (!val) return "—";
  const n = Number(val);
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function subtypeLabel(subtype: string | null): string {
  if (!subtype) return "Investment";
  const map: Record<string, string> = {
    "401k": "401(k)", "401a": "401(a)", "403b": "403(b)", "457b": "457(b)",
    "ira": "IRA", "roth": "Roth IRA", "roth 401k": "Roth 401(k)",
    "sep ira": "SEP IRA", "simple ira": "SIMPLE IRA",
    "529": "529 Plan", "hsa": "HSA", "pension": "Pension", "keogh": "Keogh",
    "brokerage": "Brokerage", "cash management": "Cash Mgmt",
    "crypto exchange": "Crypto", "ugma": "UGMA", "utma": "UTMA",
  };
  return map[subtype.toLowerCase()] ?? subtype.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function subtypeBadgeColor(subtype: string | null): string {
  if (!subtype) return "bg-gray-100 text-gray-600";
  const s = subtype.toLowerCase();
  if (["401k", "401a", "roth 401k", "403b", "457b"].includes(s)) return "bg-purple-100 text-purple-700";
  if (["ira", "roth", "sep ira", "simple ira"].includes(s)) return "bg-blue-100 text-blue-700";
  if (["529", "hsa"].includes(s)) return "bg-teal-100 text-teal-700";
  if (["pension", "keogh", "profit sharing plan"].includes(s)) return "bg-indigo-100 text-indigo-700";
  if (["brokerage"].includes(s)) return "bg-orange-100 text-orange-700";
  if (["crypto exchange"].includes(s)) return "bg-yellow-100 text-yellow-700";
  return "bg-gray-100 text-gray-600";
}

function totalBalance(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + (a.current_balance ? Number(a.current_balance) : 0), 0);
}

// ─── Holdings Table ───────────────────────────────────────────────────────────

function HoldingsTable({ holdings, loading }: { holdings: Holding[]; loading: boolean }) {
  if (loading) {
    return <div className="px-5 py-4 text-center text-sm text-gray-400">Loading holdings…</div>;
  }
  if (holdings.length === 0) {
    return (
      <div className="px-5 py-4 text-center text-sm text-gray-400">
        No holdings data — sync with Plaid to import positions.
      </div>
    );
  }

  const totalValue = holdings.reduce((s, h) => s + Number(h.current_value ?? 0), 0);
  const allHaveCost = holdings.every((h) => h.cost_basis !== null);
  const totalCost = allHaveCost ? holdings.reduce((s, h) => s + Number(h.cost_basis ?? 0), 0) : null;
  const totalGain = totalCost !== null ? totalValue - totalCost : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <th className="px-4 py-2 text-left font-medium">Ticker</th>
            <th className="px-4 py-2 text-left font-medium">Name</th>
            <th className="px-4 py-2 text-right font-medium">Shares</th>
            <th className="px-4 py-2 text-right font-medium">Current Value</th>
            <th className="px-4 py-2 text-right font-medium">Cost Basis</th>
            <th className="px-4 py-2 text-right font-medium">Gain / Loss</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const value = Number(h.current_value ?? 0);
            const cost = Number(h.cost_basis ?? 0);
            const hasCost = h.cost_basis !== null && cost > 0;
            const gain = hasCost ? value - cost : null;
            const gainPct = hasCost ? ((value - cost) / cost) * 100 : null;
            const gainPositive = gain !== null && gain >= 0;

            return (
              <tr key={h.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">
                  {h.ticker_symbol ?? <span className="text-gray-400 font-sans font-normal">—</span>}
                </td>
                <td className="px-4 py-2.5 text-gray-700 max-w-[200px] truncate">{h.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{fmtQty(h.quantity)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">{fmt(h.current_value, 2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{hasCost ? fmt(h.cost_basis, 2) : "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {gain !== null ? (
                    <span className={gainPositive ? "text-green-600" : "text-red-600"}>
                      {gainPositive ? "+" : ""}{fmt(gain, 2)}
                      <span className="ml-1 text-xs opacity-75">({gainPositive ? "+" : ""}{gainPct!.toFixed(1)}%)</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-xs text-gray-600">
            <td colSpan={3} className="px-4 py-2">{holdings.length} position{holdings.length !== 1 ? "s" : ""}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmt(totalValue, 2)}</td>
            <td className="px-4 py-2 text-right tabular-nums text-gray-500">{totalCost !== null ? fmt(totalCost, 2) : "—"}</td>
            <td className="px-4 py-2 text-right tabular-nums">
              {totalGain !== null ? (
                <span className={totalGain >= 0 ? "text-green-600" : "text-red-600"}>
                  {totalGain >= 0 ? "+" : ""}{fmt(totalGain, 2)}
                </span>
              ) : <span className="text-gray-400">—</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Account Row ─────────────────────────────────────────────────────────────

function AccountRow({
  account, ownerName, expanded, onToggle, holdings, holdingsLoading,
}: {
  account: Account;
  ownerName?: string;
  expanded: boolean;
  onToggle: () => void;
  holdings: Holding[];
  holdingsLoading: boolean;
}) {
  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-base font-semibold text-gray-500">
            {(account.institution_name ?? account.name).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {account.name}
              {account.mask && <span className="ml-1.5 text-gray-400 font-normal">···{account.mask}</span>}
            </p>
            <p className="text-xs text-gray-400 truncate">{account.institution_name ?? "Manual"}</p>
          </div>
          <span className={`ml-2 shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${subtypeBadgeColor(account.subtype)}`}>
            {subtypeLabel(account.subtype)}
          </span>
          {ownerName && (
            <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              {ownerName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">{fmt(account.current_balance)}</p>
            {account.is_manual && <p className="text-xs text-gray-400">manual</p>}
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/50">
          <HoldingsTable holdings={holdings} loading={holdingsLoading} />
        </div>
      )}
    </div>
  );
}

// ─── Segment Section ──────────────────────────────────────────────────────────

function Segment({
  title, subtitle, accounts, accentClass, emptyText, memberMap,
  expandedId, onToggle, holdingsMap, holdingsLoadingMap,
}: {
  title: string;
  subtitle: string;
  accounts: Account[];
  accentClass: string;
  emptyText: string;
  memberMap: Record<string, string>;
  expandedId: string | null;
  onToggle: (id: string) => void;
  holdingsMap: Record<string, Holding[]>;
  holdingsLoadingMap: Record<string, boolean>;
}) {
  const total = totalBalance(accounts);
  return (
    <div className="bg-white rounded-xl shadow border border-gray-100">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400 mb-0.5">Total Value</p>
          <p className={`text-xl font-bold ${accentClass}`}>{fmt(total)}</p>
        </div>
      </div>
      {accounts.length === 0 ? (
        <p className="px-5 py-8 text-sm text-gray-400 text-center">{emptyText}</p>
      ) : (
        <div>
          {accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              ownerName={a.owner_user_id ? memberMap[a.owner_user_id] : undefined}
              expanded={expandedId === a.id}
              onToggle={() => onToggle(a.id)}
              holdings={holdingsMap[a.id] ?? []}
              holdingsLoading={holdingsLoadingMap[a.id] ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InvestmentsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<UserResponse[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [holdingsMap, setHoldingsMap] = useState<Record<string, Holding[]>>({});
  const [holdingsLoadingMap, setHoldingsLoadingMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    Promise.all([listAccounts(token), listHouseholdMembers(token)])
      .then(([all, mems]) => {
        setAccounts(all.filter((a) => a.type === "investment" && !a.is_hidden));
        setMembers(mems);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = useCallback((accountId: string) => {
    setExpandedId((prev) => {
      if (prev === accountId) return null;

      // Fetch holdings on first expand
      setHoldingsMap((m) => {
        if (m[accountId] !== undefined) return m; // already loaded
        const token = getToken();
        if (token) {
          setHoldingsLoadingMap((lm) => ({ ...lm, [accountId]: true }));
          listHoldings(accountId, token)
            .then((h) => setHoldingsMap((cur) => ({ ...cur, [accountId]: h })))
            .catch(() => setHoldingsMap((cur) => ({ ...cur, [accountId]: [] })))
            .finally(() => setHoldingsLoadingMap((lm) => ({ ...lm, [accountId]: false })));
        }
        return m;
      });

      return accountId;
    });
  }, []);

  const memberMap: Record<string, string> = Object.fromEntries(members.map((m) => [m.id, m.full_name]));

  const filtered = ownerFilter === "all"
    ? accounts
    : ownerFilter === "shared"
    ? accounts.filter((a) => !a.owner_user_id)
    : accounts.filter((a) => a.owner_user_id === ownerFilter);

  const brokerage = filtered.filter((a) => !isRetirement(a.subtype));
  const retirement = filtered.filter((a) => isRetirement(a.subtype));
  const totalBrokerage = totalBalance(brokerage);
  const totalRetirement = totalBalance(retirement);
  const totalAll = totalBrokerage + totalRetirement;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold">Investments</h2>
        {members.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">Owner:</label>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="all">All Members</option>
              <option value="shared">Shared / Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Total Investments</p>
          <p className="text-2xl font-bold text-gray-900">{loading ? "…" : fmt(totalAll)}</p>
          <p className="text-xs text-gray-400 mt-1">{filtered.length} account{filtered.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Brokerage / Taxable</p>
          <p className="text-2xl font-bold text-orange-600">{loading ? "…" : fmt(totalBrokerage)}</p>
          <p className="text-xs text-gray-400 mt-1">{brokerage.length} account{brokerage.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Retirement / Tax-Advantaged</p>
          <p className="text-2xl font-bold text-purple-600">{loading ? "…" : fmt(totalRetirement)}</p>
          <p className="text-xs text-gray-400 mt-1">{retirement.length} account{retirement.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-12 text-center text-gray-400 text-sm">
          Loading accounts…
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-12 text-center">
          <p className="text-gray-500 font-medium mb-1">No investment accounts found</p>
          <p className="text-sm text-gray-400">
            Link a brokerage or retirement account via Plaid, or add one manually in Accounts.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-gray-400">Click an account row to view individual holdings and positions.</p>
          <Segment
            title="Brokerage & Taxable"
            subtitle="Standard taxable investment accounts"
            accounts={brokerage}
            accentClass="text-orange-600"
            emptyText="No brokerage accounts linked."
            memberMap={memberMap}
            expandedId={expandedId}
            onToggle={handleToggle}
            holdingsMap={holdingsMap}
            holdingsLoadingMap={holdingsLoadingMap}
          />
          <Segment
            title="Retirement & Tax-Advantaged"
            subtitle="401(k), IRA, Roth IRA, 403(b), HSA, 529, and other tax-advantaged accounts"
            accounts={retirement}
            accentClass="text-purple-600"
            emptyText="No retirement accounts linked."
            memberMap={memberMap}
            expandedId={expandedId}
            onToggle={handleToggle}
            holdingsMap={holdingsMap}
            holdingsLoadingMap={holdingsLoadingMap}
          />
        </div>
      )}
    </div>
  );
}
