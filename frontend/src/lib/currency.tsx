"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getHouseholdSettings, HouseholdSettings } from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormatOptions {
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
}

interface CurrencyContextValue {
  /** ISO 4217 code, e.g. "USD" */
  currency: string;
  /** BCP 47 locale, e.g. "en-US" */
  locale: string;
  /** ISO 3166-1 alpha-2, e.g. "US" */
  countryCode: string;
  /** Currency symbol extracted from Intl, e.g. "$" */
  symbol: string;
  /** Format a monetary value using the household locale/currency */
  fmt: (value: number, opts?: FormatOptions) => string;
  /** Compact format: $1.2M, £850K */
  fmtCompact: (value: number) => string;
  /** Format a date string "YYYY-MM-DD" using the household locale */
  fmtDate: (date: string) => string;
  /** True while the settings are being fetched */
  loading: boolean;
  /** Re-fetch household settings (call after saving locale/currency preferences) */
  refreshSettings: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "USD",
  locale: "en-US",
  countryCode: "US",
  symbol: "$",
  fmt: (v) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Math.abs(v)),
  fmtCompact: (v) => `$${Math.abs(v) >= 1_000_000 ? (v / 1_000_000).toFixed(1) + "M" : Math.abs(v) >= 1_000 ? (v / 1_000).toFixed(0) + "K" : v}`,
  fmtDate: (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  loading: true,
  refreshSettings: () => {},
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSymbol(locale: string, currency: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).formatToParts(1);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<HouseholdSettings>({
    default_currency: "USD",
    default_locale: "en-US",
    country_code: "US",
  });
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(() => {
    getHouseholdSettings()
      .then(setSettings)
      .catch(() => {/* keep defaults on error */})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const { default_currency: currency, default_locale: locale, country_code: countryCode } = settings;

  const symbol = extractSymbol(locale, currency);

  const fmt = useCallback(
    (value: number, opts: FormatOptions = {}) => {
      const { maximumFractionDigits = 0, minimumFractionDigits = 0 } = opts;
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits,
        minimumFractionDigits,
      }).format(Math.abs(value));
    },
    [locale, currency]
  );

  const fmtCompact = useCallback(
    (value: number) => {
      const abs = Math.abs(value);
      if (abs >= 1_000_000) {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits: 1,
          notation: "compact",
        } as Intl.NumberFormatOptions).format(value);
      }
      if (abs >= 1_000) {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(value);
      }
      return fmt(value);
    },
    [locale, currency, fmt]
  );

  const fmtDate = useCallback(
    (date: string) =>
      new Date(date + "T00:00:00").toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [locale]
  );

  return (
    <CurrencyContext.Provider
      value={{ currency, locale, countryCode, symbol, fmt, fmtCompact, fmtDate, loading, refreshSettings: fetchSettings }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
