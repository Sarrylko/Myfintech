"use client";

import { useEffect, useRef, useState } from "react";
import {
  Receipt,
  confirmReceiptSplits,
  deleteReceipt,
  getReceipt,
  reparseReceipt,
  uploadReceipt,
} from "@/lib/api";

const TAXONOMY: { category: string; subcategories: string[] }[] = [
  { category: "Housing", subcategories: ["Mortgage / Rent", "Property Tax", "HOA Fees", "Home Insurance", "Maintenance & Repairs", "Furnishings", "Cleaning Services", "Lawn / Snow Care", "Security Systems"] },
  { category: "Utilities", subcategories: ["Electricity", "Water & Sewer", "Gas Utility", "Trash / Recycling", "Internet", "Cable / Streaming TV", "Mobile Phone"] },
  { category: "Food & Dining", subcategories: ["Groceries", "Restaurants", "Coffee Shops", "Fast Food", "Food Delivery", "Alcohol & Bars"] },
  { category: "Transportation", subcategories: ["Fuel", "Parking", "Tolls", "Public Transit", "Rideshare (Uber/Lyft)", "Car Payment", "Car Insurance", "Vehicle Maintenance", "DMV / Registration"] },
  { category: "Health & Medical", subcategories: ["Doctor Visits", "Dental", "Vision", "Pharmacy", "Health Insurance", "Therapy / Mental Health", "Fitness / Gym"] },
  { category: "Shopping", subcategories: ["General Merchandise", "Clothing", "Electronics", "Home Improvement", "Gifts", "Personal Care Products"] },
  { category: "Education", subcategories: ["Tuition", "School Supplies", "Courses / Training", "Books", "Kids Activities"] },
  { category: "Entertainment", subcategories: ["Movies", "Events / Concerts", "Streaming Services", "Gaming", "Hobbies", "Subscriptions"] },
  { category: "Personal Care", subcategories: ["Salon / Spa", "Haircuts", "Cosmetics", "Massage", "Wellness"] },
  { category: "Financial", subcategories: ["Bank Fees", "Loan Payments", "Interest Paid", "Tax Payments"] },
  { category: "Travel", subcategories: ["Flights", "Hotels", "Vacation Rentals", "Car Rental", "Travel Dining"] },
  { category: "Pets", subcategories: ["Pet Food & Supplies", "Vet Visits", "Grooming"] },
  { category: "Taxes & Fees", subcategories: ["Sales Tax", "Service Fee", "Delivery Fee"] },
  { category: "Miscellaneous", subcategories: ["Cash Withdrawal", "Uncategorized", "Adjustment"] },
];

const ALL_CATEGORIES = TAXONOMY.flatMap((t) => [t.category, ...t.subcategories]);

type Provider = "local" | "claude";

interface EditableLine {
  id?: string;
  description: string;
  amount: string;
  ai_category: string;
  notes: string;
}

interface Props {
  transactionId: string;
  transactionAmount: number;
  transactionName: string;
  onClose: () => void;
  onConfirmed: () => void;
}

// ─── State machine ────────────────────────────────────────────────────────────
type ModalState =
  | { view: "empty" }                        // no receipt, no file selected
  | { view: "preview"; file: File; previewUrl: string | null; isPdf: boolean }  // file selected, choosing provider
  | { view: "uploading" }                    // uploading to server
  | { view: "parsing"; receipt: Receipt }    // waiting for AI
  | { view: "parsed"; receipt: Receipt }     // line items ready for review
  | { view: "failed"; receipt: Receipt }     // parse error
  | { view: "existing_parsed"; receipt: Receipt }   // already has a receipt, parsed
  | { view: "existing_parsing"; receipt: Receipt };  // already has a receipt, still parsing

