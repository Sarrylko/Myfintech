import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // ── Brand navy palette (Finance Authority: #003366) ──
        primary: {
          50:  "#e6eef7",
          100: "#b3ccee",
          200: "#80aae5",
          300: "#4d88dc",
          400: "#1a66d3",
          500: "#0044aa",
          600: "#003d99",
          700: "#003366",
          800: "#002952",
          900: "#001a33",
        },
        // ── Finance green accent (#007A33) ──
        finance: {
          50:  "#eaf5ee",
          100: "#c0e6cb",
          200: "#96d7a8",
          300: "#6cc885",
          400: "#42b962",
          500: "#007A33",
          600: "#006b2c",
          700: "#005c25",
          800: "#004d1e",
          900: "#003e17",
        },

        // ── Semantic surface tokens ──
        page:     "var(--bg-page)",
        card:     "var(--bg-card)",
        elevated: "var(--bg-elevated)",
        subtle:   "var(--bg-subtle)",
        muted:    "var(--bg-muted)",

        // ── Sidebar (always-dark) ──
        sidebar: {
          DEFAULT:           "var(--sidebar-bg)",
          border:            "var(--sidebar-border)",
          text:              "var(--sidebar-text)",
          "text-hover":      "var(--sidebar-text-hover)",
          active:            "var(--sidebar-active-bg)",
          "active-text":     "var(--sidebar-active-text)",
          indicator:         "var(--sidebar-active-indicator)",  /* #FD7B41 */
          label:             "var(--sidebar-section-label)",
          "footer-border":   "var(--sidebar-footer-border)",
        },

        // ── Border tokens ──
        // Generates: border-border, border-border-subtle, border-border-strong
        border: {
          DEFAULT: "var(--border)",
          subtle:  "var(--border-subtle)",
          strong:  "var(--border-strong)",
        },

        // ── Content / Typography tokens ──
        // Generates: text-content-primary, text-content-secondary, text-content-muted, text-content-disabled
        content: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted:     "var(--text-muted)",
          disabled:  "var(--text-disabled)",
        },
      },

      boxShadow: {
        xs:   "var(--shadow-xs)",
        card: "var(--shadow-sm)",
        // Overrides Tailwind's shadow-md and shadow-lg with CSS var versions
        md:   "var(--shadow-md)",
        lg:   "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
};
export default config;
