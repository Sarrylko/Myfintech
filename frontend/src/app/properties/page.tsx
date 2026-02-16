export default function PropertiesPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Real Estate</h2>
        <button className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition">
          + Add Property
        </button>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-100 p-12 text-center text-gray-400">
        <p className="text-lg mb-2">No properties added</p>
        <p className="text-sm">
          Add your properties to track their valuations and include them in your
          net worth.
        </p>
      </div>
    </div>
  );
}
