"use client";

import CountryGate from "@/components/CountryGate";
import { SyncHealthContent } from "@/components/SyncHealthContent";

export default function SyncHealthPage() {
  return (
    <CountryGate allowedCountries={["US", "IN"]} featureName="Sync Health">
      <SyncHealthContent />
    </CountryGate>
  );
}
