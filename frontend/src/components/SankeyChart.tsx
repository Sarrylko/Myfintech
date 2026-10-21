"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  note?: string;
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

// ─── Payroll summary / drill-down transforms ─────────────────────────────────
//
// The backend sends the detailed 4-layer payroll flow.  These pure functions
// regroup it into a high-level view (earners → taxes / benefits / saved /
// spent / unallocated → a few groups) and focused drill-downs, reusing the
// same l1_/l2_/l3_ id prefixes so the payroll layout renders them as-is.

type FlowNode = SankeyData["nodes"][number];
type FlowLink = SankeyData["links"][number];

const TAX_IDS = ["l2_federal_tax", "l2_state_tax", "l2_ss_tax", "l2_medicare_tax"];
const POOL = "l3_expense_pool";
const NON_SPEND_IDS = new Set(["l4_savings_transfers", "l4_loan_principal", "l4_remaining"]);

const SPEND_GROUP_OF: Record<string, "essentials" | "lifestyle" | "loans"> = {
  "housing": "essentials",
  "utilities": "essentials",
  "insurance": "essentials",
  "health & medical": "essentials",
  "transportation": "essentials",
  "kids & family": "essentials",
  "education": "essentials",
  "taxes": "essentials",
  "food & dining": "lifestyle",
  "shopping": "lifestyle",
  "travel": "lifestyle",
  "entertainment": "lifestyle",
  "personal care": "lifestyle",
  // Loan payments not matched to a tracked loan, interest and bank fees
  "financial": "loans",
};

const SPEND_GROUPS = [
  { id: "l3_grp_essentials", key: "essentials", label: "Essentials", color: "#3b82f6" },
  { id: "l3_grp_lifestyle", key: "lifestyle", label: "Lifestyle", color: "#ec4899" },
  { id: "l3_grp_loans", key: "loans", label: "Loans & fees", color: "#64748b" },
  { id: "l3_grp_other", key: "other", label: "Other spending", color: "#94a3b8" },
] as const;

const BUCKET = {
  taxes:       { id: "l2_taxes",       label: "Taxes",             color: "#ef4444" },
  benefits:    { id: "l2_benefits",    label: "Health & Benefits", color: "#06b6d4" },
  saved:       { id: "l2_saved",       label: "Saved",             color: "#22c55e" },
  spent:       { id: "l2_spent",       label: "Spent",             color: "#6366f1" },
  unallocated: { id: "l2_unallocated", label: "Unallocated",       color: "#cbd5e1" },
};

const DRILL_LABELS: Record<string, string> = {
  [BUCKET.taxes.id]: "Taxes",
  [BUCKET.saved.id]: "Saved",
  [BUCKET.spent.id]: "Spent",
  ...Object.fromEntries(SPEND_GROUPS.map((g) => [g.id, g.label])),
};

/** Take-home links are split across earners by their share of take-home pay */
const SHARED_LINK_TARGETS = new Set([BUCKET.saved.id, BUCKET.spent.id, BUCKET.unallocated.id]);

interface PayrollFacts {
  earners: { node: FlowNode; tax: number; benefits: number; invest: number; takeHome: number }[];
  taxNodes: FlowNode[];
  saved: FlowNode[];          // 401k / ESOP / savings transfers / loan principal
  categories: FlowNode[];     // spending categories, value = take-home actually spent there
  takeHomeSaved: number;
  spent: number;
  unallocated: number;
  takeHome: number;
}

