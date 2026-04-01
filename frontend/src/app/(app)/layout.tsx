"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Landmark,
  TrendingUp,
  Building2,
  KeyRound,
  Briefcase,
  Shield,
  Sunrise,
  ArrowLeftRight,
  Target,
  Flag,
  RefreshCw,
  FileSpreadsheet,
  Zap,
  Bot,
  Settings2,
  Menu,
  X,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { getProfile, UserResponse } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import { useTheme } from "@/components/ThemeProvider";
import UserMenu from "@/components/UserMenu";
import { CurrencyProvider } from "@/lib/currency";
import { ForexProvider } from "@/components/ForexProvider";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Assets",
    items: [
      { href: "/investments", label: "Investments", icon: TrendingUp },
      { href: "/properties", label: "Real Estate", icon: Building2 },
      { href: "/rentals", label: "Rentals", icon: KeyRound },
      { href: "/business", label: "Business", icon: Briefcase },
      { href: "/insurance", label: "Insurance", icon: Shield },
      { href: "/retirement", label: "Retirement", icon: Sunrise },
    ],
  },
  {
    label: "Finances",
    items: [
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/budgets", label: "Budgets", icon: Target },
      { href: "/goals", label: "Goals", icon: Flag },
      { href: "/recurring", label: "Recurring", icon: RefreshCw },
      { href: "/taxes", label: "Tax Center", icon: FileSpreadsheet },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/rules", label: "Rules", icon: Zap },
      { href: "/ai", label: "AI Assistant", icon: Bot },
    ],
  },
];

// Flat list for currentPage lookup (includes Settings for header title)
const settingsNavItem = { href: "/settings", label: "Settings", icon: Settings2 };
const allNavItems = [...navSections.flatMap((s) => s.items), settingsNavItem];

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  onClick?: () => void;
}) {
  const active =
    pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      onClick={onClick}
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100 border-l-2 ${
        active
          ? "bg-white/10 text-white border-primary-400"
          : "text-gray-400 hover:bg-white/5 hover:text-gray-200 border-transparent"
      }`}
    >
      <Icon
        className={`w-4 h-4 shrink-0 transition-colors ${
          active ? "text-primary-400" : "text-gray-500 group-hover:text-gray-300"
        }`}
      />
      <span className="truncate">{item.label}</span>
    </a>
  );
}

function SidebarContents({
  pathname,
  theme,
  toggleTheme,
  onClose,
}: {
  pathname: string;
  theme: string;
  toggleTheme: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="p-5 flex-1 overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center justify-between mb-6">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold tracking-tight">M</span>
            </div>
            <span className="text-[15px] font-bold text-white tracking-tight">
              MyFintech
            </span>
          </a>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-white/10 transition"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Nav sections */}
        <nav>
          {navSections.map((section, i) => (
            <div key={section.label} className={i > 0 ? "mt-5" : ""}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold text-gray-600 tracking-widest uppercase">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    onClick={onClose}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 border-t border-white/5 pt-4 space-y-1">
        <NavLink item={settingsNavItem} pathname={pathname} onClick={onClose} />
        <button
          type="button"
          onClick={toggleTheme}
          className="w-full text-left text-sm text-gray-400 hover:text-white transition px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="w-4 h-4 shrink-0 text-gray-500" />
          ) : (
            <Moon className="w-4 h-4 shrink-0 text-gray-500" />
          )}
          <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
        </button>
        <p className="px-3 text-[11px] text-gray-700">v{APP_VERSION}</p>
      </div>
    </>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profile, setProfile] = useState<UserResponse | null>(null);

  useEffect(() => {
    getProfile().then(setProfile).catch(() => {});
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const currentPage =
    allNavItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    )?.label ?? "MyFintech";

  return (
    <div className="min-h-screen flex">
      {/* ── Mobile top bar ─────────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-gray-900 text-white flex items-center px-4 gap-3">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="p-1.5 rounded hover:bg-white/10 transition shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="flex-1 text-sm font-semibold truncate">
          {currentPage}
        </span>
        <UserMenu initialProfile={profile} onProfileUpdate={setProfile} />
      </header>

      {/* ── Mobile drawer backdrop ──────────────────────────────── */}
      <div
        className={`md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
          drawerOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* ── Mobile slide-out drawer ─────────────────────────────── */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-64 bg-gray-900 text-white z-50 flex flex-col transform transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContents
          pathname={pathname}
          theme={theme}
          toggleTheme={toggleTheme}
          onClose={() => setDrawerOpen(false)}
        />
      </aside>

      {/* ── Desktop sidebar ─────────────────────────────────────── */}
      <aside className="w-60 bg-gray-900 text-white flex-col hidden md:flex fixed top-0 left-0 h-screen z-30">
        <SidebarContents
          pathname={pathname}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      </aside>

      {/* ── Main content area ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-screen bg-slate-50 dark:bg-gray-950 md:ml-60">
        {/* Desktop top header */}
        <header className="hidden md:flex h-14 items-center justify-between px-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0 sticky top-0 z-20">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {currentPage}
          </span>
          <UserMenu initialProfile={profile} onProfileUpdate={setProfile} />
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 pt-[4.5rem] md:pt-6">
          <CurrencyProvider>
            <ForexProvider>{children}</ForexProvider>
          </CurrencyProvider>
        </main>
      </div>
    </div>
  );
}
