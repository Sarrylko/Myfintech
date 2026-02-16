export default function InvestmentsPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Investments</h2>

      {/* Portfolio summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Total Portfolio Value</p>
          <p className="text-2xl font-bold">—</p>
        </div>
        <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Total Cost Basis</p>
          <p className="text-2xl font-bold">—</p>
        </div>
        <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Total Gain/Loss</p>
          <p className="text-2xl font-bold">—</p>
        </div>
      </div>

      {/* Holdings table */}
      <div className="bg-white rounded-lg shadow border border-gray-100">
        <h3 className="font-semibold text-lg px-6 pt-4 pb-2">Holdings</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 text-left text-sm text-gray-500">
              <th className="px-6 py-3">Symbol</th>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3 text-right">Shares</th>
              <th className="px-6 py-3 text-right">Cost Basis</th>
              <th className="px-6 py-3 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                Link a brokerage account to view your holdings.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
