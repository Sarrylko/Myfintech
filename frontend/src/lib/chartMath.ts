/** Compute a linear regression trendline and return y values for each x index. */
export function linearTrend(values: (number | null)[]): (number | null)[] {
  const pts = values
    .map((v, i) => (v !== null ? { x: i, y: v } : null))
    .filter(Boolean) as { x: number; y: number }[];
  if (pts.length < 2) return values.map(() => null);

  const n = pts.length;
  const sumX = pts.reduce((s, p) => s + p.x, 0);
  const sumY = pts.reduce((s, p) => s + p.y, 0);
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return values.map(() => null);

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return values.map((v, i) =>
    v !== null ? parseFloat((slope * i + intercept).toFixed(2)) : null
  );
}
