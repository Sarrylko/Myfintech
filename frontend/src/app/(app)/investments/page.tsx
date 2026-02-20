"use client";

import { useEffect, useState } from "react";
import { getToken, listAccounts, listHouseholdMembers, Account, UserResponse } from "@/lib/api";

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

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(val));
}

function subtypeLabel(subtype: string | null): string {
  if (!subtype) return "Investment";
  const map: Record<string, string> = {
    "401k": "401(k)",
    "401a": "401(a)",
    "403b": "403(b)",
    "457b": "457(b)",
    "ira": "IRA",
    "roth": "Roth IRA",
    "roth 401k": "Roth 401(k)",
    "sep ira": "SEP IRA",
    "simple ira": "SIMPLE IRA",
    "529": "529 Plan",
    "hsa": "HSA",
    "pension": "Pension",
    "keogh": "Keogh",
    "brokerage": "Brokerage",
    "cash management": "Cash Mgmt",
    "crypto exchange": "Crypto",
    "ugma": "UGMA",
    "utma": "UTMA",
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

// ─── Account Row ─────────────────────────────────────────────────────────────

function AccountRow({ account, ownerName }: { account: Account; ownerName?: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-base font-semibold text-gray-500">
          {(account.institution_name ?? account.name).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {account.name}
            {account.mask && <span className="ml-1.5 text-gray-400 font-normal">···{account.mask}</span>}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {account.institution_name ?? "Manual"}
          </p>
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
      <div className="text-right shrink-0 ml-4">
        <p className="text-sm font-semibold text-gray-900">{fmt(account.current_balance)}</p>
        {account.is_manual && (
          <p className="text-xs text-gray-400">manual</p>
        )}
      </div>
    </div>
  );
}

// ─── Segment Section ──────────────────────────────────────────────────────────

function Segment({
  title, subtitle, accounts, accentClass, emptyText, memberMap,
}: {
  title: string;
  subtitle: string;
  accounts: Account[];
  accentClass: string;
  emptyText: string;
  memberMap: Record<string, string>;
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
            <AccountRow key={a.id} account={a} ownerName={a.owner_user_id ? memberMap[a.owner_user_id] : undefined} />
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

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    Promise.all([
      listAccounts(token),
      listHouseholdMembers(token),
    ])
      .then(([all, mems]) => {
        setAccounts(all.filter((a) => a.type === "investment" && !a.is_hidden));
        setMembers(mems);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  const memberMap: Record<string, string> = Object.fromEntries(members.map((m) => [m.id, m.full_name]));

  // Apply owner filter
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
          <Segment
            title="Brokerage & Taxable"
            subtitle="Standard taxable investment accounts"
            accounts={brokerage}
            accentClass="text-orange-600"
            emptyText="No brokerage accounts linked."
            memberMap={memberMap}
          />
          <Segment
            title="Retirement & Tax-Advantaged"
            subtitle="401(k), IRA, Roth IRA, 403(b), HSA, 529, and other tax-advantaged accounts"
            accounts={retirement}
            accentClass="text-purple-600"
            emptyText="No retirement accounts linked."
            memberMap={memberMap}
          />
        </div>
      )}
    </div>
  );
}
