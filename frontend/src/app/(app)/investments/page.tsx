"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  listAccounts,
  listHouseholdMembers,
  listHoldings,
  createHolding,
  updateHolding,
  deleteHolding,
  getTickerInfo,
  cryptoSearch,
  getRefreshStatus,
  getMarketStatus,
  refreshInvestmentPrices,
  listInvestmentTransactionRollup,
  createInvestmentTransaction,
  updateInvestmentTransaction,
  deleteInvestmentTransaction,
  importInvestmentTransactionsCSV,
  downloadInvestmentCSVTemplate,
  Account,
  Holding,
  HoldingCreate,
  HoldingUpdate,
  UserResponse,
  RefreshStatus,
  MarketStatus,
  InvestmentTransaction,
  InvestmentTransactionCreate,
  InvestmentTransactionUpdate,
  TickerRollup,
  AccountTransactionSummary,
  CSVImportResult,
} from "@/lib/api";
import { useCurrency } from "@/lib/currency";

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

function isCrypto(subtype: string | null): boolean {
  return subtype?.toLowerCase() === "crypto exchange";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString();
}

function totalBalance(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + (a.current_balance ? Number(a.current_balance) : 0), 0);
}

// ─── Holdings Table ───────────────────────────────────────────────────────────

const BLANK_ADD: HoldingCreate = { ticker_symbol: "", name: "", quantity: "", cost_basis: "", current_value: "", asset_class: null, coingecko_id: null };

// Convert empty strings to null so Pydantic accepts optional Decimal fields
function nullifyEmpty<T extends Record<string, unknown>>(form: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    out[k] = v === "" ? null : v;
  }
  return out as T;
}

