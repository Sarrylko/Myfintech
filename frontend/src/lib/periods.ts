/** Date-range helpers for period-over-period comparisons. */

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Same day-of-month `months` earlier, clamped (Mar 31 − 1 month → Feb 28).
 * A month's last day maps to the target month's last day (Sep 30 → Aug 31).
 */
function shiftMonths(d: Date, months: number, endOfDay: boolean): Date {
  const y = d.getFullYear();
  const m = d.getMonth() - months;
  const target = new Date(y, m, 1);
  const targetDays = daysInMonth(target.getFullYear(), target.getMonth());
  const isLastDay = d.getDate() === daysInMonth(d.getFullYear(), d.getMonth());
  const day = isLastDay ? targetDays : Math.min(d.getDate(), targetDays);
  return endOfDay
    ? new Date(target.getFullYear(), target.getMonth(), day, 23, 59, 59, 999)
    : new Date(target.getFullYear(), target.getMonth(), day);
}

export interface ComparisonWindows {
  /** The selected range clipped to today */
  elapsedTo: Date;
  /** Same elapsed stretch of the previous period (e.g. Sep 1–21 for Oct 1–21) */
  prevFrom: Date;
  prevTo: Date;
  /** The whole previous period (e.g. all of September); used for projection */
  prevFullTo: Date;
  /** True when the selected range runs past today (period still in progress) */
  inProgress: boolean;
}

/**
 * The previous period to compare `from..to` against. Ranges starting on the
 * 1st shift by whole months (so Oct 1–21 compares to Sep 1–21, and Jan 1–Oct 21
 * to the same dates last year); other ranges shift back by their own length.
 * Null for open-ended or future ranges.
 */
export function comparisonWindows(from: Date | null, to: Date | null, now = new Date()): ComparisonWindows | null {
  if (!from || from > now) return null;
  const end = to ?? now;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  // Still in progress only if the range runs past today (e.g. "This Month"),
  // not merely to the end of today (e.g. "Last 30 Days")
  const inProgress = end > endOfToday;
  const elapsedTo = end > now ? now : end;

  if (from.getDate() === 1) {
    const span = (end.getFullYear() - from.getFullYear()) * 12 + (end.getMonth() - from.getMonth()) + 1;
    // Year-to-date and other ranges starting in January compare with the same
    // stretch of last year rather than the months just before
    const months = from.getMonth() === 0 && span > 1 ? 12 : span;
    return {
      elapsedTo,
      inProgress,
      prevFrom: shiftMonths(from, months, false),
      prevTo: shiftMonths(elapsedTo, months, true),
      prevFullTo: shiftMonths(end, months, true),
    };
  }
  const span = end.getTime() - from.getTime();
  const elapsedSpan = elapsedTo.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span - 1);
  return {
    elapsedTo,
    inProgress,
    prevFrom,
    prevTo: new Date(prevFrom.getTime() + elapsedSpan),
    prevFullTo: new Date(from.getTime() - 1),
  };
}

/** "2026-10" for a date (local time) */
export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The 12 month keys ending with the month of `anchor`, oldest first. */
export function trailingMonthKeys(anchor: Date, count = 12): string[] {
  return Array.from({ length: count }, (_, i) => monthKeyOf(new Date(anchor.getFullYear(), anchor.getMonth() - (count - 1 - i), 1)));
}
