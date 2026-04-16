"use client";

import React, { useEffect, useRef, useState } from "react";
import type { SankeyData } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  label: string;
  color: string;
  value: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  isSource: boolean;
}

interface LayoutLink {
  id: string;
  sourceNode: LayoutNode;
  targetNode: LayoutNode;
  value: number;
  halfSrc: number;
  halfTgt: number;
  ySrc: number;
  yTgt: number;
}

interface TooltipState {
  x: number;
  y: number;
  label: string;
  value: number;
  pct?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function fmtFull(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function buildLayout(
  data: SankeyData,
  innerW: number,
  innerH: number,
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  const NODE_W = 14;
  const NODE_GAP = 20;

  const srcIds = new Set(data.links.map((l) => l.source));
  const dstIds = new Set(data.links.map((l) => l.target));

  const srcRaw = data.nodes.filter((n) => srcIds.has(n.id));
  const dstRaw = data.nodes.filter((n) => dstIds.has(n.id) && !srcIds.has(n.id));

  const srcTotals: Record<string, number> = {};
  for (const n of srcRaw) srcTotals[n.id] = n.value;

  const dstTotals: Record<string, number> = {};
  for (const l of data.links) {
    dstTotals[l.target] = (dstTotals[l.target] ?? 0) + l.value;
  }

  function placeNodes(
    raws: typeof srcRaw,
    totals: Record<string, number>,
    xLeft: number,
    isSource: boolean,
  ): LayoutNode[] {
    const totalVal = raws.reduce((s, n) => s + (totals[n.id] ?? 0), 0);
    const totalGap = NODE_GAP * (raws.length - 1);
    const usableH = innerH - totalGap;
    let y = 0;
    return raws.map((n) => {
      const val = totals[n.id] ?? 0;
      const h = totalVal > 0 ? Math.max(10, (val / totalVal) * usableH) : 10;
      const node: LayoutNode = {
        ...n, value: val,
        x0: xLeft, y0: y, x1: xLeft + NODE_W, y1: y + h,
        isSource,
      };
      y += h + NODE_GAP;
      return node;
    });
  }

  const srcNodes = placeNodes(srcRaw, srcTotals, 0, true);
  const dstNodes = placeNodes(dstRaw, dstTotals, innerW - NODE_W, false);

  const nodeMap: Record<string, LayoutNode> = {};
  [...srcNodes, ...dstNodes].forEach((n) => { nodeMap[n.id] = n; });

  const srcOffset: Record<string, number> = {};
  const dstOffset: Record<string, number> = {};

  const links: LayoutLink[] = [];
  for (const raw of data.links) {
    const s = nodeMap[raw.source];
    const t = nodeMap[raw.target];
    if (!s || !t || raw.value < 0.01) continue;

    const sH = s.y1 - s.y0;
    const tH = t.y1 - t.y0;

    const sSW = (raw.value / (srcTotals[s.id] || 1)) * sH;
    const tSW = (raw.value / (dstTotals[t.id] || 1)) * tH;

    const sOff = srcOffset[s.id] ?? 0;
    const tOff = dstOffset[t.id] ?? 0;

    const ySrc = s.y0 + sOff + sSW / 2;
    const yTgt = t.y0 + tOff + tSW / 2;

    links.push({
      id: `${raw.source}__${raw.target}`,
      sourceNode: s,
      targetNode: t,
      value: raw.value,
      halfSrc: sSW / 2,
      halfTgt: tSW / 2,
      ySrc,
      yTgt,
    });

    srcOffset[s.id] = sOff + sSW;
    dstOffset[t.id] = tOff + tSW;
  }

  return { nodes: [...srcNodes, ...dstNodes], links };
}

/** Ribbon path: closed bezier shape connecting two vertical bands */
function ribbonPath(
  x0: number, ySrcTop: number, ySrcBot: number,
  x1: number, yTgtTop: number, yTgtBot: number,
): string {
  const mx = (x0 + x1) / 2;
  return [
    `M ${x0} ${ySrcTop}`,
    `C ${mx} ${ySrcTop}, ${mx} ${yTgtTop}, ${x1} ${yTgtTop}`,
    `L ${x1} ${yTgtBot}`,
    `C ${mx} ${yTgtBot}, ${mx} ${ySrcBot}, ${x0} ${ySrcBot}`,
    `Z`,
  ].join(" ");
}

// ─── Inner chart (reused for normal + fullscreen) ─────────────────────────────

interface ChartCanvasProps {
  data: SankeyData;
  width: number;
  height: number;
}

function ChartCanvas({ data, width, height }: ChartCanvasProps) {
  const [tooltip, setTooltip]     = useState<TooltipState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isDark, setIsDark]       = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const totalIncome = data.nodes
    .filter((n) => new Set(data.links.map((l) => l.source)).has(n.id))
    .reduce((s, n) => s + n.value, 0);

  const PAD = { top: 24, right: 200, bottom: 24, left: 200 };
  const innerW = Math.max(width - PAD.left - PAD.right, 60);
  const innerH = height - PAD.top - PAD.bottom;

  const { nodes, links } = buildLayout(data, innerW, innerH);

  const labelColor = isDark ? "#f3f4f6" : "#111827";
  const subColor   = isDark ? "#9ca3af" : "#6b7280";

  return (
    <>
    <svg
      width={width}
      height={height}
      onMouseLeave={() => { setTooltip(null); setHoveredId(null); }}
    >
      <g transform={`translate(${PAD.left},${PAD.top})`}>

        {/* ── Ribbons ──────────────────────────────────────────────── */}
        {links.map((link) => {
          const x0 = link.sourceNode.x1;
          const x1 = link.targetNode.x0;
          const isHov = hoveredId === link.id ||
                        hoveredId === link.sourceNode.id ||
                        hoveredId === link.targetNode.id;

          const d = ribbonPath(
            x0, link.ySrc - link.halfSrc, link.ySrc + link.halfSrc,
            x1, link.yTgt - link.halfTgt, link.yTgt + link.halfTgt,
          );

          const pct = totalIncome > 0
            ? Math.round((link.value / totalIncome) * 100)
            : 0;

          return (
            <path
              key={link.id}
              d={d}
              fill={link.targetNode.color}
              fillOpacity={isHov ? 0.72 : 0.28}
              stroke={link.targetNode.color}
              strokeOpacity={isHov ? 0.3 : 0.08}
              strokeWidth={0.5}
              className="cursor-pointer transition-[fill-opacity] duration-150"
              onMouseEnter={(e) => {
                setHoveredId(link.id);
                setTooltip({
                  x: e.clientX, y: e.clientY,
                  label: `${link.sourceNode.label} → ${link.targetNode.label}`,
                  value: link.value,
                  pct,
                });
              }}
              onMouseMove={(e) =>
                setTooltip((p) => p ? { ...p, x: e.clientX, y: e.clientY } : p)
              }
              onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
            />
          );
        })}

        {/* ── Nodes + labels ───────────────────────────────────────── */}
        {nodes.map((node) => {
          const midY  = (node.y0 + node.y1) / 2;
          const nodeH = Math.max(node.y1 - node.y0, 2);
          const isHov = hoveredId === node.id;

          const pct = totalIncome > 0
            ? Math.round((node.value / totalIncome) * 100)
            : 0;

          return (
            <g
              key={node.id}
              onMouseEnter={(e) => {
                setHoveredId(node.id);
                setTooltip({ x: e.clientX, y: e.clientY, label: node.label, value: node.value, pct });
              }}
              onMouseMove={(e) =>
                setTooltip((p) => p ? { ...p, x: e.clientX, y: e.clientY } : p)
              }
              onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
              className="cursor-default"
            >
              {/* Glow / shadow behind node */}
              {isHov && (
                <rect
                  x={node.x0 - 2} y={node.y0 - 2}
                  width={node.x1 - node.x0 + 4} height={nodeH + 4}
                  fill={node.color} opacity={0.25} rx={5}
                />
              )}

              {/* Node bar */}
              <rect
                x={node.x0} y={node.y0}
                width={node.x1 - node.x0} height={nodeH}
                fill={node.color}
                rx={4}
                opacity={isHov ? 1 : 0.88}
                className="transition-opacity duration-150"
              />

              {/* Source — label LEFT */}
              {node.isSource && (
                <>
                  <text
                    x={node.x0 - 14} y={midY - 8}
                    textAnchor="end" dominantBaseline="middle"
                    fontSize={12} fontWeight={700} fill={labelColor}
                  >
                    {node.label}
                  </text>
                  <text
                    x={node.x0 - 14} y={midY + 8}
                    textAnchor="end" dominantBaseline="middle"
                    fontSize={11} fill={subColor}
                  >
                    {fmtUSD(node.value)}
                  </text>
                </>
              )}

              {/* Destination — label RIGHT */}
              {!node.isSource && (
                <>
                  <text
                    x={node.x1 + 14} y={midY - 8}
                    textAnchor="start" dominantBaseline="middle"
                    fontSize={12} fontWeight={700} fill={labelColor}
                  >
                    {node.label}
                  </text>
                  <text
                    x={node.x1 + 14} y={midY + 8}
                    textAnchor="start" dominantBaseline="middle"
                    fontSize={11} fill={subColor}
                  >
                    {fmtUSD(node.value)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </g>

    </svg>

    {/* ── Tooltip (outside SVG, fixed to viewport) ──────────────────── */}
    {tooltip && (
      <div
        className="fixed z-[9999] pointer-events-none rounded-xl shadow-xl border
                   bg-white dark:bg-slate-800
                   border-gray-100 dark:border-slate-700
                   text-gray-900 dark:text-gray-100
                   px-4 py-3 text-sm"
        style={{ left: tooltip.x + 16, top: tooltip.y - 56 }}
      >
        <div className="font-semibold text-xs text-gray-500 dark:text-gray-400 mb-1">
          {tooltip.label}
        </div>
        <div className="font-bold text-base">
          {fmtFull(tooltip.value)}
        </div>
        {tooltip.pct !== undefined && (
          <div className="text-xs text-gray-400 mt-0.5">
            {tooltip.pct}% of income
          </div>
        )}
      </div>
    )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SankeyChartProps {
  data: SankeyData;
  height?: number;
}

export default function SankeyChart({ data, height = 400 }: SankeyChartProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const [width, setWidth]         = useState(700);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  if (!data.nodes.length) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-64 text-sm text-gray-400 dark:text-gray-500">
        No income data for this period.
      </div>
    );
  }

  return (
    <>
      {/* ── Inline chart ───────────────────────────────────────────── */}
      <div ref={containerRef} className="relative" style={{ height } as React.CSSProperties}>
        {/* Expand button */}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          title="Expand to full view"
          className="absolute top-0 right-0 z-10 p-1.5 rounded-lg text-gray-400
                     hover:text-gray-700 dark:hover:text-gray-200
                     hover:bg-gray-100 dark:hover:bg-slate-700
                     transition-colors duration-150"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>

        <ChartCanvas data={data} width={width} height={height} />
      </div>

      {/* ── Fullscreen modal ────────────────────────────────────────── */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
          onClick={(e) => { if (e.target === e.currentTarget) setFullscreen(false); }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-700">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white text-base">
                  Income &amp; Expense Flow
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Where your money comes from and where it goes</p>
              </div>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                title="Close"
                aria-label="Close full view"
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200
                           hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
              >
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal chart — full width, tall */}
            <FullscreenChart data={data} />
          </div>
        </div>
      )}
    </>
  );
}

// ─── Fullscreen inner chart with its own size tracking ───────────────────────

const FULL_H = 560;

function FullscreenChart({ data }: { data: SankeyData }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-[560px]">
      <ChartCanvas data={data} width={width} height={FULL_H} />
    </div>
  );
}