function HoldingsTable({
  holdings, loading, isManual, accountId, onChanged, isCryptoAccount,
}: {
  holdings: Holding[];
  loading: boolean;
  isManual: boolean;
  accountId: string;
  onChanged: () => void;
  isCryptoAccount?: boolean;
}) {
  const { fmt: fmtRaw, locale } = useCurrency();
  const fmt = (val: string | number | null | undefined, decimals = 0): string => {
    if (val === null || val === undefined || val === "") return "—";
    return fmtRaw(Number(val), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<HoldingUpdate>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<HoldingCreate>(BLANK_ADD);
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState("");
  const [lookingUpTicker, setLookingUpTicker] = useState(false);
  const tickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addLastPrice = useRef<number | null>(null);
  const editLastPrice = useRef<number | null>(null);

  function calcValue(price: number | null, qty: string | number | null | undefined): string {
    const q = Number(qty);
    if (!price || !qty || q <= 0) return "";
    return (price * q).toFixed(2);
  }

  function scheduleLookup(ticker: string, isAdd: boolean) {
    if (tickerTimer.current) clearTimeout(tickerTimer.current);
    if (!ticker) return;
    tickerTimer.current = setTimeout(async () => {
      setLookingUpTicker(true);
      try {
        if (isCryptoAccount) {
          const results = await cryptoSearch(ticker);
          if (results.length > 0) {
            const top = results[0];
            const price = top.last_price ?? null;
            if (isAdd) {
              addLastPrice.current = price;
              setAddForm((p) => ({
                ...p,
                ticker_symbol: top.symbol.toUpperCase(),
                name: top.name,
                coingecko_id: top.id,
                asset_class: "crypto",
                current_value: calcValue(price, p.quantity) || p.current_value,
              }));
            } else {
              editLastPrice.current = price;
              setEditForm((p) => ({
                ...p,
                ticker_symbol: top.symbol.toUpperCase(),
                name: top.name,
                coingecko_id: top.id,
                asset_class: "crypto",
                current_value: calcValue(price, p.quantity) || p.current_value,
              }));
            }
          }
        } else {
          const info = await getTickerInfo(ticker);
          const resolvedName = info.found ? (info.name ?? "Unknown") : "Unknown";
          const price = info.last_price ?? null;
          if (isAdd) {
            addLastPrice.current = price;
            setAddForm((p) => ({ ...p, name: resolvedName, current_value: calcValue(price, p.quantity) || p.current_value }));
          } else {
            editLastPrice.current = price;
            setEditForm((p) => ({ ...p, name: resolvedName, current_value: calcValue(price, p.quantity) || p.current_value }));
          }
        }
      } catch {
        // silently ignore lookup errors
      } finally {
        setLookingUpTicker(false);
      }
    }, 600);
  }

  function startEdit(h: Holding) {
    setEditingId(h.id);
    setEditForm({
      ticker_symbol: h.ticker_symbol ?? "",
      name: h.name ?? "",
      quantity: h.quantity,
      cost_basis: h.cost_basis ?? "",
      current_value: h.current_value ?? "",
      asset_class: h.asset_class ?? null,
      coingecko_id: h.coingecko_id ?? null,
    });
    setRowError("");
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true); setRowError("");
    try {
      await updateHolding(editingId, nullifyEmpty(editForm as Record<string, unknown>) as HoldingUpdate);
      setEditingId(null);
      onChanged();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(holdingId: string) {
    if (!window.confirm("Delete this position?")) return;
    setSaving(true);
    try {
      await deleteHolding(holdingId);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAdd() {
    if (!addForm.quantity || Number(addForm.quantity) <= 0) {
      setRowError("Shares/quantity is required and must be > 0");
      return;
    }
    setSaving(true); setRowError("");
    try {
      await createHolding(accountId, nullifyEmpty(addForm as Record<string, unknown>) as HoldingCreate);
      setShowAddForm(false);
      setAddForm(BLANK_ADD);
      addLastPrice.current = null;
      onChanged();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="px-5 py-4 text-center text-sm text-gray-400">Loading holdings…</div>;
  }

  const totalValue = holdings.reduce((s, h) => s + Number(h.current_value ?? 0), 0);
  const allHaveCost = holdings.every((h) => h.cost_basis !== null);
  const totalCost = allHaveCost && holdings.length > 0 ? holdings.reduce((s, h) => s + Number(h.cost_basis ?? 0), 0) : null;
  const totalGain = totalCost !== null ? totalValue - totalCost : null;

  // Shared inline input style
  const inp = "border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="overflow-x-auto">
      {holdings.length === 0 && !showAddForm && (
        <div className="px-5 py-4 text-center text-sm text-gray-400">
          {isManual ? "No positions yet — add your first holding below." : "No holdings data — sync with Plaid to import positions."}
        </div>
      )}

      {(holdings.length > 0 || showAddForm) && (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium">Ticker</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-right font-medium">Shares</th>
              <th className="px-4 py-2 text-right font-medium">Current Value</th>
              <th className="px-4 py-2 text-right font-medium">Cost Basis</th>
              <th className="px-4 py-2 text-right font-medium">Gain / Loss</th>
              {isManual && <th className="px-4 py-2 w-16" />}
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              // ── Edit mode row ──────────────────────────────────────────
              if (editingId === h.id) {
                return (
                  <tr key={h.id} className="border-t border-blue-100 bg-blue-50/40">
                    <td className="px-4 py-2">
                      <input className={inp} placeholder={isCryptoAccount ? "BTC" : "AAPL"} value={editForm.ticker_symbol ?? ""} onChange={(e) => { const val = e.target.value.toUpperCase(); setEditForm((p) => ({ ...p, ticker_symbol: val })); scheduleLookup(val, false); }} />
                    </td>
                    <td className="px-4 py-2">
                      <input className={inp} placeholder={lookingUpTicker ? "Looking up…" : "Apple Inc."} value={editForm.name ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2">
                      <input className={`${inp} text-right`} type="number" step="any" placeholder="10" value={editForm.quantity ?? ""} onChange={(e) => { const qty = e.target.value; setEditForm((p) => ({ ...p, quantity: qty, current_value: calcValue(editLastPrice.current, qty) || p.current_value })); }} />
                    </td>
                    <td className="px-4 py-2">
                      <input className={`${inp} text-right`} type="number" step="any" placeholder="0.00" value={editForm.current_value ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, current_value: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2">
                      <input className={`${inp} text-right`} type="number" step="any" placeholder="0.00" value={editForm.cost_basis ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, cost_basis: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400 text-right">auto</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1 justify-end">
                        <button onClick={handleSaveEdit} disabled={saving} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">Save</button>
                        <button onClick={() => { setEditingId(null); setRowError(""); }} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200">Cancel</button>
                      </div>
                    </td>
                  </tr>
                );
              }

              // ── Read-only row ──────────────────────────────────────────
              const value = Number(h.current_value ?? 0);
              const cost = Number(h.cost_basis ?? 0);
              const hasCost = h.cost_basis !== null && cost > 0;
              const gain = hasCost ? value - cost : null;
              const gainPct = hasCost ? ((value - cost) / cost) * 100 : null;
              const gainPositive = gain !== null && gain >= 0;

              return (
                <tr key={h.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">
                    {h.ticker_symbol ? (
                      <a
                        href={
                          h.asset_class === "crypto" && h.coingecko_id
                            ? `https://www.coingecko.com/en/coins/${h.coingecko_id}`
                            : `https://finance.yahoo.com/quote/${h.ticker_symbol}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {h.ticker_symbol}
                        {h.asset_class === "crypto" && (
                          <span className="ml-1 text-xs font-normal text-yellow-600 font-sans">₿</span>
                        )}
                      </a>
                    ) : (
                      <span className="text-gray-400 font-sans font-normal">—</span>
                    )}
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
                  {isManual && (
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => startEdit(h)} title="Edit" className="p-1 text-gray-400 hover:text-blue-600 transition rounded hover:bg-blue-50">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-2.828 0L9 15v-2z" /></svg>
                        </button>
                        <button onClick={() => handleDelete(h.id)} disabled={saving} title="Delete" className="p-1 text-gray-400 hover:text-red-600 transition rounded hover:bg-red-50 disabled:opacity-50">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {/* ── Add new holding row ──────────────────────────────────── */}
            {showAddForm && (
              <tr className="border-t border-green-100 bg-green-50/40">
                <td className="px-4 py-2">
                  <input className={inp} placeholder={isCryptoAccount ? "BTC, ETH…" : "AAPL"} value={addForm.ticker_symbol ?? ""} onChange={(e) => { const val = e.target.value.toUpperCase(); setAddForm((p) => ({ ...p, ticker_symbol: val })); scheduleLookup(val, true); }} />
                </td>
                <td className="px-4 py-2">
                  <input className={inp} placeholder={lookingUpTicker ? "Looking up…" : isCryptoAccount ? "Auto-filled from search" : "Auto-filled from ticker"} value={addForm.name ?? ""} onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))} />
                </td>
                <td className="px-4 py-2">
                  <input className={`${inp} text-right`} type="number" step="any" placeholder="Shares *" value={addForm.quantity} onChange={(e) => { const qty = e.target.value; setAddForm((p) => ({ ...p, quantity: qty, current_value: calcValue(addLastPrice.current, qty) || p.current_value })); }} />
                </td>
                <td className="px-4 py-2">
                  <input className={`${inp} text-right`} type="number" step="any" placeholder="Auto from price × qty" value={addForm.current_value ?? ""} onChange={(e) => setAddForm((p) => ({ ...p, current_value: e.target.value }))} />
                </td>
                <td className="px-4 py-2">
                  <input className={`${inp} text-right`} type="number" step="any" placeholder="Total cost" value={addForm.cost_basis ?? ""} onChange={(e) => setAddForm((p) => ({ ...p, cost_basis: e.target.value }))} />
                </td>
                <td className="px-4 py-2 text-xs text-gray-400 text-right">auto</td>
                <td className="px-4 py-2">
                  <div className="flex gap-1 justify-end">
                    <button onClick={handleSaveAdd} disabled={saving} className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50">Add</button>
                    <button onClick={() => { setShowAddForm(false); setAddForm(BLANK_ADD); setRowError(""); addLastPrice.current = null; }} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200">Cancel</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          {holdings.length > 0 && (
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
                {isManual && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      )}

      {/* Add Position button and error */}
      {isManual && (
        <div className="px-4 py-2 border-t border-gray-100">
          {rowError && <p className="text-xs text-red-600 mb-1.5">{rowError}</p>}
          {!showAddForm && (
            <button
              onClick={() => { setShowAddForm(true); setEditingId(null); setRowError(""); }}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              Add Position
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Transaction type badge colors ───────────────────────────────────────────

const TYPE_BADGE: Record<string, string> = {
  buy: "bg-green-100 text-green-700",
  sell: "bg-red-100 text-red-700",
  dividend: "bg-blue-100 text-blue-700",
  split: "bg-purple-100 text-purple-700",
  transfer_in: "bg-teal-100 text-teal-700",
  transfer_out: "bg-orange-100 text-orange-700",
  other: "bg-gray-100 text-gray-600",
};

const TXN_TYPE_OPTIONS = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "dividend", label: "Dividend" },
  { value: "split", label: "Stock Split" },
  { value: "transfer_in", label: "Transfer In" },
  { value: "transfer_out", label: "Transfer Out" },
  { value: "other", label: "Other" },
];

// ─── Add / Edit Transaction Modal ────────────────────────────────────────────

function AddTransactionModal({
  accountId,
  initial,
  onClose,
  onSaved,
}: {
  accountId: string;
  initial: InvestmentTransaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    ticker_symbol: initial?.ticker_symbol ?? "",
    name: initial?.name ?? "",
    type: initial?.type ?? "buy",
    date: initial?.date ? initial.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    quantity: initial?.quantity ?? "",
    price: initial?.price ?? "",
    amount: initial?.amount ?? "",
    fees: initial?.fees ?? "",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const tickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-compute amount from qty * price
  useEffect(() => {
    const qty = parseFloat(form.quantity || "0");
    const price = parseFloat(form.price || "0");
    if (qty > 0 && price > 0) {
      setForm((p) => ({ ...p, amount: (qty * price).toFixed(2) }));
    }
  }, [form.quantity, form.price]);

  function scheduleLookup(ticker: string) {
    if (tickerTimer.current) clearTimeout(tickerTimer.current);
    if (!ticker) return;
    tickerTimer.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        const info = await getTickerInfo(ticker);
        if (info.found && info.name) {
          setForm((p) => ({ ...p, name: info.name! }));
        }
      } catch {
        // ignore lookup errors
      } finally {
        setLookingUp(false);
      }
    }, 600);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ticker_symbol) { setError("Ticker symbol is required"); return; }
    if (!form.amount || Number(form.amount) <= 0) { setError("Amount must be greater than 0"); return; }
    setSaving(true); setError("");
    try {
      const payload: InvestmentTransactionCreate = {
        ticker_symbol: form.ticker_symbol.toUpperCase(),
        name: form.name || form.ticker_symbol.toUpperCase(),
        type: form.type,
        date: new Date(form.date + "T00:00:00").toISOString(),
        quantity: form.quantity || null,
        price: form.price || null,
        amount: form.amount,
        fees: form.fees || null,
        notes: form.notes || null,
      };
      if (initial) {
        await updateInvestmentTransaction(initial.id, payload as InvestmentTransactionUpdate);
      } else {
        await createInvestmentTransaction(accountId, payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const showQty = !["dividend", "other"].includes(form.type);
  const inp = "border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{initial ? "Edit Transaction" : "Add Transaction"}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ticker Symbol *</label>
              <input
                className={inp}
                placeholder="AAPL"
                value={form.ticker_symbol}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setForm((p) => ({ ...p, ticker_symbol: val }));
                  scheduleLookup(val);
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Security Name</label>
              <input
                className={inp}
                placeholder={lookingUp ? "Looking up…" : "Auto-filled from ticker"}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="txn-type" className="block text-xs font-medium text-gray-600 mb-1">Transaction Type *</label>
              <select id="txn-type" className={inp} value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
                {TXN_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="txn-date" className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input id="txn-date" aria-label="Transaction date" className={inp} type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
            </div>
          </div>

          {showQty && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Quantity (Shares)</label>
                <input className={`${inp} text-right`} type="number" step="any" min="0" placeholder="10" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Price per Share ($)</label>
                <input className={`${inp} text-right`} type="number" step="any" min="0" placeholder="150.00" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total Amount ($) *</label>
              <input className={`${inp} text-right`} type="number" step="any" min="0" placeholder="1500.00" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fees / Commission ($)</label>
              <input className={`${inp} text-right`} type="number" step="any" min="0" placeholder="0.00" value={form.fees} onChange={(e) => setForm((p) => ({ ...p, fees: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea className={inp} rows={2} placeholder="Optional notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : initial ? "Save Changes" : "Add Transaction"}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm text-gray-700 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── CSV Import Modal ─────────────────────────────────────────────────────────

const CSV_PREVIEW_COLS = ["ticker_symbol", "type", "date", "quantity", "price", "amount", "fees"];

function CSVImportModal({
  accountId,
  onClose,
  onImported,
}: {
  accountId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<CSVImportResult | null>(null);
  const [parseError, setParseError] = useState("");

  function parseCSVPreview(f: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) { setParseError("CSV appears empty"); return; }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const required = ["ticker_symbol", "type", "date", "amount"];
      const missing = required.filter((r) => !headers.includes(r));
      if (missing.length > 0) { setParseError(`Missing required columns: ${missing.join(", ")}`); return; }
      const errors: string[] = [];
      const rows: Record<string, string>[] = [];
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        const vals = lines[i].split(",");
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = (vals[idx] ?? "").trim(); });
        rows.push(row);
        if (!row.ticker_symbol) errors.push(`Row ${i + 1}: missing ticker_symbol`);
        if (!row.amount) errors.push(`Row ${i + 1}: missing amount`);
      }
      setPreview(rows);
      setPreviewErrors(errors);
      setStep("preview");
    };
    reader.readAsText(f);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setParseError("");
    parseCSVPreview(f);
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    try {
      const res = await importInvestmentTransactionsCSV(accountId, file);
      setResult(res);
      if (res.imported > 0) onImported();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Import Transactions from CSV</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {result ? (
            <div>
              <div className={`rounded-lg p-4 ${result.imported > 0 ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"}`}>
                <p className={`font-medium text-sm ${result.imported > 0 ? "text-green-800" : "text-amber-800"}`}>
                  {result.imported > 0 ? `Successfully imported ${result.imported} transaction${result.imported !== 1 ? "s" : ""}` : "No transactions imported"}
                </p>
              </div>
              {result.errors.length > 0 && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-700 mb-1">{result.errors.length} row{result.errors.length !== 1 ? "s" : ""} had errors:</p>
                  <ul className="text-xs text-red-600 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.errors.map((err, i) => <li key={i}>• {err}</li>)}
                  </ul>
                </div>
              )}
              <button type="button" onClick={onClose} className="mt-4 w-full bg-gray-900 text-white text-sm font-medium py-2 rounded-lg hover:bg-gray-800">Close</button>
            </div>
          ) : step === "upload" ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Download the template to see the required format, then upload your filled CSV.</p>
              <button
                type="button"
                onClick={() => downloadInvestmentCSVTemplate()}
                className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download Template
              </button>
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:border-blue-300 transition">
                <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" id="csv-upload" />
                <label htmlFor="csv-upload" className="cursor-pointer">
                  <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <p className="text-sm font-medium text-gray-700">Click to select CSV file</p>
                  <p className="text-xs text-gray-400 mt-1">or drag and drop</p>
                </label>
              </div>
              {parseError && <p className="text-xs text-red-600">{parseError}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Preview (first 5 rows of {file?.name})</p>
                <button type="button" onClick={() => { setStep("upload"); setPreview([]); setPreviewErrors([]); }} className="text-xs text-blue-600 hover:text-blue-800">Change file</button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                      {CSV_PREVIEW_COLS.map((c) => <th key={c} className="px-3 py-2 text-left font-medium">{c.replace("_", " ")}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {CSV_PREVIEW_COLS.map((c) => <td key={c} className="px-3 py-1.5 text-gray-700">{c === "date" && !row[c] ? <span className="text-gray-400 italic">today</span> : (row[c] || "—")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewErrors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-amber-700 mb-1">Validation warnings (these rows will be skipped):</p>
                  <ul className="text-xs text-amber-600 space-y-0.5">
                    {previewErrors.map((err, i) => <li key={i}>• {err}</li>)}
                  </ul>
                </div>
              )}
              {parseError && <p className="text-xs text-red-600">{parseError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={handleImport} disabled={importing} className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {importing ? "Importing…" : "Import Transactions"}
                </button>
                <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm text-gray-700 rounded-lg hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Transaction Activity View ────────────────────────────────────────────────

function TransactionActivityView({
  accountId,
  holdings,
  onSyncedToPositions,
}: {
  accountId: string;
  holdings: Holding[];
  onSyncedToPositions?: () => void;
}) {
  const { fmt: fmtRaw, locale } = useCurrency();
  const fmt = (val: string | number | null | undefined, decimals = 0): string => {
    if (val === null || val === undefined || val === "") return "—";
    return fmtRaw(Number(val), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  const [summary, setSummary] = useState<AccountTransactionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTxn, setEditingTxn] = useState<InvestmentTransaction | null>(null);
  const [showCSVModal, setShowCSVModal] = useState(false);
  const [priceMap, setPriceMap] = useState<Record<string, number | null>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");

  const fetchRollup = useCallback(() => {
    setLoading(true);
    listInvestmentTransactionRollup(accountId)
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load transactions"))
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => { fetchRollup(); }, [fetchRollup]);

  // Build ticker → current_value map from synced holdings
  const holdingsValueMap: Record<string, number> = {};
  for (const h of holdings) {
    if (h.ticker_symbol && h.current_value) {
      holdingsValueMap[h.ticker_symbol.toUpperCase()] = Number(h.current_value);
    }
  }

  // Fetch live prices for tickers not already in holdings
  useEffect(() => {
    if (!summary || summary.positions.length === 0) return;
    const tickers = summary.positions
      .map((p) => p.ticker_symbol)
      .filter((t) => holdingsValueMap[t] === undefined);
    if (tickers.length === 0) return;
    Promise.all(
      tickers.map((ticker) =>
        getTickerInfo(ticker)
          .then((info) => ({ ticker, price: info.last_price }))
          .catch(() => ({ ticker, price: null }))
      )
    ).then((results) => {
      const map: Record<string, number | null> = {};
      for (const { ticker, price } of results) map[ticker] = price;
      setPriceMap(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  async function handleSyncToPositions() {
    if (!summary) return;
    const toSync = summary.positions.filter((p) => Number(p.net_shares) > 0);
    if (toSync.length === 0) return;
    setSyncing(true);
    try {
      await Promise.all(
        toSync.map((pos) => {
          const netShares = Number(pos.net_shares);
          const livePrice = priceMap[pos.ticker_symbol] ?? null;
          const currentValue = livePrice !== null ? (livePrice * netShares).toFixed(2) : null;
          return createHolding(accountId, {
            ticker_symbol: pos.ticker_symbol,
            name: pos.name,
            quantity: String(pos.net_shares),
            cost_basis: pos.total_cost_basis ? String(pos.total_cost_basis) : null,
            current_value: currentValue,
          });
        })
      );
      onSyncedToPositions?.();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed — check console");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeleteTxn(txnId: string) {
    if (!window.confirm("Delete this transaction?")) return;
    try {
      await deleteInvestmentTransaction(txnId);
      fetchRollup();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function toggleTicker(ticker: string) {
    setExpandedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      return next;
    });
  }

  if (loading) return <div className="px-5 py-6 text-center text-sm text-gray-400">Loading activity…</div>;
  if (error) return <div className="px-5 py-4 text-sm text-red-600">{error}</div>;

  const positions = summary?.positions ?? [];

  return (
    <div>
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-100">
        <p className="text-xs text-gray-500">{positions.length} position{positions.length !== 1 ? "s" : ""} with transaction history</p>
        <div className="flex gap-2">
          {positions.length > 0 && onSyncedToPositions && (
            <button
              type="button"
              onClick={handleSyncToPositions}
              disabled={syncing}
              className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2.5 py-1.5 transition disabled:opacity-50"
              title="Create holdings in Positions tab from your transaction rollup"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {syncing ? "Syncing…" : "Sync to Positions"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCSVModal(true)}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => { setEditingTxn(null); setShowAddModal(true); }}
            className="inline-flex items-center gap-1 text-xs bg-blue-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-blue-700 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Add Transaction
          </button>
        </div>
      </div>

      {syncError && (
        <div className="mx-4 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Sync failed: {syncError}
        </div>
      )}

      {positions.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">No transactions yet</p>
          <p className="text-xs text-gray-400">Add your first transaction or import from CSV</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="w-8 px-3 py-2" aria-label="Expand" />
                <th className="px-3 py-2 text-left font-medium">Ticker</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Shares</th>
                <th className="px-3 py-2 text-right font-medium">Avg Cost</th>
                <th className="px-3 py-2 text-right font-medium">Cost Basis</th>
                <th className="px-3 py-2 text-right font-medium">Current Val</th>
                <th className="px-3 py-2 text-right font-medium">Unrealized G/L</th>
                <th className="px-3 py-2 text-right font-medium">Txns</th>
                <th className="px-3 py-2 text-right font-medium">Last Date</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const holdingVal = holdingsValueMap[pos.ticker_symbol] ?? null;
                const livePrice = priceMap[pos.ticker_symbol] ?? null;
                const netShares = Number(pos.net_shares);
                const currentVal = holdingVal ?? (livePrice !== null && netShares > 0 ? livePrice * netShares : null);
                const costBasis = pos.total_cost_basis ? Number(pos.total_cost_basis) : null;
                const unrealized = currentVal !== null && costBasis !== null ? currentVal - costBasis : null;
                const unrealizedPct = costBasis && costBasis > 0 && unrealized !== null ? (unrealized / costBasis) * 100 : null;
                const isExpanded = expandedTickers.has(pos.ticker_symbol);
                return (
                  <React.Fragment key={pos.ticker_symbol}>
                    <tr
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleTicker(pos.ticker_symbol)}
                    >
                      <td className="px-3 py-2.5 text-center text-gray-400">
                        <svg className={`w-3.5 h-3.5 transition-transform inline ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-blue-600">
                        <a href={`https://finance.yahoo.com/quote/${pos.ticker_symbol}`} target="_blank" rel="noopener noreferrer" className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {pos.ticker_symbol}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 max-w-[140px] truncate">{pos.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{fmtQty(pos.net_shares)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{pos.avg_cost_per_share ? fmt(pos.avg_cost_per_share, 2) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{costBasis !== null ? fmt(costBasis, 2) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">{currentVal !== null ? fmt(currentVal, 2) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {unrealized !== null ? (
                          <span className={unrealized >= 0 ? "text-green-600" : "text-red-600"}>
                            {unrealized >= 0 ? "+" : ""}{fmt(unrealized, 2)}
                            {unrealizedPct !== null && (
                              <span className="ml-1 text-xs opacity-75">({unrealizedPct >= 0 ? "+" : ""}{unrealizedPct.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums">{pos.transaction_count}</td>
                      <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                        {new Date(pos.last_transaction_date).toLocaleDateString(locale, { month: "short", day: "numeric", year: "2-digit" })}
                      </td>
                    </tr>
                    {isExpanded && pos.transactions.map((txn) => (
                      <tr key={txn.id} className="border-t border-gray-50 bg-gray-50/60 text-xs">
                        <td className="px-3 py-1.5" />
                        <td className="px-3 py-1.5" colSpan={2}>
                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[txn.type] ?? "bg-gray-100 text-gray-600"}`}>
                            {txn.type.replace("_", " ").toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-600 tabular-nums">{txn.quantity ? fmtQty(txn.quantity) : "—"}</td>
                        <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{txn.price ? fmt(txn.price, 2) : "—"}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-gray-700 tabular-nums">{fmt(txn.amount, 2)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400 tabular-nums">{txn.fees ? fmt(txn.fees, 2) : "—"}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400 truncate max-w-[120px]" colSpan={2}>{txn.notes || "—"}</td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <span className="text-gray-400 mr-1">{new Date(txn.date).toLocaleDateString(locale, { month: "short", day: "numeric", year: "2-digit" })}</span>
                            <button type="button" aria-label="Edit transaction" onClick={(e) => { e.stopPropagation(); setEditingTxn(txn); setShowAddModal(true); }} className="p-0.5 text-gray-400 hover:text-blue-600 rounded">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-2.828 0L9 15v-2z" /></svg>
                            </button>
                            <button type="button" aria-label="Delete transaction" onClick={(e) => { e.stopPropagation(); handleDeleteTxn(txn.id); }} className="p-0.5 text-gray-400 hover:text-red-600 rounded">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <AddTransactionModal
          accountId={accountId}
          initial={editingTxn}
          onClose={() => { setShowAddModal(false); setEditingTxn(null); }}
          onSaved={fetchRollup}
        />
      )}
      {showCSVModal && (
        <CSVImportModal
          accountId={accountId}
          onClose={() => setShowCSVModal(false)}
          onImported={fetchRollup}
        />
      )}
    </div>
  );
}

// ─── Account Row ─────────────────────────────────────────────────────────────

function AccountRow({
  account, ownerName, expanded, onToggle, holdings, holdingsLoading, onHoldingChanged, isCryptoAccount,
}: {
  account: Account;
  ownerName?: string;
  expanded: boolean;
  onToggle: () => void;
  holdings: Holding[];
  holdingsLoading: boolean;
  onHoldingChanged: (accountId: string) => void;
  isCryptoAccount?: boolean;
}) {
  const { fmt: fmtRaw } = useCurrency();
  const fmt = (val: string | number | null | undefined, decimals = 0): string => {
    if (val === null || val === undefined || val === "") return "—";
    return fmtRaw(Number(val), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  const [activeTab, setActiveTab] = useState<"positions" | "activity">("positions");
  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        type="button"
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
          {/* Positions / Activity tab toggle */}
          <div className="px-4 pt-2.5 pb-0 flex gap-1 border-b border-gray-100">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition ${activeTab === "positions" ? "bg-white border border-b-white border-gray-200 text-blue-600 -mb-px" : "text-gray-500 hover:text-gray-700"}`}
              onClick={() => setActiveTab("positions")}
            >
              Positions
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition ${activeTab === "activity" ? "bg-white border border-b-white border-gray-200 text-blue-600 -mb-px" : "text-gray-500 hover:text-gray-700"}`}
              onClick={() => setActiveTab("activity")}
            >
              Activity
            </button>
          </div>
          {activeTab === "positions" ? (
            <HoldingsTable
              holdings={holdings}
              loading={holdingsLoading}
              isManual={account.is_manual}
              accountId={account.id}
              onChanged={() => onHoldingChanged(account.id)}
              isCryptoAccount={isCryptoAccount}
            />
          ) : (
            <TransactionActivityView
              accountId={account.id}
              holdings={holdings}
              onSyncedToPositions={() => {
                onHoldingChanged(account.id);
                setActiveTab("positions");
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Segment Section ──────────────────────────────────────────────────────────

function Segment({
  title, subtitle, accounts, accentClass, emptyText, memberMap,
  expandedId, onToggle, holdingsMap, holdingsLoadingMap, onHoldingChanged, isCryptoSegment,
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
  onHoldingChanged: (accountId: string) => void;
  isCryptoSegment?: boolean;
}) {
  const { fmt: fmtRaw } = useCurrency();
  const fmt = (val: string | number | null | undefined, decimals = 0): string => {
    if (val === null || val === undefined || val === "") return "—";
    return fmtRaw(Number(val), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
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
              onHoldingChanged={onHoldingChanged}
              isCryptoAccount={isCryptoSegment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InvestmentsPage() {
  const { fmt: fmtRaw } = useCurrency();
  const fmt = (val: string | number | null | undefined, decimals = 0): string => {
    if (val === null || val === undefined || val === "") return "—";
    return fmtRaw(Number(val), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<UserResponse[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [holdingsMap, setHoldingsMap] = useState<Record<string, Holding[]>>({});
  const [holdingsLoadingMap, setHoldingsLoadingMap] = useState<Record<string, boolean>>({});

  // ── Price refresh state ──────────────────────────────────────────────────
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToast, setRefreshToast] = useState("");

  useEffect(() => {
    Promise.all([listAccounts(), listHouseholdMembers()])
      .then(([all, mems]) => {
        setAccounts(all.filter((a) => a.type === "investment" && !a.is_hidden));
        setMembers(mems);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  // Fetch refresh + market status; poll every 60s
  useEffect(() => {
    function fetchStatus() {
      getRefreshStatus().then(setRefreshStatus).catch(() => {});
      getMarketStatus().then(setMarketStatus).catch(() => {});
    }
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, []);

  function refetchHoldings(accountId: string) {
    setHoldingsLoadingMap((lm) => ({ ...lm, [accountId]: true }));
    listHoldings(accountId)
      .then((h) => setHoldingsMap((m) => ({ ...m, [accountId]: h })))
      .catch(() => {})
      .finally(() => setHoldingsLoadingMap((lm) => ({ ...lm, [accountId]: false })));
    // Also refresh account list so Total Value cards stay in sync
    listAccounts()
      .then((all) => setAccounts(all.filter((a) => a.type === "investment" && !a.is_hidden)))
      .catch(() => {});
  }

  async function handleRefreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await refreshInvestmentPrices();
      // Re-fetch accounts to get updated current_balance (drives Total Value cards)
      listAccounts()
        .then((all) => setAccounts(all.filter((a) => a.type === "investment" && !a.is_hidden)))
        .catch(() => {});
      // Re-fetch holdings for all currently expanded accounts
      const expanded = Object.keys(holdingsMap);
      for (const id of expanded) {
        setHoldingsLoadingMap((lm) => ({ ...lm, [id]: true }));
        listHoldings(id)
          .then((h) => setHoldingsMap((m) => ({ ...m, [id]: h })))
          .catch(() => {})
          .finally(() => setHoldingsLoadingMap((lm) => ({ ...lm, [id]: false })));
      }
      // Update refresh status
      getRefreshStatus().then(setRefreshStatus).catch(() => {});
      setRefreshToast(`Updated ${result.refreshed} holding${result.refreshed !== 1 ? "s" : ""}`);
      setTimeout(() => setRefreshToast(""), 4000);
    } catch {
      setRefreshToast("Refresh failed");
      setTimeout(() => setRefreshToast(""), 3000);
    } finally {
      setRefreshing(false);
    }
  }

  const handleToggle = useCallback((accountId: string) => {
    setExpandedId((prev) => {
      if (prev === accountId) return null;

      // Fetch holdings on first expand
      setHoldingsMap((m) => {
        if (m[accountId] !== undefined) return m; // already loaded
        setHoldingsLoadingMap((lm) => ({ ...lm, [accountId]: true }));
        listHoldings(accountId)
          .then((h) => setHoldingsMap((cur) => ({ ...cur, [accountId]: h })))
          .catch(() => setHoldingsMap((cur) => ({ ...cur, [accountId]: [] })))
          .finally(() => setHoldingsLoadingMap((lm) => ({ ...lm, [accountId]: false })));
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

  const crypto = filtered.filter((a) => isCrypto(a.subtype));
  const brokerage = filtered.filter((a) => !isRetirement(a.subtype) && !isCrypto(a.subtype));
  const retirement = filtered.filter((a) => isRetirement(a.subtype));
  const totalCrypto = totalBalance(crypto);
  const totalBrokerage = totalBalance(brokerage);
  const totalRetirement = totalBalance(retirement);
  const totalAll = totalBrokerage + totalRetirement + totalCrypto;

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
              aria-label="Filter by owner"
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Crypto & Digital Assets</p>
          <p className="text-2xl font-bold text-yellow-600">{loading ? "…" : fmt(totalCrypto)}</p>
          <p className="text-xs text-gray-400 mt-1">{crypto.length} account{crypto.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Price refresh status bar */}
      <div className="flex flex-wrap items-center gap-3 mb-5 bg-white rounded-xl shadow border border-gray-100 px-4 py-3">
        {/* Market status badge */}
        {marketStatus && (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            marketStatus.is_open
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-500"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${marketStatus.is_open ? "bg-green-500" : "bg-gray-400"}`} />
            {marketStatus.is_open ? "Market Open" : "Market Closed"}
          </span>
        )}

        {/* Crypto 24/7 badge */}
        {crypto.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
            Crypto: 24/7
          </span>
        )}

        {/* Last updated */}
        <span className="text-xs text-gray-400">
          Updated: <span className="text-gray-600 font-medium">
            {refreshStatus ? relativeTime(refreshStatus.last_refresh) : "—"}
          </span>
        </span>

        <div className="flex-1" />

        {/* Toast */}
        {refreshToast && (
          <span className="text-xs font-medium text-green-600">{refreshToast}</span>
        )}

        {/* Refresh Now button */}
        <button
          type="button"
          onClick={handleRefreshNow}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {refreshing ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {refreshing ? "Refreshing…" : "Refresh Now"}
        </button>
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
            onHoldingChanged={refetchHoldings}
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
            onHoldingChanged={refetchHoldings}
          />
          <Segment
            title="Crypto & Digital Assets"
            subtitle="Bitcoin, Ethereum, and other cryptocurrency holdings — prices refresh 24/7 via CoinGecko"
            accounts={crypto}
            accentClass="text-yellow-600"
            emptyText={'No crypto accounts. Add a manual account with subtype "Crypto Exchange" (e.g. Coinbase, Binance, Kraken).'}
            memberMap={memberMap}
            expandedId={expandedId}
            onToggle={handleToggle}
            holdingsMap={holdingsMap}
            holdingsLoadingMap={holdingsLoadingMap}
            onHoldingChanged={refetchHoldings}
            isCryptoSegment={true}
          />
        </div>
      )}
    </div>
  );
}