export default function ReceiptModal({
  transactionId,
  transactionAmount,
  transactionName,
  onClose,
  onConfirmed,
}: Props) {
  const [state, setState] = useState<ModalState>({ view: "empty" });
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On open, check if a receipt already exists
  useEffect(() => {
    (async () => {
      try {
        const r = await getReceipt(transactionId);
        if (r.status === "parsed") {
          setState({ view: "existing_parsed", receipt: r });
          initLines(r);
        } else if (r.status === "failed") {
          setState({ view: "failed", receipt: r });
        } else {
          setState({ view: "existing_parsing", receipt: r });
          startPolling();
        }
      } catch {
        setState({ view: "empty" });
      }
    })();
    return () => stopPolling();
  }, [transactionId]);

  function initLines(r: Receipt) {
    setLines(
      r.line_items
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({
          id: item.id,
          description: item.description,
          amount: item.amount,
          ai_category: item.ai_category || "Miscellaneous",
          notes: item.notes || "",
        }))
    );
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const r = await getReceipt(transactionId);
        if (r.status === "parsed") {
          stopPolling();
          setState({ view: "existing_parsed", receipt: r });
          initLines(r);
        } else if (r.status === "failed") {
          stopPolling();
          setState({ view: "failed", receipt: r });
        }
      } catch {
        stopPolling();
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  // ─── File selection → preview ─────────────────────────────────────────────
  function onFileSelected(file: File) {
    const isPdf = file.type === "application/pdf";
    const previewUrl = !isPdf ? URL.createObjectURL(file) : null;
    setState({ view: "preview", file, previewUrl, isPdf });
    setError(null);
  }

  // ─── Upload with chosen provider ──────────────────────────────────────────
  async function handleUpload(provider: Provider) {
    if (state.view !== "preview") return;
    const { file } = state;

    // Clean up preview URL before transitioning
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);

    setState({ view: "uploading" });
    setError(null);
    try {
      const r = await uploadReceipt(transactionId, file, provider);
      setState({ view: "parsing", receipt: r });
      startPolling();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
      setState({ view: "empty" });
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this receipt and its line items?")) return;
    try {
      await deleteReceipt(transactionId);
      stopPolling();
      setState({ view: "empty" });
      setLines([]);
    } catch {
      setError("Failed to delete receipt");
    }
  }

  async function handleReparse(provider: Provider) {
    try {
      await reparseReceipt(transactionId, provider);
      const current = state as { receipt?: Receipt };
      if (current.receipt) {
        setState({ view: "parsing", receipt: { ...current.receipt, status: "pending" } });
      }
      startPolling();
    } catch {
      setError("Failed to re-parse");
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const payload = lines.map((l, idx) => ({
        description: l.description,
        amount: parseFloat(l.amount),
        ai_category: l.ai_category,
        notes: l.notes || undefined,
        sort_order: idx,
      }));
      await confirmReceiptSplits(transactionId, payload);
      onConfirmed();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to confirm splits");
    } finally {
      setConfirming(false);
    }
  }

  function updateLine(idx: number, field: keyof EditableLine, value: string) {
    setLines((prev) => { const n = [...prev]; n[idx] = { ...n[idx], [field]: value }; return n; });
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function distributeRemainder() {
    if (lines.length === 0) return;
    const diff = transactionAmount - lines.reduce((s, l) => s + parseFloat(l.amount || "0"), 0);
    if (Math.abs(diff) < 0.01) return;
    setLines((prev) => {
      const n = [...prev];
      const last = n[n.length - 1];
      n[n.length - 1] = { ...last, amount: (parseFloat(last.amount || "0") + diff).toFixed(2) };
      return n;
    });
  }

  const lineTotal = lines.reduce((s, l) => s + parseFloat(l.amount || "0"), 0);
  const mismatch = Math.abs(lineTotal - transactionAmount) > 0.10;

  // Helper to get the receipt from current state if available
  const currentReceipt = (() => {
    if (state.view === "parsing") return state.receipt;
    if (state.view === "failed") return state.receipt;
    if (state.view === "existing_parsed") return state.receipt;
    if (state.view === "existing_parsing") return state.receipt;
    return null;
  })();

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Receipt</h2>
            <p className="text-xs text-gray-500 mt-0.5">{transactionName} · ${Math.abs(transactionAmount).toFixed(2)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── EMPTY: no receipt yet ── */}
          {state.view === "empty" && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center text-3xl">🧾</div>
              <p className="text-sm text-gray-500 text-center">
                Attach a receipt photo or PDF.<br />AI will extract line items automatically.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
                >
                  📷 Take Photo
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  📎 Upload File
                </button>
              </div>
            </div>
          )}

          {/* ── PREVIEW: file selected, choose provider ── */}
          {state.view === "preview" && (
            <div className="space-y-4">
              {/* Image preview */}
              {state.previewUrl ? (
                <div className="rounded-lg overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center max-h-72">
                  <img
                    src={state.previewUrl}
                    alt="Receipt preview"
                    className="max-h-72 max-w-full object-contain"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-6 flex items-center gap-3">
                  <span className="text-3xl">📄</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{state.file.name}</p>
                    <p className="text-xs text-gray-400">{(state.file.size / 1024).toFixed(1)} KB · PDF</p>
                  </div>
                </div>
              )}

              <p className="text-sm font-medium text-gray-700 text-center">How should AI read this receipt?</p>

              {/* Provider choice */}
              <div className="grid grid-cols-2 gap-3">
                {/* Local */}
                <button
                  type="button"
                  onClick={() => handleUpload("local")}
                  className="group flex flex-col items-center gap-2 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition text-left"
                >
                  <span className="text-2xl">🖥️</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 group-hover:text-indigo-700">Local AI</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                      Free · Private · Uses Ollama<br />
                      <span className="text-amber-500">Best for PDFs with text</span>
                    </p>
                  </div>
                </button>

                {/* Claude */}
                <button
                  type="button"
                  onClick={() => handleUpload("claude")}
                  className="group flex flex-col items-center gap-2 p-4 border-2 border-gray-200 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition text-left"
                >
                  <span className="text-2xl">✨</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 group-hover:text-violet-700">Claude AI</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                      Best accuracy · All formats<br />
                      <span className="text-violet-500">Photos, scans, handwriting</span>
                    </p>
                  </div>
                </button>
              </div>

              <button
                type="button"
                onClick={() => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); setState({ view: "empty" }); }}
                className="w-full text-xs text-gray-400 hover:text-gray-600 text-center mt-1"
              >
                Choose a different file
              </button>
            </div>
          )}

          {/* ── UPLOADING ── */}
          {state.view === "uploading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">Uploading receipt…</p>
            </div>
          )}

          {/* ── PARSING ── */}
          {(state.view === "parsing" || state.view === "existing_parsing") && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">AI is reading your receipt…</p>
              {currentReceipt && (
                <p className="text-xs text-gray-400">{currentReceipt.filename}</p>
              )}
            </div>
          )}

          {/* ── FAILED ── */}
          {state.view === "failed" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-3xl">⚠️</div>
              <p className="text-sm text-red-600 text-center max-w-sm">
                {state.receipt.parse_error || "Failed to parse receipt"}
              </p>
              <p className="text-xs text-gray-400 text-center">Try a different method or re-upload a clearer image</p>
              <div className="flex gap-2 flex-wrap justify-center">
                <button type="button" onClick={() => handleReparse("local")} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700">
                  🖥️ Retry with Local
                </button>
                <button type="button" onClick={() => handleReparse("claude")} className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700">
                  ✨ Retry with Claude
                </button>
                <button type="button" onClick={handleDelete} className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">
                  Remove
                </button>
              </div>
            </div>
          )}

          {/* ── PARSED: line items review ── */}
          {(state.view === "existing_parsed") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">{state.receipt.filename}</p>
                <div className="flex gap-3 items-center">
                  <button type="button" onClick={() => handleReparse("local")} className="text-xs text-indigo-500 hover:text-indigo-700">🖥️ Re-parse Local</button>
                  <button type="button" onClick={() => handleReparse("claude")} className="text-xs text-violet-500 hover:text-violet-700">✨ Re-parse Claude</button>
                  <button type="button" onClick={handleDelete} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                </div>
              </div>

              {/* Line items table */}
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Description</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium w-36">Category</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium w-20">Amount</th>
                      <th className="w-8" scope="col"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50">
                        <td className="px-3 py-1.5">
                          <input
                            aria-label="Item description"
                            value={line.description}
                            onChange={(e) => updateLine(idx, "description", e.target.value)}
                            className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-primary-400 rounded px-1 py-0.5"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            aria-label="Item category"
                            value={line.ai_category}
                            onChange={(e) => updateLine(idx, "ai_category", e.target.value)}
                            className="w-full text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white"
                          >
                            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            step="0.01"
                            aria-label="Item amount"
                            value={line.amount}
                            onChange={(e) => updateLine(idx, "amount", e.target.value)}
                            className="w-full text-xs text-right border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button type="button" aria-label="Remove line" onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-400 text-base leading-none">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setLines((p) => [...p, { description: "", amount: "0.00", ai_category: "Miscellaneous", notes: "" }])} className="text-xs text-primary-600 hover:text-primary-700 font-medium">+ Add line</button>
                <div className="flex items-center gap-3">
                  {mismatch ? (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600">
                      <span>⚠</span>
                      <span>${lineTotal.toFixed(2)} / ${transactionAmount.toFixed(2)} ({(transactionAmount - lineTotal) > 0 ? "+" : ""}{(transactionAmount - lineTotal).toFixed(2)} unmatched)</span>
                      <button type="button" onClick={distributeRemainder} className="underline hover:no-underline">Distribute</button>
                    </div>
                  ) : (
                    <span className="text-xs text-green-600">✓ Total matches</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg">{error}</div>
          )}
        </div>

        {/* Footer */}
        {state.view === "existing_parsed" && (
          <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming || mismatch || lines.length === 0}
              className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {confirming ? "Saving…" : "Confirm & Create Splits"}
            </button>
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      {/* eslint-disable-next-line jsx-a11y/camera-capture -- intentional mobile camera capture */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" aria-label="Take photo" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); e.target.value = ""; }} />
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" aria-label="Upload receipt file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); e.target.value = ""; }} />
    </div>
  );
}
