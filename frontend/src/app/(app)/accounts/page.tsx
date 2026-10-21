"use client";

import { Suspense } from "react";
import CountryGate from "@/components/CountryGate";
import { AccountsContent } from "@/components/AccountsContent";

export default function AccountsPage() {
  return (
    <CountryGate allowedCountries={["US", "IN"]} featureName="Accounts">
      <Suspense fallback={null}>
        <AccountsContent />
      </Suspense>
    </CountryGate>
  );
}