function payrollFacts(data: SankeyData): PayrollFacts {
  const linkVal: Record<string, number> = {};
  for (const l of data.links) linkVal[`${l.source}__${l.target}`] = (linkVal[`${l.source}__${l.target}`] ?? 0) + l.value;
  const byId: Record<string, FlowNode> = {};
  for (const n of data.nodes) byId[n.id] = n;
  const get = (s: string, t: string) => linkVal[`${s}__${t}`] ?? 0;

  const earners = data.nodes.filter((n) => n.id.startsWith("l1_")).map((node) => {
    const netId = `l2_net_${node.id.slice(3)}`;
    return {
      node,
      tax: TAX_IDS.reduce((s, t) => s + get(node.id, t), 0),
      benefits: get(node.id, "l2_health_benefits"),
      invest: get(netId, "l3_investments"),
      takeHome: get(netId, POOL),
    };
  });

  // Pool links are capped at take-home, so they add up to it even when spending is higher
  const poolLinks = data.links.filter((l) => l.source === POOL);
  const categories = poolLinks
    .filter((l) => !NON_SPEND_IDS.has(l.target) && byId[l.target])
    .map((l) => ({ ...byId[l.target], value: l.value }))
    .sort((a, b) => b.value - a.value);

  const poolTo = (id: string) => poolLinks.filter((l) => l.target === id).reduce((s, l) => s + l.value, 0);
  const node = (id: string, label: string, color: string, value: number): FlowNode => ({ id, label, color, value });
  const retirement = (byId["l4_trad_401k"]?.value ?? 0) + (byId["l4_roth_401k"]?.value ?? 0);
  const saved = [
    node("l3_401k", "401k (Trad + Roth)", "#16a34a", retirement),
    node("l3_esop", "ESOP / Stock", "#a855f7", byId["l4_esop_stock"]?.value ?? 0),
    node("l3_savings", "Savings & investing", "#10b981", poolTo("l4_savings_transfers")),
    node("l3_principal", "Loan principal (equity)", "#0d9488", poolTo("l4_loan_principal")),
  ];

  return {
    earners,
    taxNodes: TAX_IDS.map((id) => byId[id]).filter((n): n is FlowNode => !!n && n.value > 0),
    saved,
    categories,
    takeHomeSaved: poolTo("l4_savings_transfers") + poolTo("l4_loan_principal"),
    spent: categories.reduce((s, c) => s + c.value, 0),
    unallocated: poolTo("l4_remaining"),
    takeHome: earners.reduce((s, e) => s + e.takeHome, 0),
  };
}

function flow(data: SankeyData, nodes: FlowNode[], links: FlowLink[]): SankeyData {
  return {
    ...data,
    nodes: nodes.filter((n) => n.value > 0.01),
    links: links.filter((l) => l.value > 0.01),
  };
}

function buildPayrollSummary(data: SankeyData): SankeyData {
  const f = payrollFacts(data);
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];

  // Col 0 — earners
  for (const e of f.earners) {
    nodes.push(e.node);
    const share = f.takeHome > 0 ? e.takeHome / f.takeHome : 0;
    links.push(
      { source: e.node.id, target: BUCKET.taxes.id, value: e.tax },
      { source: e.node.id, target: BUCKET.benefits.id, value: e.benefits },
      { source: e.node.id, target: BUCKET.saved.id, value: e.invest + share * f.takeHomeSaved },
      { source: e.node.id, target: BUCKET.spent.id, value: share * f.spent },
      { source: e.node.id, target: BUCKET.unallocated.id, value: share * f.unallocated },
    );
  }

  // Col 1 — high-level buckets
  const taxTotal = f.earners.reduce((s, e) => s + e.tax, 0);
  const savedTotal = f.saved.reduce((s, n) => s + n.value, 0);
  nodes.push(
    { ...BUCKET.taxes, value: taxTotal },
    { ...BUCKET.benefits, value: f.earners.reduce((s, e) => s + e.benefits, 0) },
    { ...BUCKET.saved, value: savedTotal },
    { ...BUCKET.spent, value: f.spent },
    { ...BUCKET.unallocated, value: f.unallocated },
  );

  // Col 2 — a few groups per bucket
  for (const t of f.taxNodes) {
    const id = `l3_${t.id.slice(3)}`;
    nodes.push({ ...t, id });
    links.push({ source: BUCKET.taxes.id, target: id, value: t.value });
  }
  for (const s of f.saved) {
    nodes.push(s);
    links.push({ source: BUCKET.saved.id, target: s.id, value: s.value });
  }
  for (const g of SPEND_GROUPS) {
    const value = f.categories
      .filter((c) => (SPEND_GROUP_OF[c.label.toLowerCase()] ?? "other") === g.key)
      .reduce((s, c) => s + c.value, 0);
    nodes.push({ id: g.id, label: g.label, color: g.color, value });
    links.push({ source: BUCKET.spent.id, target: g.id, value });
  }

  return flow(data, nodes, links);
}

const MAX_DRILL_CATEGORIES = 10;

