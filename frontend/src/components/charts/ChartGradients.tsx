/** Drop this inside any Recharts chart that needs gradient area fills. */
export function ChartGradients() {
  return (
    <defs>
      <linearGradient id="gradNavy" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#003366" stopOpacity={0.18} />
        <stop offset="95%" stopColor="#003366" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#007A33" stopOpacity={0.18} />
        <stop offset="95%" stopColor="#007A33" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.18} />
        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradCoral" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.18} />
        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradViolet" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.18} />
        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradTeal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#14b8a6" stopOpacity={0.18} />
        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradAmber" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.18} />
        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="gradSlate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.12} />
        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}
