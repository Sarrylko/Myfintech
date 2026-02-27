"use client";

import { useState, useEffect, useRef } from "react";
import { getProfile, logout, UserResponse } from "@/lib/api";
import { useRouter } from "next/navigation";
import SettingsPanel, { SettingsTab } from "./SettingsPanel";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Props {
  initialProfile?: UserResponse | null;
  onProfileUpdate?: (p: UserResponse) => void;
}

export default function UserMenu({ initialProfile, onProfileUpdate }: Props) {
  const [profile, setProfile] = useState<UserResponse | null>(
    initialProfile ?? null
  );
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Sync when layout passes a freshly-fetched profile
  useEffect(() => {
    if (initialProfile) setProfile(initialProfile);
  }, [initialProfile]);

  // Fetch profile ourselves if not provided
  useEffect(() => {
    if (!initialProfile) {
      getProfile().then(setProfile).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Click-away to close dropdown
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleProfileUpdate(updated: UserResponse) {
    setProfile(updated);
    onProfileUpdate?.(updated);
  }

  async function handleSignOut() {
    await logout().catch(() => {});
    router.replace("/login");
  }

  function openSettings(tab: SettingsTab = "profile") {
    setOpen(false);
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

  const initials = profile ? getInitials(profile.full_name) : "…";

  return (
    <div ref={menuRef} className="relative">
      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold hover:bg-primary-700 transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 select-none"
        aria-label="User menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 z-50 py-1 overflow-hidden">
          {/* User header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {profile?.full_name ?? "Loading…"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {profile?.email}
            </p>
            {profile?.role && (
              <span
                className={`mt-1.5 inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                  profile.role === "owner"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                }`}
              >
                {profile.role === "owner" ? "Owner" : "Member"}
              </span>
            )}
          </div>

          {/* Settings */}
          <button
            onClick={() => openSettings("profile")}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center gap-2"
          >
            <span className="text-base">⚙</span>
            Settings
          </button>

          {/* Divider */}
          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 transition flex items-center gap-2"
          >
            <span className="text-base">↩</span>
            Sign Out
          </button>
        </div>
      )}

      {/* Settings slide-over */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsTab}
        profile={profile}
        onProfileUpdate={handleProfileUpdate}
      />
    </div>
  );
}
