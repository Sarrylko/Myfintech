"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

interface TaxPropertyData {
  address: string;
  purchase_date: string;
  purchase_price: number;
  gross_rents: number;
  mgmt_fees: number;
  insurance: number;
  property_tax: number;
  hoa: number;
  repairs: number;
  other_fixed: number;
  total_opex: number;
  noi: number;
  capex: number;
  loan_balance: number;
}

interface TaxData {
  properties: TaxPropertyData[];
  portfolio_total: TaxPropertyData;
}

function fmt(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

export default function TaxCenterPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [currentYear] = useState(2026); // Fixed year to avoid hydration issues
  const [selectedYear, setSelectedYear] = useState(2025); // Default to 2025
  const [taxData, setTaxData] = useState<TaxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Generate year options (last 10 years)
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

  useEffect(() => {
    setMounted(true);
    const authToken = getToken();
    setToken(authToken);
    if (!authToken) {
      router.push("/login");
    }
  }, [router]);

  useEffect(() => {
    if (!token || !mounted) return;
    loadTaxData();
  }, [token, selectedYear, mounted]);

  async function loadTaxData() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/reports/tax-export?year=${selectedYear}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Failed to load tax data: ${response.statusText}`);
      }

      // Parse CSV response
      const csvText = await response.text();
      const parsed = parseCSV(csvText);
      setTaxData(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tax data");
    } finally {
      setLoading(false);
    }
  }

  function parseCSV(csv: string): TaxData {
    const lines = csv.trim().split("\n");
    const dataLines = lines.slice(1); // Skip header

    const properties: TaxPropertyData[] = [];
    let portfolio_total: TaxPropertyData | null = null;

    for (const line of dataLines) {
      if (line.startsWith("PORTFOLIO TOTAL")) {
        const values = parseCSVLine(line);
        portfolio_total = {
          address: "PORTFOLIO TOTAL",
          purchase_date: "",
          purchase_price: 0,
          gross_rents: parseFloat(values[3]) || 0,
          mgmt_fees: parseFloat(values[4]) || 0,
          insurance: parseFloat(values[5]) || 0,
          property_tax: parseFloat(values[6]) || 0,
          hoa: parseFloat(values[7]) || 0,
          repairs: parseFloat(values[8]) || 0,
          other_fixed: parseFloat(values[9]) || 0,
          total_opex: parseFloat(values[10]) || 0,
          noi: parseFloat(values[11]) || 0,
          capex: parseFloat(values[12]) || 0,
          loan_balance: parseFloat(values[13]) || 0,
        };
        break; // Stop at portfolio total
      } else if (line.trim() && !line.startsWith("IMPORTANT NOTES")) {
        const values = parseCSVLine(line);
        properties.push({
          address: values[0],
          purchase_date: values[1] || "",
          purchase_price: parseFloat(values[2]) || 0,
          gross_rents: parseFloat(values[3]) || 0,
          mgmt_fees: parseFloat(values[4]) || 0,
          insurance: parseFloat(values[5]) || 0,
          property_tax: parseFloat(values[6]) || 0,
          hoa: parseFloat(values[7]) || 0,
          repairs: parseFloat(values[8]) || 0,
          other_fixed: parseFloat(values[9]) || 0,
          total_opex: parseFloat(values[10]) || 0,
          noi: parseFloat(values[11]) || 0,
          capex: parseFloat(values[12]) || 0,
          loan_balance: parseFloat(values[13]) || 0,
        });
      }
    }

    return {
      properties,
      portfolio_total: portfolio_total || {
        address: "PORTFOLIO TOTAL",
        purchase_date: "",
        purchase_price: 0,
        gross_rents: 0, mgmt_fees: 0, insurance: 0, property_tax: 0,
        hoa: 0, repairs: 0, other_fixed: 0, total_opex: 0, noi: 0, capex: 0, loan_balance: 0,
      },
    };
  }

  function parseCSVLine(line: string): string[] {
    // Simple CSV parser (handles quoted fields)
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  async function downloadCSV() {
    try {
      const response = await fetch(`/api/v1/reports/tax-export?year=${selectedYear}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rental_tax_report_${selectedYear}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download CSV. Please try again.");
    }
  }

  if (!mounted || !token) return null;

  const total = taxData?.portfolio_total;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tax Center</h1>
          <p className="text-sm text-gray-500 mt-1">Schedule E (Supplemental Income and Loss) preparation for your CPA</p>
        </div>
      </div>

      {/* Year selector and download */}
      <div className="bg-white rounded-xl shadow border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Tax Year:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <button
            onClick={downloadCSV}
            disabled={loading}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition"
          >
            <span>📊</span>
            Download CSV for CPA
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
          <p className="text-sm text-gray-500">Loading tax data for {selectedYear}...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {!loading && total && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Properties</p>
            <p className="text-2xl font-bold">{taxData?.properties.length || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Gross Rents</p>
            <p className="text-2xl font-bold text-green-600">{fmt(total.gross_rents)}</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Expenses</p>
            <p className="text-2xl font-bold text-red-600">{fmt(total.total_opex)}</p>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Operating Income</p>
            <p className="text-2xl font-bold text-blue-600">{fmt(total.noi)}</p>
          </div>
        </div>
      )}

      {/* Property Table */}
      {!loading && taxData && (
        <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Property</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Purchase Date</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Purchase Price</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Gross Rents</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Mgmt Fees</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Insurance</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Property Tax</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">HOA</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Repairs</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Other</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Total OpEx</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">NOI</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">CapEx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {taxData.properties.map((prop, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{prop.address}</td>
                    <td className="px-4 py-3 text-gray-600">{prop.purchase_date || "—"}</td>
                    <td className="px-4 py-3 text-right">{prop.purchase_price ? fmt(prop.purchase_price) : "—"}</td>
                    <td className="px-4 py-3 text-right">{fmt(prop.gross_rents)}</td>
                    <td className="px-4 py-3 text-right">{fmt(prop.mgmt_fees)}</td>
                    <td className="px-4 py-3 text-right">{fmt(prop.insurance)}</td>
                    <td className="px-4 py-3 text-right">{fmt(prop.property_tax)}</td>
                    <td className="px-4 py-3 text-right">{fmt(prop.hoa)}</td>
                    <td className="px-4 py-3 text-right">{fmt(prop.repairs)}</td>
                    <td className="px-4 py-3 text-right">{fmt(prop.other_fixed)}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(prop.total_opex)}</td>
                    <td className="px-4 py-3 text-right font-medium text-blue-600">{fmt(prop.noi)}</td>
                    <td className="px-4 py-3 text-right text-purple-600">{fmt(prop.capex)}</td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="bg-blue-50 font-bold">
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right">{fmt(total.gross_rents)}</td>
                  <td className="px-4 py-3 text-right">{fmt(total.mgmt_fees)}</td>
                  <td className="px-4 py-3 text-right">{fmt(total.insurance)}</td>
                  <td className="px-4 py-3 text-right">{fmt(total.property_tax)}</td>
                  <td className="px-4 py-3 text-right">{fmt(total.hoa)}</td>
                  <td className="px-4 py-3 text-right">{fmt(total.repairs)}</td>
                  <td className="px-4 py-3 text-right">{fmt(total.other_fixed)}</td>
                  <td className="px-4 py-3 text-right">{fmt(total.total_opex)}</td>
                  <td className="px-4 py-3 text-right text-blue-700">{fmt(total.noi)}</td>
                  <td className="px-4 py-3 text-right text-purple-700">{fmt(total.capex)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Important Notes */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h3 className="text-sm font-bold text-amber-900 mb-3">⚠️ Important Notes for Your CPA</h3>
        <ul className="space-y-2 text-sm text-amber-800">
          <li className="flex gap-2">
            <span className="shrink-0">•</span>
            <span><strong>Gross Rents:</strong> Actual payments received (cash basis accounting)</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0">•</span>
            <span><strong>Repairs & Maintenance:</strong> Operating expenses deductible in current year</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0">•</span>
            <span><strong>Capital Expenditures (CapEx):</strong> Must be depreciated over time - NOT deductible in current year</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0">•</span>
            <span><strong>Mortgage Interest:</strong> NOT included in this report - provide Form 1098 from your lender</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0">•</span>
            <span><strong>Management Fees:</strong> Calculated as % of gross rents charged (before property manager takes their cut)</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0">•</span>
            <span><strong>This report does NOT include:</strong> Depreciation calculations, mortgage interest breakdown, or prior year carryover losses</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
