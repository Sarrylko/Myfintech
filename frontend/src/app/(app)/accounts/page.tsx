"use client";

import CountryGate from "@/components/CountryGate";
import { AccountsContent } from "@/components/AccountsContent";

export default function AccountsPage() {
  return (
    <CountryGate allowedCountries={["US", "IN"]} featureName="Accounts">
      <AccountsContent />
    </CountryGate>
  );
}
