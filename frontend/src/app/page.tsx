import { APP_VERSION } from "@/lib/version";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-bold text-gray-900">MyFintech</span>
          <a
            href="/dashboard"
            className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition"
          >
            Open App
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-12 md:py-24 text-center">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 leading-tight mb-6">
          Your entire financial life,
          <br />
          <span className="text-primary-600">in one place.</span>
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
          MyFintech connects your bank accounts, investments, real estate, and
          tax documents to give you a clear picture of your net worth — updated
          automatically, stored on your own infrastructure.
        </p>
        <div className="flex gap-4 justify-center">
          <a
            href="/dashboard"
            className="bg-primary-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-primary-700 transition text-lg"
          >
            Get Started
          </a>
          <a
            href="#features"
            className="border border-gray-300 text-gray-700 px-8 py-3 rounded-lg font-semibold hover:bg-gray-50 transition text-lg"
          >
            Learn More
          </a>
        </div>

        {/* Hero visual */}
        <div className="mt-16 bg-gray-900 rounded-2xl p-8 text-left max-w-3xl mx-auto shadow-2xl">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="ml-2 text-gray-400 text-sm">Dashboard</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {[
              { label: "Net Worth", value: "$284,500" },
              { label: "Investments", value: "$198,400" },
              { label: "Cash", value: "$42,100" },
            ].map((card) => (
              <div key={card.label} className="bg-gray-800 rounded-lg p-3 sm:p-4">
                <p className="text-gray-400 text-xs mb-1">{card.label}</p>
                <p className="text-white font-bold text-base sm:text-lg">{card.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {[
              { label: "Real Estate", value: "$44,000" },
              { label: "Rental Income", value: "$1,850/mo" },
              { label: "Documents", value: "14 stored" },
            ].map((card) => (
              <div key={card.label} className="bg-gray-800 rounded-lg p-3 sm:p-4">
                <p className="text-gray-400 text-xs mb-1">{card.label}</p>
                <p className="text-white font-bold text-base sm:text-lg">{card.value}</p>
              </div>
            ))}
          </div>
          <div className="bg-gray-800 rounded-lg p-4 h-24 flex items-center justify-center">
            <div className="flex gap-1 items-end h-12">
              {[40, 55, 45, 60, 50, 70, 65, 80, 75, 90, 85, 100].map(
                (h, i) => (
                  <div
                    key={i}
                    className="w-4 bg-primary-500 rounded-sm opacity-80"
                    style={{ height: `${h}%` }}
                  />
                )
              )}
            </div>
            <span className="ml-6 text-gray-400 text-sm">Net Worth Growth</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-gray-50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">
            Everything you need to manage your wealth
          </h2>
          <p className="text-gray-500 text-center max-w-xl mx-auto mb-16">
            One dashboard for all your accounts, documents, and properties —
            with the data you need to make smart financial decisions.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm"
              >
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-semibold text-lg text-gray-900 mb-2">
                  {f.title}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-16">
            Up and running in minutes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {steps.map((step, i) => (
              <div key={step.title} className="text-center">
                <div className="w-12 h-12 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {i + 1}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">
                  {step.title}
                </h3>
                <p className="text-gray-500 text-sm">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary-600 py-20">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to take control?
          </h2>
          <p className="text-primary-100 mb-8">
            Open the app and link your first account in under two minutes.
          </p>
          <a
            href="/dashboard"
            className="bg-white text-primary-700 px-8 py-3 rounded-lg font-semibold hover:bg-primary-50 transition text-lg inline-block"
          >
            Open MyFintech
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-gray-400">
          <span>MyFintech &copy; {new Date().getFullYear()}</span>
          <span>Your data. Your control.</span>
          <span>v{APP_VERSION}</span>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    icon: "🏦",
    title: "Automatic Bank Sync",
    description:
      "Connect your checking, savings, and credit accounts via Plaid. Transactions sync automatically so your data is always current.",
  },
  {
    icon: "📊",
    title: "Net Worth Tracking",
    description:
      "See your total net worth across all assets — cash, investments, and real estate — with historical snapshots over time.",
  },
  {
    icon: "💸",
    title: "Budget Management",
    description:
      "Set monthly spending limits by category and get alerts when you're approaching them. Stay on top of where your money goes.",
  },
  {
    icon: "📈",
    title: "Investment Portfolio",
    description:
      "Track brokerage and retirement holdings across Plaid and SnapTrade-connected brokers. See cost basis, unrealized gains, and account allocation in one view.",
  },
  {
    icon: "🏠",
    title: "Real Estate",
    description:
      "Add properties with loans, recurring costs, and maintenance expenses. Track valuations, equity, and documents for each property.",
  },
  {
    icon: "🏘",
    title: "Rental Income",
    description:
      "Manage tenants, leases, and rent payments for your rental properties. Track income and expenses for tax reporting.",
  },
  {
    icon: "📁",
    title: "Tax & Document Vault",
    description:
      "Upload and organise W-2s, 1099s, prior-year returns, investment statements, insurance policies, and estate documents — all in one secure place.",
  },
  {
    icon: "🔁",
    title: "Recurring Bills & Smart Rules",
    description:
      "Track subscriptions and recurring expenses automatically. Set rules to categorise transactions the moment they arrive.",
  },
  {
    icon: "🔒",
    title: "Private & Secure",
    description:
      "Self-hosted on your own infrastructure. httpOnly cookies, rate-limited login, account lockout, and Fernet-encrypted storage. Your data is never sold or shared.",
  },
];

const steps = [
  {
    title: "Open the app",
    description:
      "Create your account and log in to the MyFintech dashboard on any device.",
  },
  {
    title: "Link your accounts",
    description:
      "Connect your bank, credit cards, and brokerages securely via Plaid or SnapTrade with read-only access.",
  },
  {
    title: "See your full picture",
    description:
      "Your net worth, transactions, budgets, investments, and documents update automatically from that point on.",
  },
];
