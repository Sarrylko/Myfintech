export default function BudgetsPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Budgets</h2>
        <button className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition">
          + Create Budget
        </button>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-100 p-12 text-center text-gray-400">
        <p className="text-lg mb-2">No budgets set up</p>
        <p className="text-sm">
          Create monthly budgets by category to track your spending goals.
        </p>
      </div>
    </div>
  );
}
