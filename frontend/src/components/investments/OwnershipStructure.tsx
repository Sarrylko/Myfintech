"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  listBusinessEntities,
  listInvestmentTransactionRollup,
  type Account,
  type BusinessEntityResponse,
  type Holding,
  type UserResponse,
} from "@/lib/api";
import { classifyAccount, classifyHolding } from "@/components/investments/PortfolioInsights";

// Who owns what, where it's held, how quickly it can be reached, and how
// current the numbers are. Balances are account.current_balance, the same
// figure the account lists above total.

type Fmt = (val: string | number | null | undefined, decimals?: number) => string;

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const DAY_MS = 86_400_000;

// ─── Account classification ──────────────────────────────────────────────────

const RETIREMENT_SUBTYPES = new Set([
  "401k", "401a", "403b", "457b", "457plan", "ira", "roth", "roth 401k", "roth ira",
  "sep ira", "simple ira", "pension", "529", "529 plan", "hsa", "keogh",
  "non-taxable brokerage account", "retirement", "profit sharing plan",
  "rdsp", "rrif", "rrsp", "sarsep", "tfsa",
]);
// Employer plans and 529s are held by a plan trustee, not a SIPC broker.
const PLAN_SUBTYPES = new Set(["401k", "401a", "403b", "457b", "457plan", "pension", "profit sharing plan", "keogh", "529", "529 plan"]);
const RE_RETIREMENT_NAME = /\b(401\(?k\)?|403\(?b\)?|457|ira|roth|hsa|health savings|pension|retirement)\b/i;
const RE_ROTH = /\broth\b/i;
const RE_HSA_529 = /\b(hsa|health savings|529)\b/i;

type Kind = "taxable" | "retirement" | "crypto";

function accountKind(a: Account): Kind {
  const sub = (a.subtype ?? "").toLowerCase();
  if (sub === "crypto exchange") return "crypto";
  if (RETIREMENT_SUBTYPES.has(sub) || RE_RETIREMENT_NAME.test(a.name)) return "retirement";
  return "taxable";
}

const value = (a: Account) => Math.max(Number(a.current_balance ?? 0), 0);

// ─── Freshness ───────────────────────────────────────────────────────────────

export const STALE_DAYS = 30;

/** Whole days since the balance or holdings were last synced or edited, or
 * null when that was never recorded. */
export function daysSinceUpdate(a: Account, now = Date.now()): number | null {
  if (!a.balance_updated_at) return null;
  return Math.max(0, Math.floor((now - new Date(a.balance_updated_at).getTime()) / DAY_MS));
}

export function isStale(a: Account, now = Date.now()): boolean {
  const d = daysSinceUpdate(a, now);
  return d === null || d > STALE_DAYS;
}

