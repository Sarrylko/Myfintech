"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getHouseholdSettings, switchActiveCountry, CountryProfile, HouseholdSettings } from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormatOptions {
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
}

interface CurrencyContextValue {
  /** ISO 4217 code for the active country, e.g. "USD" or "INR" */
  currency: string;
  /** BCP 47 locale for the active country, e.g. "en-US" or "en-IN" */
  locale: string;
  /** ISO 3166-1 alpha-2, the household's primary country e.g. "US" */
  countryCode: string;
  /** Currently selected country code (may differ from primary) */
  activeCountryCode: string;
  /** All country profiles configured for this household */
  countryProfiles: CountryProfile[];
  /** Currency symbol extracted from Intl, e.g. "$" or "₹" */
  symbol: string;
  /** Format a monetary value using the active country locale/currency */
  fmt: (value: number, opts?: FormatOptions) => string;
  /** Compact format: $1.2M, ₹12.3L */
  fmtCompact: (value: number) => string;
  /** Format a date string "YYYY-MM-DD" using the active country locale */
  fmtDate: (date: string | null | undefined) => string;
  /** True while the settings are being fetched */
  loading: boolean;
  /** Re-fetch household settings (call after saving locale/currency preferences) */
  refreshSettings: () => void;
  /** Switch the active country context for all users in the household */
  switchCountry: (code: string) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "USD",
  locale: "en-US",
  countryCode: "US",
  activeCountryCode: "US",
  countryProfiles: [],
  symbol: "$",
  fmt: (v) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Math.abs(v)),
  fmtCompact: (v) => `$${Math.abs(v) >= 1_000_000 ? (v / 1_000_000).toFixed(1) + "M" : Math.abs(v) >= 1_000 ? (v / 1_000).toFixed(0) + "K" : v}`,
  fmtDate: (d) => d ? new Date(d.includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
  loading: true,
  refreshSettings: () => {},
  switchCountry: async () => {},
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

const DEFAULT_SETTINGS: HouseholdSettings = {
  default_currency: "USD",
  default_locale: "en-US",
  country_code: "US",
  active_country_code: "US",
  country_profiles: [],
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<HouseholdSettings>(DEFAULT_SETTINGS);
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

  const {
    default_currency: currency,
    default_locale: locale,
    country_code: countryCode,
    active_country_code: activeCountryCode,
    country_profiles: countryProfiles,
  } = settings;

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
    (date: string | null | undefined) =>
      date
        ? new Date(date.includes("T") ? date : date + "T00:00:00").toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "—",
    [locale]
  );

  const switchCountry = useCallback(
    async (code: string) => {
      const updated = await switchActiveCountry(code);
      setSettings(updated);
    },
    []
  );

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        locale,
        countryCode,
        activeCountryCode,
        countryProfiles,
        symbol,
        fmt,
        fmtCompact,
        fmtDate,
        loading,
        refreshSettings: fetchSettings,
        switchCountry,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
