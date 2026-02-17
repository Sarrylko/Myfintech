export default function Dashboard() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      {/* Net Worth Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <SummaryCard title="Net Worth" value="—" />
        <SummaryCard title="Cash" value="—" />
        <SummaryCard title="Investments" value="—" />
        <SummaryCard title="Real Estate" value="—" />
      </div>

      {/* Placeholder sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
          <h3 className="font-semibold text-lg mb-4">Net Worth Over Time</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            Chart will render here after account linking
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
          <h3 className="font-semibold text-lg mb-4">Monthly Spending</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            Connect accounts to see spending data
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
          <h3 className="font-semibold text-lg mb-4">Recent Transactions</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            No transactions yet
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border border-gray-100">
          <h3 className="font-semibold text-lg mb-4">Budget Status</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            Set up budgets to track progress
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
      <p className="text-sm text-gray-500 mb-1">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