function buildPayrollDrill(data: SankeyData, focusId: string): SankeyData {
  const f = payrollFacts(data);

  if (focusId === BUCKET.taxes.id) {
    // Each earner's taxes by type
    const nodes = [...f.earners.map((e) => ({ ...e.node, value: e.tax })), ...f.taxNodes];
    const links = data.links.filter((l) => l.source.startsWith("l1_") && TAX_IDS.includes(l.target));
    return flow(data, nodes, links);
  }

  if (focusId === BUCKET.saved.id) {
    const byId: Record<string, FlowNode> = {};
    for (const n of data.nodes) byId[n.id] = n;
    const total = f.saved.reduce((s, n) => s + n.value, 0);
    const items: FlowNode[] = [
      { id: "l2_trad_401k", label: "Traditional 401k", color: "#16a34a", value: byId["l4_trad_401k"]?.value ?? 0 },
      { id: "l2_roth_401k", label: "Roth 401k", color: "#15803d", value: byId["l4_roth_401k"]?.value ?? 0 },
      ...f.saved.slice(1).map((n) => ({ ...n, id: `l2_${n.id.slice(3)}` })),
    ];
    const src: FlowNode = { ...BUCKET.saved, id: "l1_saved", value: total };
    return flow(data, [src, ...items], items.map((n) => ({ source: src.id, target: n.id, value: n.value })));
  }

  // Spending: all categories, or one group's
  const group = SPEND_GROUPS.find((g) => g.id === focusId);
  let cats = group
    ? f.categories.filter((c) => (SPEND_GROUP_OF[c.label.toLowerCase()] ?? "other") === group.key)
    : f.categories;
  if (!group && cats.length > MAX_DRILL_CATEGORIES + 1) {
    const rest = cats.slice(MAX_DRILL_CATEGORIES);
    cats = [
      ...cats.slice(0, MAX_DRILL_CATEGORIES),
      { id: "l4_rest", label: `${rest.length} other categories`, color: "#94a3b8", value: rest.reduce((s, c) => s + c.value, 0) },
    ];
  }
  const items = cats.map((c) => ({ ...c, id: `l2_${c.id.slice(3)}` }));
  const src: FlowNode = {
    id: "l1_spend",
    label: group ? group.label : BUCKET.spent.label,
    color: group ? group.color : BUCKET.spent.color,
    value: items.reduce((s, c) => s + c.value, 0),
  };
  return flow(data, [src, ...items], items.map((n) => ({ source: src.id, target: n.id, value: n.value })));
}

// ─── Payroll (multi-column) layout helpers ───────────────────────────────────

/** Determine column index from node ID prefix */
function payrollColumn(id: string): number {
  if (id.startsWith("l1_")) return 0;
  if (id.startsWith("l2_")) return 1;
  if (id.startsWith("l3_")) return 2;
  return 3; // l4_*
}

interface PayrollLayoutNode {
  id: string; label: string; color: string; value: number;
  col: number; x0: number; y0: number; x1: number; y1: number;
}

interface PayrollLayoutLink {
  id: string;
  srcNode: PayrollLayoutNode; tgtNode: PayrollLayoutNode;
  value: number;
  ySrcTop: number; ySrcBot: number;
  yTgtTop: number; yTgtBot: number;
}

