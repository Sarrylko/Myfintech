import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "MyFintech — Personal Finance Dashboard",
  description: "Track your net worth, budgets, and investments in one place.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex">
          {/* Sidebar */}
          <aside className="w-64 bg-gray-900 text-white p-6 hidden md:block">
            <h1 className="text-xl font-bold mb-8">MyFintech</h1>
            <nav className="space-y-2">
              <a href="/" className="block px-3 py-2 rounded hover:bg-gray-800">
                Dashboard
              </a>
              <a href="/accounts" className="block px-3 py-2 rounded hover:bg-gray-800">
                Accounts
              </a>
              <a href="/transactions" className="block px-3 py-2 rounded hover:bg-gray-800">
                Transactions
              </a>
              <a href="/budgets" className="block px-3 py-2 rounded hover:bg-gray-800">
                Budgets
              </a>
              <a href="/investments" className="block px-3 py-2 rounded hover:bg-gray-800">
                Investments
              </a>
              <a href="/properties" className="block px-3 py-2 rounded hover:bg-gray-800">
                Real Estate
              </a>
              <a href="/settings" className="block px-3 py-2 rounded hover:bg-gray-800">
                Settings
              </a>
            </nav>
          </aside>

          {/* Main content */}
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
