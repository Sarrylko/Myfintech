"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { fetchExchangeRates, getFxCacheAge } from "@/lib/forex";

interface ForexContextValue {
  /** Exchange rates map with USD as base (USD = 1). rates["GBP"] = 0.77 */
  rates: Record<string, number>;
  /** True while rates are being fetched for the first time */
  loading: boolean;
  /** True during a manual refresh triggered by the user */
  refreshing: boolean;
  /** Human-readable cache age, e.g. "3h ago". Null if never fetched. */
  lastUpdated: string | null;
  /** Force-refresh rates from the API, bypassing the cache */
  refreshRates: () => Promise<void>;
}

const ForexContext = createContext<ForexContextValue>({
  rates: {},
  loading: true,
  refreshing: false,
  lastUpdated: null,
  refreshRates: async () => {},
});

export function ForexProvider({ children }: { children: React.ReactNode }) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const r = await fetchExchangeRates(force);
      setRates(r);
      setLastUpdated(getFxCacheAge());
    } catch {
      // Network failure — keep existing rates if available
    }
  }, []);

  useEffect(() => {
    load(false).finally(() => setLoading(false));
  }, [load]);

  const refreshRates = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <ForexContext.Provider
      value={{ rates, loading, refreshing, lastUpdated, refreshRates }}
    >
      {children}
    </ForexContext.Provider>
  );
}

export function useForex(): ForexContextValue {
  return useContext(ForexContext);
}