function buildPayrollLayout(
  data: SankeyData,
  innerW: number,
  innerH: number,
): { nodes: PayrollLayoutNode[]; links: PayrollLayoutLink[]; numCols: number } {
  const NODE_W = 14;
  const NODE_GAP = 16;
  const NUM_COLS = Math.max(2, ...data.nodes.map((n) => payrollColumn(n.id) + 1));

  // Group nodes by column
  const colGroups: Map<number, typeof data.nodes[0][]> = new Map();
  for (let c = 0; c < NUM_COLS; c++) colGroups.set(c, []);
  for (const n of data.nodes) {
    const c = payrollColumn(n.id);
    colGroups.get(c)!.push(n);
  }

  // Column x-positions
  const colX = (col: number) => (col / (NUM_COLS - 1)) * (innerW - NODE_W);

  // Place nodes in each column (proportional height, top-aligned with gaps)
  const layoutNodes: PayrollLayoutNode[] = [];
  const nodeMap: Record<string, PayrollLayoutNode> = {};

  // Incoming value for each node (sum of link values targeting it)
  const incomingByNode: Record<string, number> = {};
  for (const link of data.links) {
    incomingByNode[link.target] = (incomingByNode[link.target] ?? 0) + link.value;
  }

  for (let c = 0; c < NUM_COLS; c++) {
    const raws = colGroups.get(c) ?? [];
    if (!raws.length) continue;

    // For column 0 (sources), use the node's own value; others use incoming
    const valOf = (n: typeof raws[0]) =>
      c === 0 ? n.value : (incomingByNode[n.id] ?? n.value);

    const totalVal = raws.reduce((s, n) => s + valOf(n), 0);
    const totalGap = NODE_GAP * (raws.length - 1);
    const usableH = innerH - totalGap;
    const x0 = colX(c);
    let y = 0;

    for (const raw of raws) {
      const val = valOf(raw);
      const h = totalVal > 0 ? Math.max(8, (val / totalVal) * usableH) : 8;
      const node: PayrollLayoutNode = {
        ...raw, value: val, col: c,
        x0, y0: y, x1: x0 + NODE_W, y1: y + h,
      };
      layoutNodes.push(node);
      nodeMap[raw.id] = node;
      y += h + NODE_GAP;
    }
  }

  // Build links with cumulative offsets (same ribbon technique as buildLayout)
  const srcOffset: Record<string, number> = {};
  const tgtOffset: Record<string, number> = {};
  const layoutLinks: PayrollLayoutLink[] = [];

  // Compute total outgoing/incoming per node for proportional slicing
  const srcTotals: Record<string, number> = {};
  const tgtTotals: Record<string, number> = {};
  for (const link of data.links) {
    srcTotals[link.source] = (srcTotals[link.source] ?? 0) + link.value;
    tgtTotals[link.target] = (tgtTotals[link.target] ?? 0) + link.value;
  }

  for (const raw of data.links) {
    const s = nodeMap[raw.source];
    const t = nodeMap[raw.target];
    if (!s || !t || raw.value < 0.01) continue;

    const sH = s.y1 - s.y0;
    const tH = t.y1 - t.y0;
    const sSW = (raw.value / (srcTotals[s.id] || 1)) * sH;
    const tSW = (raw.value / (tgtTotals[t.id] || 1)) * tH;

    const sOff = srcOffset[s.id] ?? 0;
    const tOff = tgtOffset[t.id] ?? 0;

    layoutLinks.push({
      id: `${raw.source}__${raw.target}`,
      srcNode: s, tgtNode: t,
      value: raw.value,
      ySrcTop: s.y0 + sOff,
      ySrcBot: s.y0 + sOff + sSW,
      yTgtTop: t.y0 + tOff,
      yTgtBot: t.y0 + tOff + tSW,
    });

    srcOffset[s.id] = sOff + sSW;
    tgtOffset[t.id] = tOff + tSW;
  }

  return { nodes: layoutNodes, links: layoutLinks, numCols: NUM_COLS };
}

/** One-line label y positions for a column, nudged apart so they never overlap */
function nudgedLabelY(nodes: PayrollLayoutNode[], gap: number, maxY: number): Record<string, number> {
  const sorted = [...nodes].sort((a, b) => a.y0 - b.y0);
  const ys = sorted.map((n) => (n.y0 + n.y1) / 2);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
  for (let i = ys.length - 1; i >= 0; i--) {
    const limit = i === ys.length - 1 ? maxY : ys[i + 1] - gap;
    ys[i] = Math.min(ys[i], limit);
  }
  const out: Record<string, number> = {};
  sorted.forEach((n, i) => { out[n.id] = ys[i]; });
  return out;
}

// ─── Payroll chart canvas (multi-column custom layout) ───────────────────────

interface PayrollCanvasProps extends ChartCanvasProps {
  isClickable?: (id: string) => boolean;
  onNodeClick?: (id: string) => void;
  linkNote?: (link: { source: string; target: string }) => string | undefined;
}

