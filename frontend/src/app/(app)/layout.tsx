"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getToken, clearTokens } from "@/lib/api";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
    }
  }, [router, pathname]);

  function handleSignOut() {
    clearTokens();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
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
        <div className="p-6 border-t border-gray-800">
          <button
            onClick={handleSignOut}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition px-3 py-2 rounded-lg hover:bg-gray-800"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 bg-slate-50 min-h-screen">{children}</main>
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
  { href: "/rules", label: "Rules", icon: "⚡" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];
