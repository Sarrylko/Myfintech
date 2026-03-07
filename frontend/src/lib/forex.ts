const FRANKFURTER_URL = "https://api.frankfurter.app/latest?base=USD";
const CACHE_KEY = "fx_rates_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface FxCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

/**
 * Fetch USD-based exchange rates from frankfurter.app (free, ECB data, no API key).
 * Caches result in localStorage for 6 hours. Pass force=true to bypass cache.
 * Rate format: rates["GBP"] = 0.77 means 1 USD = 0.77 GBP.
 */
export async function fetchExchangeRates(
  force = false
): Promise<Record<string, number>> {
  if (!force) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cache: FxCache = JSON.parse(raw);
        if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
          return cache.rates;
        }
      }
    } catch {}
  }

  const res = await fetch(FRANKFURTER_URL);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json();
  const rates: Record<string, number> = { USD: 1, ...data.rates };

  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ rates, fetchedAt: Date.now() } satisfies FxCache)
    );
  } catch {}

  return rates;
}

/**
 * Convert an amount in any currency to USD using the provided rates map.
 * rates["GBP"] = 0.77 → GBP→USD: amount / 0.77
 * Falls back to 1:1 if the currency is unknown.
 */
export function convertToUSD(
  amount: number,
  fromCurrency: string,
  rates: Record<string, number>
): number {
  if (!fromCurrency || fromCurrency === "USD") return amount;
  const rate = rates[fromCurrency];
  if (!rate) return amount; // unknown currency — treat as 1:1
  return amount / rate;
}

/**
 * Format an amount in any ISO 4217 currency using the browser's Intl API.
 * Does not depend on the household currency context.
 */
export function fmtInCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currencyCode} ${Math.round(amount).toLocaleString()}`;
  }
}

/**
 * Return a human-readable string describing how old the cached rates are.
 * Returns null if no cache exists.
 */
export function getFxCacheAge(): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: FxCache = JSON.parse(raw);
    const ageMs = Date.now() - cache.fetchedAt;
    const ageMin = Math.floor(ageMs / 60000);
    if (ageMin < 1) return "just now";
    if (ageMin < 60) return `${ageMin}m ago`;
    return `${Math.floor(ageMin / 60)}h ago`;
  } catch {
    return null;
  }
}
