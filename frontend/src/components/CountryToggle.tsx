"use client";

import { useRef, useState, useEffect } from "react";
import { useCurrency } from "@/lib/currency";

// Flag emoji by ISO 3166-1 alpha-2 country code
function countryFlag(code: string): string {
  // Convert country code to regional indicator emoji (🇺🇸, 🇮🇳, etc.)
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

export default function CountryToggle() {
  const { activeCountryCode, countryProfiles, switchCountry, loading } = useCurrency();
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (loading || countryProfiles.length < 2) return null;

  // Two-country mode: single click toggles
  if (countryProfiles.length === 2) {
    const next = countryProfiles.find((p) => p.country_code !== activeCountryCode);
    if (!next) return null;

    const handleToggle = async () => {
      if (switching) return;
      setSwitching(true);
      try {
        await switchCountry(next!.country_code);
      } finally {
        setSwitching(false);
      }
    };

    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={switching}
        title={`Active: ${activeCountryCode} — click to switch to ${next.country_name}`}
        className="w-8 h-8 rounded-full flex items-center justify-center text-lg hover:bg-subtle transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 select-none"
        aria-label={`Switch to ${next.country_name}`}
      >
        {switching ? (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
        ) : (
          countryFlag(activeCountryCode)
        )}
      </button>
    );
  }

  // Three+ country mode: dropdown picker
  const active = countryProfiles.find((p) => p.country_code === activeCountryCode);

  async function handleSelect(code: string) {
    setOpen(false);
    if (code === activeCountryCode || switching) return;
    setSwitching(true);
    try {
      await switchCountry(code);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        title={`Active country: ${active?.country_name ?? activeCountryCode}`}
        className="w-8 h-8 rounded-full flex items-center justify-center text-lg hover:bg-subtle transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 select-none"
        aria-label="Switch country"
        aria-expanded={open ? "true" : "false"}
      >
        {switching ? (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
        ) : (
          countryFlag(activeCountryCode)
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-44 bg-elevated border border-border rounded-xl shadow-lg z-50 py-1 overflow-hidden">
          {countryProfiles.map((profile) => (
            <button
              key={profile.country_code}
              type="button"
              onClick={() => handleSelect(profile.country_code)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-subtle transition ${
                profile.country_code === activeCountryCode
                  ? "font-semibold text-content-primary"
                  : "text-content-secondary"
              }`}
            >
              <span className="text-base">{countryFlag(profile.country_code)}</span>
              <span>{profile.country_name}</span>
              <span className="ml-auto text-xs text-content-muted">{profile.currency_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
