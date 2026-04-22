"use client";

import { useCurrency } from "@/lib/currency";

const FLAG: Record<string, string> = {
  US: "🇺🇸",
  IN: "🇮🇳",
};

interface CountryGateProps {
  /** Only allow access when activeCountryCode matches one of these */
  allowedCountries: string[];
  /** What to show inside when access is allowed */
  children: React.ReactNode;
  /** Optional label for the blocked-country message */
  featureName?: string;
}

/**
 * Renders children only when the household's active country is in allowedCountries.
 * Otherwise shows a friendly empty state directing the user to switch country context.
 */
export default function CountryGate({
  allowedCountries,
  children,
  featureName,
}: CountryGateProps) {
  const { activeCountryCode, countryProfiles, switchCountry } = useCurrency();

  if (allowedCountries.includes(activeCountryCode)) {
    return <>{children}</>;
  }

  const allowed = countryProfiles.filter((p) => allowedCountries.includes(p.country_code));
  const current = countryProfiles.find((p) => p.country_code === activeCountryCode);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-5 px-6">
      <span className="text-6xl">{FLAG[activeCountryCode] ?? "🌐"}</span>
      <div>
        <h2 className="text-xl font-semibold text-content-primary mb-1">
          {featureName
            ? `${featureName} is not available in ${current?.country_name ?? activeCountryCode} context`
            : `No data for ${current?.country_name ?? activeCountryCode}`}
        </h2>
        <p className="text-sm text-content-muted max-w-sm">
          {allowed.length > 0
            ? `Switch to ${allowed.map((p) => p.country_name).join(" or ")} to view this section.`
            : "This section has no data for the currently selected country."}
        </p>
      </div>
      {allowed.map((p) => (
        <button
          key={p.country_code}
          type="button"
          onClick={() => switchCountry(p.country_code)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-700 text-white text-sm font-medium hover:bg-primary-800 transition"
        >
          {FLAG[p.country_code] ?? p.country_code}
          Switch to {p.country_name}
        </button>
      ))}
    </div>
  );
}
