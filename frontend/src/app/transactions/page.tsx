export default function TransactionsPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Transactions</h2>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <input
          type="text"
          placeholder="Search transactions..."
          className="border border-gray-300 rounded-lg px-4 py-2 flex-1"
        />
        <select className="border border-gray-300 rounded-lg px-4 py-2">
          <option>All Accounts</option>
        </select>
        <select className="border border-gray-300 rounded-lg px-4 py-2">
          <option>All Categories</option>
        </select>
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-lg shadow border border-gray-100">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 text-left text-sm text-gray-500">
              <th className="px-6 py-3">Date</th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Account</th>
              <th className="px-6 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                No transactions to display. Link an account to get started.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
