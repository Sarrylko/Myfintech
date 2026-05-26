"use client";

import { useCurrency } from "@/lib/currency";

interface TooltipEntry {
  name: string;
  value: number | null;
  color: string;
  /** If true, format value as a plain number (e.g. count). Default: currency */
  plain?: boolean;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number | null; color: string; payload?: Record<string, unknown> }[];
  label?: string | number;
  labelFormatter?: (label: string | number) => string;
  valueFormatter?: (value: number, name: string) => string;
  entries?: TooltipEntry[];
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: ChartTooltipProps) {
  const { fmt } = useCurrency();

  if (!active || !payload || payload.length === 0) return null;

  const displayLabel = label != null
    ? (labelFormatter ? labelFormatter(label) : String(label))
    : null;

  return (
    <div className="
      rounded-xl border border-[var(--border)] bg-[var(--bg-card)]
      shadow-lg px-3 py-2.5 min-w-[140px]
      text-[var(--text-primary)]
    ">
      {displayLabel && (
        <p className="text-[11px] font-medium text-[var(--text-muted)] mb-1.5 pb-1.5 border-b border-[var(--border-subtle)]">
          {displayLabel}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => {
          if (entry.value === null || entry.value === undefined) return null;
          const formatted = valueFormatter
            ? valueFormatter(entry.value, entry.name)
            : fmt(entry.value);
          return (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-[11px] text-[var(--text-secondary)]">{entry.name}</span>
              </div>
              <span className="text-[12px] font-semibold tabular-nums">{formatted}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
