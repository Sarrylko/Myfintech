"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getProfile, UserResponse } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import SettingsPanel, { SettingsTab } from "@/components/SettingsPanel";

const VALID_TABS: SettingsTab[] = [
  "profile",
  "security",
  "household",
  "categories",
  "preferences",
  "notifications",
  "accounts",
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as SettingsTab | null;
  const [profile, setProfile] = useState<UserResponse | null>(null);

  useEffect(() => {
    getProfile().then(setProfile).catch(() => {});
  }, []);

  const initialTab: SettingsTab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "profile";

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage your account, household, and connections"
      />
      <SettingsPanel
        asPage
        open={true}
        onClose={() => {}}
        initialTab={initialTab}
        profile={profile}
        onProfileUpdate={setProfile}
      />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400 py-8 text-center">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  );
}
