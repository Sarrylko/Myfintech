export default function SettingsPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <div className="space-y-6">
        {/* Profile */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Full Name</label>
              <input
                type="text"
                className="border border-gray-300 rounded-lg px-4 py-2 w-full"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Email</label>
              <input
                type="email"
                className="border border-gray-300 rounded-lg px-4 py-2 w-full"
                placeholder="you@example.com"
              />
            </div>
          </div>
        </section>

        {/* Household */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Household</h3>
          <p className="text-sm text-gray-500 mb-4">
            Manage household members and roles.
          </p>
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition">
            Invite Member
          </button>
        </section>

        {/* Linked Accounts */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Linked Accounts</h3>
          <p className="text-sm text-gray-400">
            No accounts linked. Go to Accounts to link your first institution.
          </p>
        </section>

        {/* Categorization Rules */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Categorization Rules</h3>
          <p className="text-sm text-gray-400 mb-4">
            Create rules to automatically categorize transactions.
          </p>
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition">
            + Add Rule
          </button>
        </section>

        {/* Export */}
        <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-lg mb-4">Data Export</h3>
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition">
            Export Transactions (CSV)
          </button>
        </section>
      </div>
    </div>
  );
}
