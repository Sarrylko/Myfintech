"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { logout } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import { useTheme } from "@/components/ThemeProvider";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    // With httpOnly cookies, we can't check localStorage — a failed API call in
    // apiFetch will auto-redirect to /login when the session expires.
    // This effect does nothing but satisfies the dependency lint.
  }, [router, pathname]);

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    await logout().catch(() => {});
    router.replace("/login");
  }

  const currentPage =
    navItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    )?.label ?? "MyFintech";

  return (
    <div className="min-h-screen flex">
      {/* ── Mobile top bar ─────────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-gray-900 text-white flex items-center px-4">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="p-1.5 rounded hover:bg-gray-800 transition"
          aria-label="Open menu"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <span className="flex-1 text-center text-sm font-semibold">
          {currentPage}
        </span>
        {/* right spacer keeps title centered */}
        <div className="w-8" />
      </header>

      {/* ── Mobile drawer backdrop ──────────────────────────────── */}
      <div
        className={`md:hidden fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${
          drawerOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* ── Mobile slide-out drawer ─────────────────────────────── */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-64 bg-gray-900 text-white z-50 flex flex-col transform transition-transform duration-300 ease-in-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-8">
            <a
              href="/"
              className="text-xl font-bold hover:text-primary-400 transition"
            >
              MyFintech
            </a>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition"
              aria-label="Close menu"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm ${
                    active
                      ? "bg-gray-700 text-white"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>
        <div className="p-6 border-t border-gray-800 space-y-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition px-3 py-2 rounded-lg hover:bg-gray-800 flex items-center gap-2"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition px-3 py-2 rounded-lg hover:bg-gray-800"
          >
            Sign Out
          </button>
          <p className="mt-2 px-3 text-xs text-gray-600">v{APP_VERSION}</p>
        </div>
      </aside>

      {/* ── Desktop sidebar (unchanged) ─────────────────────────── */}
      <aside className="w-64 bg-gray-900 text-white flex-col hidden md:flex">
        <div className="p-6 flex-1">
          <a
            href="/"
            className="block text-xl font-bold mb-8 hover:text-primary-400 transition"
          >
            MyFintech
          </a>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition text-sm text-gray-300 hover:text-white"
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="p-6 border-t border-gray-800 space-y-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition px-3 py-2 rounded-lg hover:bg-gray-800 flex items-center gap-2"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition px-3 py-2 rounded-lg hover:bg-gray-800"
          >
            Sign Out
          </button>
          <p className="mt-2 px-3 text-xs text-gray-600">v{APP_VERSION}</p>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      {/* pt-[4.5rem] on mobile = 56px top bar + 16px gap; md:pt-8 restores original */}
      <main className="flex-1 p-8 pt-[4.5rem] md:pt-8 bg-slate-50 dark:bg-gray-950 min-h-screen">
        {children}
      </main>
    </div>
  );
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "◻" },
  { href: "/accounts", label: "Accounts", icon: "🏦" },
  { href: "/transactions", label: "Transactions", icon: "↕" },
  { href: "/budgets", label: "Budgets", icon: "💸" },
  { href: "/investments", label: "Investments", icon: "📈" },
  { href: "/properties", label: "Real Estate", icon: "🏠" },
  { href: "/rentals", label: "Rentals", icon: "🏘" },
  { href: "/taxes", label: "Tax Center", icon: "📊" },
  { href: "/recurring", label: "Recurring", icon: "🔁" },
  { href: "/rules", label: "Rules", icon: "⚡" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];
