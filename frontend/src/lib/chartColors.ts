export const CHART_COLORS = {
  navy:   "#003366",
  green:  "#007A33",
  sky:    "#0ea5e9",
  amber:  "#f59e0b",
  violet: "#8b5cf6",
  coral:  "#f43f5e",
  teal:   "#14b8a6",
  slate:  "#94a3b8",

  navyFade:   "rgba(0, 51, 102, 0)",
  greenFade:  "rgba(0, 122, 51, 0)",
  skyFade:    "rgba(14, 165, 233, 0)",
  coralFade:  "rgba(244, 63, 94, 0)",
  violetFade: "rgba(139, 92, 246, 0)",
  tealFade:   "rgba(20, 184, 166, 0)",
  amberFade:  "rgba(245, 158, 11, 0)",
};

/** Ordered palette for cycling through multi-series charts */
export const CHART_PALETTE = [
  CHART_COLORS.navy,
  CHART_COLORS.green,
  CHART_COLORS.sky,
  CHART_COLORS.amber,
  CHART_COLORS.violet,
  CHART_COLORS.coral,
  CHART_COLORS.teal,
  CHART_COLORS.slate,
];

export const CHART_AXIS_STYLE = {
  fontSize: 11,
  fill: "#7a8fa6",
  fontFamily: "var(--font-jakarta, ui-sans-serif)",
};

export const CHART_GRID_PROPS = {
  horizontal: true,
  vertical: false,
  stroke: "#e4e8ed",
  strokeOpacity: 0.5,
  strokeDasharray: "4 4",
};
