export default function AccountsPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Accounts</h2>
        <button className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition">
          + Link Account
        </button>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-100">
        <div className="p-12 text-center text-gray-400">
          <p className="text-lg mb-2">No accounts linked yet</p>
          <p className="text-sm">
            Click &quot;Link Account&quot; to connect your bank, credit card, or
            brokerage accounts via Plaid.
          </p>
        </div>
      </div>
    </div>
  );
}