function PayrollChartCanvas({ data, width, height, isClickable, onNodeClick, linkNote }: PayrollCanvasProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const PAD = { top: 24, right: 230, bottom: 24, left: 180 };
  const innerW = Math.max(width - PAD.left - PAD.right, 60);
  const innerH = height - PAD.top - PAD.bottom;

  const { nodes: layoutNodes, links: layoutLinks, numCols } = buildPayrollLayout(data, innerW, innerH);
  const lastCol = numCols - 1;
  // With 3 or fewer columns there is room for full labels beside the middle bars
  const roomyMiddle = numCols <= 3;

  const labelColor = isDark ? "#f3f4f6" : "#111827";
  const subColor = isDark ? "#9ca3af" : "#6b7280";
  const haloColor = isDark ? "#1e293b" : "#ffffff";
  const totalGross = data.gross_income ?? data.total_income;
  const pctOf = (v: number) => (totalGross > 0 ? Math.round((v / totalGross) * 100) : 0);

  const LABEL_GAP = 15;
  const maxLabelY = innerH + PAD.bottom - 6;
  const sideLabelY: Record<string, number> = {
    ...nudgedLabelY(layoutNodes.filter((n) => n.col === lastCol), LABEL_GAP, maxLabelY),
    ...(roomyMiddle
      ? nudgedLabelY(layoutNodes.filter((n) => n.col > 0 && n.col < lastCol), 17, maxLabelY)
      : {}),
  };

  return (
    <>
      <svg
        width={width}
        height={height}
        onMouseLeave={() => { setTooltip(null); setHoveredId(null); }}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* ── Ribbons ───────────────────────────────────────────── */}
          {layoutLinks.map((link) => {
            const isHov = hoveredId === link.id ||
              hoveredId === link.srcNode.id ||
              hoveredId === link.tgtNode.id;
            const d = ribbonPath(
              link.srcNode.x1, link.ySrcTop, link.ySrcBot,
              link.tgtNode.x0, link.yTgtTop, link.yTgtBot,
            );
            const pct = totalGross > 0 ? Math.round((link.value / totalGross) * 100) : 0;
            return (
              <path
                key={link.id}
                d={d}
                fill={link.tgtNode.color}
                fillOpacity={isHov ? 0.72 : 0.28}
                stroke={link.tgtNode.color}
                strokeOpacity={isHov ? 0.3 : 0.08}
                strokeWidth={0.5}
                className="cursor-pointer transition-[fill-opacity] duration-150"
                onMouseEnter={(e) => {
                  setHoveredId(link.id);
                  setTooltip({
                    x: e.clientX, y: e.clientY,
                    label: `${link.srcNode.label} → ${link.tgtNode.label}`,
                    value: link.value, pct,
                    note: linkNote?.({ source: link.srcNode.id, target: link.tgtNode.id }),
                  });
                }}
                onMouseMove={(e) => setTooltip((p) => p ? { ...p, x: e.clientX, y: e.clientY } : p)}
                onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
              />
            );
          })}

          {/* ── Nodes ─────────────────────────────────────────────── */}
          {layoutNodes.map((node) => {
            const midY = (node.y0 + node.y1) / 2;
            const nodeH = Math.max(node.y1 - node.y0, 2);
            const isHov = hoveredId === node.id;
            const pct = totalGross > 0 ? Math.round((node.value / totalGross) * 100) : 0;
            const clickable = !!onNodeClick && !!isClickable?.(node.id);

            return (
              <g
                key={node.id}
                onMouseEnter={(e) => {
                  setHoveredId(node.id);
                  setTooltip({
                    x: e.clientX, y: e.clientY, label: node.label, value: node.value, pct,
                    note: clickable ? "Click to see the breakdown" : undefined,
                  });
                }}
                onMouseMove={(e) => setTooltip((p) => p ? { ...p, x: e.clientX, y: e.clientY } : p)}
                onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
                onClick={clickable ? () => { setTooltip(null); setHoveredId(null); onNodeClick!(node.id); } : undefined}
                className={clickable ? "cursor-pointer" : "cursor-default"}
              >
                {isHov && (
                  <rect x={node.x0 - 2} y={node.y0 - 2} width={node.x1 - node.x0 + 4} height={nodeH + 4}
                    fill={node.color} opacity={0.25} rx={5} />
                )}
                <rect x={node.x0} y={node.y0} width={node.x1 - node.x0} height={nodeH}
                  fill={node.color} rx={4} opacity={isHov ? 1 : 0.88}
                  className="transition-opacity duration-150" />

                {/* Col 0 — name, then employer and amount, left of the bar */}
                {node.col === 0 && (() => {
                  const m = node.label.match(/^(.*?) \((.*)\)$/);
                  const name = m ? m[1] : node.label;
                  const employer = m ? m[2] : "";
                  return (
                    <>
                      <text x={node.x0 - 14} y={midY - 8} textAnchor="end" dominantBaseline="middle"
                        fontSize={12} fontWeight={700} fill={labelColor}>{name}</text>
                      <text x={node.x0 - 14} y={midY + 8} textAnchor="end" dominantBaseline="middle"
                        fontSize={11} fill={subColor}>{employer ? `${employer} · ` : ""}{fmtUSD(node.value)}</text>
                    </>
                  );
                })()}
                {/* Last column — one-line label right of the bar */}
                {node.col === lastCol && node.col > 0 && (
                  <text x={node.x1 + 14} y={sideLabelY[node.id] ?? midY} textAnchor="start" dominantBaseline="middle"
                    fontSize={11.5} fill={subColor}>
                    <tspan fontWeight={700} fill={labelColor}>{node.label}</tspan>
                    <tspan dx={6}>{fmtUSD(node.value)}</tspan>
                    <tspan dx={4}>· {pctOf(node.value)}%</tspan>
                    {clickable && <tspan dx={4} fill={labelColor}>›</tspan>}
                  </text>
                )}
                {/* Middle columns, roomy layout — one-line label right of the bar, haloed over ribbons */}
                {node.col > 0 && node.col < lastCol && roomyMiddle && (
                  <text x={node.x1 + 10} y={sideLabelY[node.id] ?? midY} textAnchor="start" dominantBaseline="middle"
                    fontSize={12} fill={subColor}
                    stroke={haloColor} strokeWidth={4} strokeOpacity={0.85} strokeLinejoin="round"
                    style={{ paintOrder: "stroke" }}>
                    <tspan fontWeight={700} fill={labelColor}>{node.label}</tspan>
                    <tspan dx={6}>{fmtUSD(node.value)}</tspan>
                    <tspan dx={4} fontWeight={700} fill={node.color === BUCKET.unallocated.color ? subColor : node.color}>
                      {pctOf(node.value)}%
                    </tspan>
                    {clickable && <tspan dx={4} fill={labelColor}>›</tspan>}
                  </text>
                )}
                {/* Middle columns, dense layout — small label above the bar if tall enough */}
                {node.col > 0 && node.col < lastCol && !roomyMiddle && nodeH > 14 && (
                  <>
                    <text x={(node.x0 + node.x1) / 2} y={node.y0 - 12} textAnchor="middle"
                      dominantBaseline="middle" fontSize={9} fontWeight={600} fill={labelColor}>
                      {node.label}
                    </text>
                    <text x={(node.x0 + node.x1) / 2} y={node.y0 - 2} textAnchor="middle"
                      dominantBaseline="middle" fontSize={9} fill={subColor}>
                      {fmtUSD(node.value)}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {tooltip && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-xl shadow-xl border
                     bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700
                     text-gray-900 dark:text-gray-100 px-4 py-3 text-sm"
          style={{ left: tooltip.x + 16, top: tooltip.y - 56 }}
        >
          <div className="font-semibold text-xs text-gray-500 dark:text-gray-400 mb-1">{tooltip.label}</div>
          <div className="font-bold text-base">{fmtFull(tooltip.value)}</div>
          {tooltip.pct !== undefined && (
            <div className="text-xs text-gray-400 mt-0.5">{tooltip.pct}% of gross</div>
          )}
          {tooltip.note && (
            <div className="text-xs text-gray-400 mt-0.5 italic">{tooltip.note}</div>
          )}
        </div>
      )}
    </>
  );
}

// ─── Payroll view state (summary / drill-down / detailed) ────────────────────

type PayrollView = "summary" | "detailed";
const VIEW_KEY = "sankey.payrollView";

function readStoredView(): PayrollView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "detailed" ? "detailed" : "summary";
  } catch {
    return "summary";
  }
}

const isDrillable = (id: string) => id in DRILL_LABELS;

function summaryLinkNote(link: { source: string; target: string }): string | undefined {
  if (link.source.startsWith("l1_") && SHARED_LINK_TARGETS.has(link.target)) {
    return link.target === BUCKET.saved.id
      ? "401k from the W-2; other saving split by take-home share"
      : "Split between earners by take-home share";
  }
  return undefined;
}

function PayrollToolbar({
  view, focus, onView, onFocus,
}: {
  view: PayrollView;
  focus: string[];
  onView: (v: PayrollView) => void;
  onFocus: (path: string[]) => void;
}) {
  const crumbs = [{ label: "Summary", path: [] as string[] }, ...focus.map((id, i) => ({
    label: DRILL_LABELS[id] ?? id, path: focus.slice(0, i + 1),
  }))];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-700 p-0.5">
        {(["summary", "detailed"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            className={`px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${
              view === v
                ? "bg-gray-900 text-white dark:bg-white dark:text-slate-900"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      {view === "summary" && (
        focus.length ? (
          <nav className="flex items-center gap-1 text-gray-500 dark:text-gray-400" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <React.Fragment key={c.label}>
                {i > 0 && <span aria-hidden>›</span>}
                {i < crumbs.length - 1 ? (
                  <button type="button" onClick={() => onFocus(c.path)}
                    className="hover:text-gray-900 dark:hover:text-white underline-offset-2 hover:underline">
                    {c.label}
                  </button>
                ) : (
                  <span className="font-semibold text-gray-900 dark:text-white">{c.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        ) : (
          <span className="text-gray-400">Click Taxes, Saved, Spent or a spending group for detail</span>
        )
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SankeyChartProps {
  data: SankeyData;
  height?: number;
}

export default function SankeyChart({ data, height: heightProp }: SankeyChartProps) {
  const isPayroll = data.sankey_type === "payroll";
  const containerRef  = useRef<HTMLDivElement>(null);
  const [width, setWidth]         = useState(700);
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setViewState] = useState<PayrollView>(readStoredView);
  const [focus, setFocus] = useState<string[]>([]);

  const setView = (v: PayrollView) => {
    setViewState(v);
    setFocus([]);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
  };

  // A new period starts back at the summary
  useEffect(() => { setFocus([]); }, [data]);

  const chartData = useMemo(() => {
    if (!isPayroll || view === "detailed") return data;
    return focus.length ? buildPayrollDrill(data, focus[focus.length - 1]) : buildPayrollSummary(data);
  }, [data, isPayroll, view, focus]);

  const height = heightProp ?? (!isPayroll ? 400 : view === "detailed" ? 520 : 420);

  const onNodeClick = (id: string) => {
    if (SPEND_GROUPS.some((g) => g.id === id)) setFocus([BUCKET.spent.id, id]);
    else setFocus([...focus, id]);
  };
  const interactive = isPayroll && view === "summary" && focus.length === 0;

  const renderCanvas = (w: number, h: number) =>
    isPayroll
      ? (
        <PayrollChartCanvas
          data={chartData} width={w} height={h}
          isClickable={interactive ? isDrillable : undefined}
          onNodeClick={interactive ? onNodeClick : undefined}
          linkNote={interactive ? summaryLinkNote : undefined}
        />
      )
      : <ChartCanvas data={chartData} width={w} height={h} />;

  const toolbar = isPayroll
    ? <PayrollToolbar view={view} focus={focus} onView={setView} onFocus={setFocus} />
    : null;

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
      {toolbar && <div className="mb-2 pr-8">{toolbar}</div>}

      {/* ── Inline chart ───────────────────────────────────────────── */}
      <div ref={containerRef} className="relative" style={{ height } as React.CSSProperties}>
        {/* Expand button */}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          title="Expand to full view"
          className={`absolute ${toolbar ? "-top-9" : "top-0"} right-0 z-10 p-1.5 rounded-lg text-gray-400
                     hover:text-gray-700 dark:hover:text-gray-200
                     hover:bg-gray-100 dark:hover:bg-slate-700
                     transition-colors duration-150`}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>

        {renderCanvas(width, height)}
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

            {toolbar && <div className="px-6 pt-3">{toolbar}</div>}

            {/* Modal chart — full width, tall */}
            <FullscreenChart
              heightPx={isPayroll ? (view === "detailed" ? FULL_H_PAYROLL : FULL_H_PAYROLL_SUMMARY) : FULL_H_STANDARD}
              render={renderCanvas}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ─── Fullscreen inner chart with its own size tracking ───────────────────────

const FULL_H_STANDARD = 560;
const FULL_H_PAYROLL = 680;
const FULL_H_PAYROLL_SUMMARY = 560;

function FullscreenChart({ heightPx, render }: { heightPx: number; render: (w: number, h: number) => React.ReactNode }) {
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
    <div ref={ref} style={{ height: heightPx }}>
      {render(width, heightPx)}
    </div>
  );
}