function ageLabel(days: number | null): string {
  if (days === null) return "never recorded";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} months ago` : `${(days / 365).toFixed(1)} years ago`;
}

// ─── Ownership ───────────────────────────────────────────────────────────────

interface Owner { key: string; label: string; kind: "member" | "joint" | "entity" }

function ownerOf(a: Account, members: Record<string, string>, entities: Record<string, string>): Owner {
  if (a.entity_id) {
    return { key: `e:${a.entity_id}`, label: entities[a.entity_id] ?? "Business entity", kind: "entity" };
  }
  if (a.owner_user_id) {
    return { key: `u:${a.owner_user_id}`, label: members[a.owner_user_id] ?? "Member", kind: "member" };
  }
  return { key: "joint", label: "Joint / unassigned", kind: "joint" };
}

const OWNER_KIND_RANK = { member: 0, joint: 1, entity: 2 } as const;

// ─── Institutions ────────────────────────────────────────────────────────────

const SIPC_LIMIT = 500_000;

function institutionKey(a: Account): { key: string; label: string } {
  const raw = (a.institution_name ?? "").trim();
  if (!raw) return { key: "manual", label: a.is_manual ? "Manual / no institution" : "Unknown institution" };
  const key = raw
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(investments?|securities|brokerage|financial|wealth management|inc|llc|corp|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { key: key || raw.toLowerCase(), label: raw };
}

type Coverage = "sipc" | "treasury" | "plan" | "crypto";

function coverageOf(a: Account): Coverage {
  const text = `${a.institution_name ?? ""} ${a.name}`.toLowerCase();
  if (text.includes("treasurydirect") || text.includes("treasury direct")) return "treasury";
  if (accountKind(a) === "crypto") return "crypto";
  if (PLAN_SUBTYPES.has((a.subtype ?? "").toLowerCase())) return "plan";
  return "sipc";
}

/** SIPC limits apply per customer per "separate capacity": individual, joint,
 * each entity, and traditional and Roth IRAs are each covered separately. */
function capacityOf(a: Account, owner: Owner): { key: string; label: string } {
  if (accountKind(a) !== "retirement") return { key: owner.key, label: owner.label };
  const text = `${a.subtype ?? ""} ${a.name}`;
  const type = RE_ROTH.test(text) ? "Roth" : RE_HSA_529.test(text) ? "HSA" : "IRA";
  return { key: `${owner.key}:${type}`, label: `${owner.label} ${type}` };
}

// ─── Liquidity ───────────────────────────────────────────────────────────────

type Tier = "available" | "penalty" | "locked";

const TIER_META: Record<Tier, { label: string; hint: string; bar: string; dot: string }> = {
  available: {
    label: "Available now",
    hint: "Taxable brokerage and crypto. Selling can trigger capital-gains tax.",
    bar: "bg-emerald-500", dot: "bg-emerald-500",
  },
  penalty: {
    label: "Penalty before 59½",
    hint: "Retirement accounts: 10% penalty plus income tax on early withdrawals. HSA and 529 are penalty-free only for qualified expenses.",
    bar: "bg-amber-400", dot: "bg-amber-400",
  },
  locked: {
    label: "Locked or illiquid",
    hint: "I-Bonds bought in the last 12 months can't be redeemed, and private holdings with no market price can't be sold quickly.",
    bar: "bg-slate-400", dot: "bg-slate-400",
  },
};

const RE_IBOND = /\b(i[- ]?bonds?|series i)\b/i;
const RE_PRIVATE = /\b(private|angel|startup|venture|seed|syndicat\w*|partnership|lp|fund interest|crowdfund\w*|pre-?ipo)\b/i;

function isIBond(h: Holding | null, a: Account): boolean {
  if (h) return RE_IBOND.test(`${h.name ?? ""} ${h.ticker_symbol ?? ""}`);
  return RE_IBOND.test(a.name);
}

/** A manual holding with no market ticker that isn't cash or bonds: private
 * equity, a startup stake, an LP interest. */
function isPrivate(h: Holding, a: Account): boolean {
  if (!a.is_manual || h.ticker_symbol || h.coingecko_id) return false;
  const bucket = classifyHolding(h, a);
  if (bucket === "cash" || bucket === "bonds" || bucket === "crypto") return false;
  return bucket === "other" || RE_PRIVATE.test(h.name ?? "");
}

interface LockedItem { account: Account; label: string; value: number; why: string }

interface Liquidity {
  tiers: Record<Tier, number>;
  locked: LockedItem[];
  ibondsUnlocking: { date: Date; value: number }[];
}

/** Recent I-Bond purchases per account: [date, amount] from buy transactions. */
type IBondBuys = Record<string, { date: Date; amount: number }[]>;

function buildLiquidity(
  accounts: Account[], holdingsMap: Record<string, Holding[]>, buys: IBondBuys, now: number,
): Liquidity {
  const tiers: Record<Tier, number> = { available: 0, penalty: 0, locked: 0 };
  const locked: LockedItem[] = [];
  const unlocking: { date: Date; value: number }[] = [];
  const yearAgo = now - 365 * DAY_MS;

  for (const a of accounts) {
    const total = value(a);
    if (total <= 0) continue;
    const kind = accountKind(a);
    const base: Tier = kind === "retirement" ? "penalty" : "available";
    const holdings = holdingsMap[a.id] ?? [];
    let lockedHere = 0;

    const ibondValue = holdings.length > 0
      ? holdings.filter((h) => isIBond(h, a)).reduce((s, h) => s + Math.max(Number(h.current_value ?? 0), 0), 0)
      : (isIBond(null, a) ? total : 0);

    if (ibondValue > 0) {
      const recent = (buys[a.id] ?? []).filter((b) => b.date.getTime() > yearAgo);
      let lockedIb = Math.min(ibondValue, recent.reduce((s, b) => s + b.amount, 0));
      let why = `Bought within 12 months (${recent.length} purchase${recent.length !== 1 ? "s" : ""})`;
      if (buys[a.id] === undefined || (buys[a.id].length === 0 && holdings.length > 0)) {
        // No purchase history: fall back to when the holdings were added.
        lockedIb = holdings
          .filter((h) => isIBond(h, a) && new Date(h.created_at).getTime() > yearAgo)
          .reduce((s, h) => s + Math.max(Number(h.current_value ?? 0), 0), 0);
        why = "Added within 12 months (no purchase dates recorded)";
        for (const h of holdings) {
          if (isIBond(h, a) && new Date(h.created_at).getTime() > yearAgo) {
            unlocking.push({ date: new Date(new Date(h.created_at).getTime() + 365 * DAY_MS), value: Math.max(Number(h.current_value ?? 0), 0) });
          }
        }
      } else {
        for (const b of recent) unlocking.push({ date: new Date(b.date.getTime() + 365 * DAY_MS), value: b.amount });
      }
      if (lockedIb > 0) {
        lockedHere += lockedIb;
        locked.push({ account: a, label: "I-Bonds", value: lockedIb, why });
      }
    }

    for (const h of holdings) {
      if (isIBond(h, a) || !isPrivate(h, a)) continue;
      const v = Math.max(Number(h.current_value ?? 0), 0);
      if (v <= 0) continue;
      lockedHere += v;
      locked.push({ account: a, label: h.name ?? "Private holding", value: v, why: "No market price; entered manually" });
    }
    if (holdings.length === 0 && a.is_manual && classifyAccount(a) === "other" && RE_PRIVATE.test(a.name)) {
      lockedHere += total;
      locked.push({ account: a, label: a.name, value: total, why: "Private holding; entered manually" });
    }

    lockedHere = Math.min(lockedHere, total);
    tiers.locked += lockedHere;
    tiers[base] += total - lockedHere;
  }

  locked.sort((x, y) => y.value - x.value);
  unlocking.sort((x, y) => x.date.getTime() - y.date.getTime());
  return { tiers, locked, ibondsUnlocking: unlocking };
}

// ─── UI pieces ───────────────────────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow border border-gray-100 flex flex-col min-w-0">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const OWNER_COLORS = ["bg-blue-500", "bg-violet-500", "bg-teal-500", "bg-orange-400", "bg-pink-500", "bg-lime-500", "bg-cyan-500"];

function StackedBar({ parts }: { parts: { key: string; share: number; color: string; title: string }[] }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
      {parts.filter((p) => p.share > 0).map((p) => (
        <div key={p.key} className={p.color} style={{ width: `${p.share * 100}%` }} title={p.title} />
      ))}
    </div>
  );
}

// ─── By owner ────────────────────────────────────────────────────────────────

interface OwnerRow extends Owner { taxable: number; retirement: number; crypto: number; total: number; count: number }

function OwnerCard({ rows, total, fmt }: { rows: OwnerRow[]; total: number; fmt: Fmt }) {
  const anyCrypto = rows.some((r) => r.crypto > 0);
  return (
    <Card title="By Owner" subtitle="Each person, joint holdings and business entities side by side">
      <div className="px-5 pt-3.5 pb-2">
        <StackedBar parts={rows.map((r, i) => ({
          key: r.key, share: total > 0 ? r.total / total : 0, color: OWNER_COLORS[i % OWNER_COLORS.length],
          title: `${r.label}: ${fmt(r.total)} (${pct(total > 0 ? r.total / total : 0)})`,
        }))} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400">
              <th className="text-left font-semibold px-5 py-2">Owner</th>
              <th className="text-right font-semibold px-2 py-2">Taxable</th>
              <th className="text-right font-semibold px-2 py-2">Retirement</th>
              {anyCrypto && <th className="text-right font-semibold px-2 py-2">Crypto</th>}
              <th className="text-right font-semibold px-5 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-gray-50">
                <td className="px-5 py-2 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${OWNER_COLORS[i % OWNER_COLORS.length]}`} />
                    <span className="font-medium text-gray-800 truncate max-w-[150px]" title={r.label}>{r.label}</span>
                    {r.kind === "entity" && (
                      <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Entity</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 ml-4">{r.count} account{r.count !== 1 ? "s" : ""}</p>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600">{r.taxable > 0 ? fmt(r.taxable) : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600">{r.retirement > 0 ? fmt(r.retirement) : "—"}</td>
                {anyCrypto && <td className="px-2 py-2 text-right tabular-nums text-gray-600">{r.crypto > 0 ? fmt(r.crypto) : "—"}</td>}
                <td className="px-5 py-2 text-right tabular-nums">
                  <span className="font-semibold text-gray-900">{fmt(r.total)}</span>
                  <span className="block text-[10px] text-gray-400">{pct(total > 0 ? r.total / total : 0)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-2.5 text-[11px] text-gray-400 border-t border-gray-50">
        Entity-owned accounts are shown under the entity, not split by members&apos; ownership percentages.
      </p>
    </Card>
  );
}

// ─── By institution ──────────────────────────────────────────────────────────

interface InstRow {
  key: string; label: string; total: number; count: number;
  coverage: Record<Coverage, number>;
  overSipc: { capacity: string; value: number }[];
}

const COVERAGE_BADGE: Record<Exclude<Coverage, "sipc">, { text: string; cls: string; title: string }> = {
  treasury: { text: "US Treasury", cls: "bg-emerald-50 text-emerald-700", title: "Held directly with the US Treasury; backed by the government, not SIPC" },
  plan: { text: "Plan trust", cls: "bg-gray-100 text-gray-600", title: "Employer plans and 529s are held by a plan trustee, outside SIPC" },
  crypto: { text: "No SIPC", cls: "bg-red-50 text-red-700", title: "Crypto held at an exchange isn't covered by SIPC" },
};

function InstitutionCard({ rows, total, fmt, us }: { rows: InstRow[]; total: number; fmt: Fmt; us: boolean }) {
  const top = rows[0];
  const topShare = top && total > 0 ? top.total / total : 0;
  const overCount = rows.filter((r) => r.overSipc.length > 0).length;
  return (
    <Card title="By Institution" subtitle={us ? `Custodian concentration and SIPC exposure (${fmt(SIPC_LIMIT)} per ownership capacity)` : "Custodian concentration"}>
      <ul className="px-5 py-3 space-y-3">
        {rows.map((r) => {
          const share = total > 0 ? r.total / total : 0;
          const badges = us ? (Object.keys(COVERAGE_BADGE) as Exclude<Coverage, "sipc">[]).filter((c) => r.coverage[c] > 0) : [];
          return (
            <li key={r.key}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="font-medium text-gray-800 truncate max-w-[160px]" title={r.label}>{r.label}</span>
                  <span className="text-[10px] text-gray-400">{r.count} acct{r.count !== 1 ? "s" : ""}</span>
                  {badges.map((c) => (
                    <span key={c} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${COVERAGE_BADGE[c].cls}`} title={COVERAGE_BADGE[c].title}>
                      {COVERAGE_BADGE[c].text}
                    </span>
                  ))}
                  {us && r.overSipc.length > 0 && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700"
                      title={r.overSipc.map((o) => `${o.capacity}: ${fmt(o.value)}`).join("\n") + "\nAbove the SIPC limit. Many large brokers carry excess-SIPC insurance; check the firm's coverage."}
                    >
                      Over SIPC limit
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <span className="font-semibold text-gray-900">{fmt(r.total)}</span>
                  <span className="ml-1.5 text-gray-400">{pct(share, 0)}</span>
                </div>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${share >= 0.5 ? "bg-amber-400" : "bg-blue-500"}`} style={{ width: `${share * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-5 py-2.5 text-[11px] text-gray-400 border-t border-gray-50">
        {top ? `${top.label} holds ${pct(topShare, 0)} of the portfolio${topShare >= 0.5 ? ", more than half" : ""}. ` : ""}
        {!us ? "" : overCount > 0
          ? `${overCount} institution${overCount !== 1 ? "s have" : " has"} a capacity above the SIPC limit. SIPC covers broker failure, not market losses.`
          : "No ownership capacity is above the SIPC limit at any one firm. SIPC covers broker failure, not market losses."}
      </p>
    </Card>
  );
}

// ─── Liquidity ───────────────────────────────────────────────────────────────

function LiquidityCard({ liq, total, fmt, loadingBuys }: { liq: Liquidity; total: number; fmt: Fmt; loadingBuys: boolean }) {
  const order: Tier[] = ["available", "penalty", "locked"];
  const nextUnlock = liq.ibondsUnlocking.find((u) => u.date.getTime() > Date.now());
  return (
    <Card title="Liquidity" subtitle="How quickly each dollar can be reached without penalty">
      <div className="px-5 pt-3.5 pb-1">
        <StackedBar parts={order.map((t) => ({
          key: t, share: total > 0 ? liq.tiers[t] / total : 0, color: TIER_META[t].bar,
          title: `${TIER_META[t].label}: ${fmt(liq.tiers[t])}`,
        }))} />
      </div>
      <ul className="px-5 py-2 space-y-2.5">
        {order.map((t) => (
          <li key={t} className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${TIER_META[t].dot}`} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800">{TIER_META[t].label}</p>
                <p className="text-[10px] text-gray-400">{TIER_META[t].hint}</p>
              </div>
            </div>
            <div className="text-right shrink-0 tabular-nums">
              <p className="text-xs font-semibold text-gray-900">{fmt(liq.tiers[t])}</p>
              <p className="text-[10px] text-gray-400">{pct(total > 0 ? liq.tiers[t] / total : 0, 0)}</p>
            </div>
          </li>
        ))}
      </ul>
      {liq.locked.length > 0 && (
        <div className="border-t border-gray-50">
          <p className="px-5 pt-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Locked or illiquid</p>
          <ul className="px-5 py-1.5">
            {liq.locked.slice(0, 6).map((l, i) => (
              <li key={`${l.account.id}-${i}`} className="flex items-center justify-between gap-3 py-1 text-xs">
                <div className="min-w-0">
                  <p className="text-gray-800 truncate" title={l.label}>{l.label}</p>
                  <p className="text-[10px] text-gray-400 truncate">{l.account.name} · {l.why}</p>
                </div>
                <span className="tabular-nums text-gray-700 shrink-0">{fmt(l.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="px-5 py-2.5 text-[11px] text-gray-400 border-t border-gray-50">
        {loadingBuys
          ? "Checking I-Bond purchase dates…"
          : nextUnlock
          ? `Next I-Bond unlock: ${fmt(nextUnlock.value)} on ${nextUnlock.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. Redeeming before 5 years forfeits the last 3 months' interest.`
          : "Redeeming I-Bonds before 5 years forfeits the last 3 months' interest. The penalty tier doesn't account for each owner's age."}
      </p>
    </Card>
  );
}

// ─── Freshness ───────────────────────────────────────────────────────────────

function FreshnessCard({ accounts, fmt, now }: { accounts: Account[]; fmt: Fmt; now: number }) {
  const manual = accounts.filter((a) => a.is_manual);
  const linked = accounts.filter((a) => !a.is_manual);
  const stale = accounts.filter((a) => isStale(a, now));
  const staleValue = stale.reduce((s, a) => s + value(a), 0);
  // Every manual account, plus any linked account whose sync has stopped.
  const shown = [...manual, ...linked.filter((a) => isStale(a, now))].sort((x, y) => {
    const dx = daysSinceUpdate(x, now) ?? Infinity;
    const dy = daysSinceUpdate(y, now) ?? Infinity;
    return dy - dx || value(y) - value(x);
  });

  return (
    <Card title="Data Freshness" subtitle={`Manual entries and anything not updated in ${STALE_DAYS}+ days`}>
      <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Linked</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">{linked.length}</p>
        </div>
        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Manual</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">{manual.length}</p>
        </div>
        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Stale</p>
          <p className={`text-lg font-bold tabular-nums mt-0.5 ${stale.length > 0 ? "text-amber-600" : "text-gray-900"}`}>{stale.length}</p>
          {stale.length > 0 && <p className="text-[10px] text-gray-400 tabular-nums">{fmt(staleValue)}</p>}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="px-5 py-5 flex items-start gap-2.5">
          <svg className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-xs text-gray-600">Every account is linked and synced within the last {STALE_DAYS} days.</p>
        </div>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {shown.map((a) => {
            const days = daysSinceUpdate(a, now);
            const st = isStale(a, now);
            return (
              <li key={a.id} className="px-5 py-2 flex items-center justify-between gap-3 border-t border-gray-50 first:border-0">
                <div className="min-w-0">
                  <p className="text-xs text-gray-800 truncate" title={a.name}>
                    {a.name}
                    {a.mask && <span className="ml-1 text-gray-400">···{a.mask}</span>}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {a.institution_name ?? "No institution"} · {a.is_manual ? "edited" : "synced"} {ageLabel(days)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs tabular-nums text-gray-700">{fmt(a.current_balance)}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${a.is_manual ? "bg-gray-100 text-gray-600" : "bg-blue-50 text-blue-700"}`}>
                    {a.is_manual ? "Manual" : "Linked"}
                  </span>
                  {st && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">Stale</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-5 py-2.5 text-[11px] text-gray-400 border-t border-gray-50">
        Price refreshes don&apos;t count as an update: a manual account is current only once its quantities or balance are edited.
      </p>
    </Card>
  );
}

// ─── Container ───────────────────────────────────────────────────────────────

export default function OwnershipStructure({
  accounts, holdingsMap, members, fmt, us,
}: {
  accounts: Account[];
  holdingsMap: Record<string, Holding[]>;
  members: UserResponse[];
  fmt: Fmt;
  us: boolean;   // SIPC, I-Bonds and the 59½ rule are US-specific
}) {
  const [entities, setEntities] = useState<BusinessEntityResponse[]>([]);
  const [buys, setBuys] = useState<IBondBuys>({});
  const [loadingBuys, setLoadingBuys] = useState(false);
  const now = useMemo(() => Date.now(), []);

  useEffect(() => {
    listBusinessEntities().then(setEntities).catch(() => {});
  }, []);

  const allLoaded = accounts.every((a) => holdingsMap[a.id] !== undefined);

  // Purchase dates decide which I-Bonds are still inside their 12-month lock;
  // only accounts that hold I-Bonds need their transactions.
  const ibondAccountIds = useMemo(() => {
    if (!allLoaded) return [];
    return accounts
      .filter((a) => {
        const hs = holdingsMap[a.id] ?? [];
        return hs.length > 0 ? hs.some((h) => isIBond(h, a)) : isIBond(null, a);
      })
      .map((a) => a.id);
  }, [accounts, holdingsMap, allLoaded]);
  const ibondKey = ibondAccountIds.join(",");

  useEffect(() => {
    if (!ibondKey) return;
    let cancelled = false;
    setLoadingBuys(true);
    Promise.all(ibondKey.split(",").map((id) =>
      listInvestmentTransactionRollup(id)
        .then((r) => [id, r] as const)
        .catch(() => [id, null] as const),
    ))
      .then((results) => {
        if (cancelled) return;
        const out: IBondBuys = {};
        for (const [id, r] of results) {
          if (!r) continue; // unknown: falls back to holding dates
          out[id] = r.positions
            .flatMap((p) => p.transactions)
            .filter((t) => t.type === "buy" && (RE_IBOND.test(`${t.name} ${t.ticker_symbol ?? ""}`) || ibondOnly(id)))
            .map((t) => ({ date: new Date(t.date), amount: Math.abs(Number(t.amount)) }));
        }
        setBuys(out);
      })
      .finally(() => { if (!cancelled) setLoadingBuys(false); });
    return () => { cancelled = true; };

    // An account whose positions are all I-Bonds (TreasuryDirect): every buy counts.
    function ibondOnly(id: string): boolean {
      const a = accounts.find((x) => x.id === id);
      const hs = holdingsMap[id] ?? [];
      return !!a && hs.length > 0 && hs.every((h) => isIBond(h, a));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ibondKey]);

  const data = useMemo(() => {
    const memberNames = Object.fromEntries(members.map((m) => [m.id, m.full_name]));
    const entityNames = Object.fromEntries(entities.map((e) => [e.id, e.name]));
    const total = accounts.reduce((s, a) => s + value(a), 0);

    const owners = new Map<string, OwnerRow>();
    const insts = new Map<string, InstRow & { capacities: Map<string, { label: string; value: number }> }>();

    for (const a of accounts) {
      const v = value(a);
      const owner = ownerOf(a, memberNames, entityNames);
      const kind = accountKind(a);

      const o = owners.get(owner.key) ?? { ...owner, taxable: 0, retirement: 0, crypto: 0, total: 0, count: 0 };
      o[kind] += v;
      o.total += v;
      o.count += 1;
      owners.set(owner.key, o);

      const ik = institutionKey(a);
      const inst = insts.get(ik.key) ?? {
        key: ik.key, label: ik.label, total: 0, count: 0,
        coverage: { sipc: 0, treasury: 0, plan: 0, crypto: 0 }, overSipc: [], capacities: new Map(),
      };
      inst.total += v;
      inst.count += 1;
      const cov = coverageOf(a);
      inst.coverage[cov] += v;
      if (cov === "sipc") {
        const capacity = capacityOf(a, owner);
        const cap = inst.capacities.get(capacity.key) ?? { label: capacity.label, value: 0 };
        cap.value += v;
        inst.capacities.set(capacity.key, cap);
      }
      insts.set(ik.key, inst);
    }

    const ownerRows = Array.from(owners.values()).sort(
      (x, y) => OWNER_KIND_RANK[x.kind] - OWNER_KIND_RANK[y.kind] || y.total - x.total,
    );
    const instRows: InstRow[] = Array.from(insts.values())
      .map(({ capacities, ...r }) => ({
        ...r,
        overSipc: Array.from(capacities.values())
          .filter((c) => c.value > SIPC_LIMIT)
          .map((c) => ({ capacity: c.label, value: c.value })),
      }))
      .filter((r) => r.total > 0)
      .sort((x, y) => y.total - x.total);

    return { total, ownerRows, instRows };
  }, [accounts, members, entities]);

  const liq = useMemo(
    () => (allLoaded ? buildLiquidity(accounts, holdingsMap, buys, now) : null),
    [accounts, holdingsMap, buys, now, allLoaded],
  );

  if (accounts.length === 0 || data.total <= 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
      <OwnerCard rows={data.ownerRows} total={data.total} fmt={fmt} />
      <InstitutionCard rows={data.instRows} total={data.total} fmt={fmt} us={us} />
      {us && (liq ? (
        <LiquidityCard liq={liq} total={data.total} fmt={fmt} loadingBuys={loadingBuys} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow px-5 py-4 text-xs text-gray-400">Loading liquidity…</div>
      ))}
      <FreshnessCard accounts={accounts} fmt={fmt} now={now} />
    </div>
  );
}
