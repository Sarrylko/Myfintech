"use client";

import { useEffect, useState, useRef } from "react";
import {
  listFinancialDocuments,
  getFinancialPicture,
  streamFinancialPicture,
  FinancialDocument,
  FinancialPictureCache,
} from "@/lib/api";
import { DOC_TYPES, TYPE_COLORS, fmtFileSize } from "./DocumentsTab";

const KPI_REGEX = /^KPI:\s*(.+?)\s*=\s*(.+)$/;

type Block =
  | { type: "heading"; text: string }
  | { type: "kpi"; label: string; value: string }
  | { type: "text"; text: string };

function parseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("## ")) {
      blocks.push({ type: "heading", text: line.slice(3).trim() });
    } else {
      const m = line.match(KPI_REGEX);
      if (m) {
        blocks.push({ type: "kpi", label: m[1].trim(), value: m[2].trim() });
      } else {
        const last = blocks[blocks.length - 1];
        if (last?.type === "text") {
          last.text += (last.text ? "\n" : "") + line;
        } else {
          blocks.push({ type: "text", text: line });
        }
      }
    }
  }
  return blocks;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function FinancialPictureTab({ selectedYear }: { selectedYear: number }) {
  const [allDocs, setAllDocs] = useState<FinancialDocument[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);

  const [cacheLoading, setCacheLoading] = useState(true);
  const [cachedReport, setCachedReport] = useState<FinancialPictureCache | null>(null);

  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reportError, setReportError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listFinancialDocuments()
      .then(setAllDocs)
      .catch(() => {})
      .finally(() => setInventoryLoading(false));
  }, []);

  useEffect(() => {
    setCacheLoading(true);
    setStreamText("");
    getFinancialPicture(selectedYear)
      .then(setCachedReport)
      .catch(() => setCachedReport(null))
      .finally(() => setCacheLoading(false));
  }, [selectedYear]);

  const totalDocs = allDocs.length;
  const totalBytes = allDocs.reduce((s, d) => s + d.file_size, 0);
  const years = Array.from(new Set(allDocs.map((d) => d.reference_year).filter(Boolean)))
    .sort((a, b) => (b ?? 0) - (a ?? 0));
  const lastUploaded = allDocs.length
    ? allDocs.reduce(
        (latest, d) => (d.uploaded_at > latest ? d.uploaded_at : latest),
        allDocs[0].uploaded_at
      )
    : null;
  const byType = DOC_TYPES
    .map((t) => ({ ...t, count: allDocs.filter((d) => d.document_type === t.value).length }))
    .filter((t) => t.count > 0);

  async function handleGenerate() {
    setGenerating(true);
    setStreamText("");
    setReportError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await streamFinancialPicture(selectedYear);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) { reader.cancel(); break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const chunk = JSON.parse(data) as { error?: string; choices?: { delta?: { content?: string } }[] };
            if (chunk.error) { setReportError(chunk.error); return; }
            const content = chunk.choices?.[0]?.delta?.content ?? "";
            if (content) { accumulated += content; setStreamText(accumulated); }
          } catch { /* ignore malformed chunk */ }
        }
      }
      if (accumulated) {
        setCachedReport({
          cached: true,
          report_text: accumulated,
          generated_at: new Date().toISOString(),
          year: selectedYear,
        });
        setStreamText("");
      }
    } catch (e) {
      if (!abortRef.current?.signal.aborted) {
        setReportError(e instanceof Error ? e.message : "Generation failed");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  const displayText = generating ? streamText : (cachedReport?.report_text ?? "");
  const blocks = displayText ? parseBlocks(displayText) : [];
  const hasCache = !!(cachedReport?.cached && cachedReport.report_text);

  return (
    <div className="space-y-6">

      {/* ── Document Inventory KPI Row ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Documents", value: inventoryLoading ? "…" : String(totalDocs) },
          { label: "Years Covered", value: inventoryLoading ? "…" : (years.length > 0 ? years.join(", ") : "—") },
          { label: "Storage Used", value: inventoryLoading ? "…" : fmtFileSize(totalBytes) },
          {
            label: "Last Uploaded",
            value: inventoryLoading ? "…" : (lastUploaded ? new Date(lastUploaded).toLocaleDateString() : "—"),
          },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{kpi.label}</p>
            <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* ── By-type pills ────────────────────────────────────────────────────── */}
      {!inventoryLoading && byType.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">Documents by Type</p>
          <div className="flex flex-wrap gap-2">
            {byType.map((t) => (
              <div
                key={t.value}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${TYPE_COLORS[t.value] ?? TYPE_COLORS.other}`}
              >
                <span>{t.label}</span>
                <span className="bg-white/60 rounded-full px-1.5 py-0.5 font-bold">{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Dual-source info banner ──────────────────────────────────────────── */}
      {!inventoryLoading && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-indigo-500 text-lg shrink-0">✦</span>
          <p className="text-sm text-indigo-700">
            <span className="font-semibold">Dual-source analysis:</span>{" "}
            Combines your{" "}
            <span className="font-medium">
              {totalDocs} uploaded document{totalDocs !== 1 ? "s" : ""}
            </span>{" "}
            with{" "}
            <span className="font-medium">live account, property, and portfolio data</span>.
            Updated daily at 7 AM — regenerate anytime for a fresh analysis.
          </p>
        </div>
      )}

      {/* ── AI Analysis Panel ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">
              Financial Picture — {selectedYear}
              {hasCache && cachedReport?.generated_at && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  Last generated: {timeAgo(cachedReport.generated_at)}
                </span>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Documents + live accounts, properties, and portfolio — cross-referenced by AI.
            </p>
          </div>
          <div className="flex gap-2">
            {generating && (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); setGenerating(false); }}
                className="text-sm px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition font-medium"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {generating ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating…
                </>
              ) : hasCache ? (
                <><span>↻</span> Regenerate</>
              ) : (
                <><span>✦</span> Generate Financial Picture</>
              )}
            </button>
          </div>
        </div>

        {reportError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
            {reportError} — Make sure the AI stack is running.
          </div>
        )}

        {cacheLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
        ) : blocks.length > 0 ? (
          <div className="space-y-3 mt-2">
            {blocks.map((block, idx) => {
              if (block.type === "heading") return (
                <h3 key={idx} className="text-base font-bold text-gray-800 border-b border-gray-100 pb-2 pt-3">
                  {block.text}
                </h3>
              );
              if (block.type === "kpi") return (
                <div key={idx} className="flex items-center justify-between bg-indigo-50 rounded-lg px-4 py-2.5">
                  <span className="text-sm font-medium text-indigo-800">{block.label}</span>
                  <span className="text-sm font-bold text-indigo-900">{block.value}</span>
                </div>
              );
              if (!block.text.trim()) return null;
              return (
                <p key={idx} className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {block.text}
                </p>
              );
            })}
            {generating && <p className="text-xs text-gray-400 animate-pulse mt-2">Generating…</p>}
          </div>
        ) : !generating && !reportError ? (
          <p className="text-sm text-gray-400 italic text-center py-8">
            Click &ldquo;Generate Financial Picture&rdquo; to analyze your documents and live financial data.
            <br />
            <span className="text-xs">This report is also generated automatically every morning at 7 AM.</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
