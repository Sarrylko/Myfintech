"use client";

import CountryGate from "@/components/CountryGate";
import { useCallback, useEffect, useState } from "react";
import {
  getTaxOpportunities,
  getTaxProjection,
  listHouseholdMembers,
  setTaxOpportunityStatus,
  type TaxOpportunitiesResponse,
  type TaxOpportunity,
  type TaxProjectionResponse,
  type UserResponse,
} from "@/lib/api";
import OverviewTab, { type TaxTab } from "@/components/taxes/OverviewTab";
import PersonalTab from "@/components/taxes/PersonalTab";
import BusinessTab from "@/components/taxes/BusinessTab";
import RentalsTab from "@/components/taxes/RentalsTab";
import OpportunitiesTab from "@/components/taxes/OpportunitiesTab";
import WhatIfTab from "@/components/taxes/WhatIfTab";
import InputsTab from "@/components/taxes/InputsTab";
import DocumentsTab from "@/components/taxes/DocumentsTab";
import FinancialPictureTab from "@/components/taxes/FinancialPictureTab";

// Tabs that need the projection; Documents, Financial Picture and Inputs load their own data
const PROJECTION_TABS: TaxTab[] = ["overview", "personal", "business", "rentals", "opportunities", "whatif"];

export default function TaxCenterPage() {
  const [currentYear] = useState(() => new Date().getFullYear());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [activeTab, setActiveTab] = useState<TaxTab>("overview");

  const [projection, setProjection] = useState<TaxProjectionResponse | null>(null);
  const [opps, setOpps] = useState<TaxOpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scenarioPreset, setScenarioPreset] = useState<Record<string, number> | null>(null);
  const [members, setMembers] = useState<UserResponse[]>([]);

  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear + 1 - i);

  const load = useCallback(async (year: number) => {
    setLoading(true);
    setError("");
    setOpps(null);
    try {
      const [p, o] = await Promise.all([getTaxProjection(year), getTaxOpportunities(year)]);
      setProjection(p);
      setOpps(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tax projection");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(selectedYear); }, [selectedYear, load]);
  useEffect(() => { listHouseholdMembers().then(setMembers).catch(() => {}); }, []);

  async function changeStatus(id: string, status: TaxOpportunity["status"]) {
    setOpps((prev) => prev && {
      ...prev,
      opportunities: prev.opportunities.map((o) => (o.id === id ? { ...o, status } : o)),
    });
    try {
      await setTaxOpportunityStatus(selectedYear, id, status);
      setOpps(await getTaxOpportunities(selectedYear));
    } catch {
      load(selectedYear);
    }
  }

  function tryScenario(s: Record<string, number>) {
    setScenarioPreset({ ...s });
    setActiveTab("whatif");
  }

  async function downloadCSV() {
    try {
      const response = await fetch(`/api/v1/reports/tax-export?year=${selectedYear}`, { credentials: "include" });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rental_tax_report_${selectedYear}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download CSV. Please try again.");
    }
  }

  const openCount = opps?.opportunities.filter((o) => o.status === "open").length ?? 0;
  const gapCount = projection?.context.gaps.length ?? 0;
  const tabs: { id: TaxTab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "personal", label: "Personal" },
    { id: "business", label: "Business" },
    { id: "rentals", label: "Rentals" },
    { id: "opportunities", label: "Opportunities", badge: openCount },
    { id: "whatif", label: "What-if" },
    { id: "inputs", label: "Inputs", badge: gapCount },
    { id: "documents", label: "Documents" },
    { id: "picture", label: "Financial Picture" },
  ];
  const needsProjection = PROJECTION_TABS.includes(activeTab);

  return (
    <CountryGate allowedCountries={["US"]} featureName="Tax Center">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-end mb-5 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Tax Center</h1>
            <p className="text-sm text-gray-500 mt-1">
              Projected tax, year-end moves and filing prep — personal, business and rentals
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="tax-year" className="text-sm font-medium text-gray-700">Tax year</label>
            <select
              id="tax-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-5 overflow-x-auto">
          <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-1 min-w-max">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap ${
                  activeTab === t.id ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                {t.label}
                {!!t.badge && (
                  <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    t.id === "inputs" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {needsProjection && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-sm text-red-800">{error}</div>
        )}
        {needsProjection && loading && !projection && (
          <div className="bg-white rounded-xl shadow border border-gray-100 p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3" />
            <p className="text-sm text-gray-500">Projecting {selectedYear} taxes…</p>
          </div>
        )}

        {projection && (
          <div className={loading ? "opacity-60 pointer-events-none transition-opacity" : ""}>
            {activeTab === "overview" && <OverviewTab data={projection} opps={opps} onNavigate={setActiveTab} />}
            {activeTab === "personal" && <PersonalTab data={projection} />}
            {activeTab === "business" && (
              <BusinessTab data={projection} opportunities={opps?.opportunities ?? []} onNavigate={setActiveTab} />
            )}
            {activeTab === "rentals" && (
              <RentalsTab data={projection} year={selectedYear} onDownload={downloadCSV} onNavigate={setActiveTab} />
            )}
            {activeTab === "opportunities" && <OpportunitiesTab opps={opps} onStatus={changeStatus} onTry={tryScenario} />}
            {activeTab === "whatif" && <WhatIfTab year={selectedYear} preset={scenarioPreset} />}
          </div>
        )}

        {activeTab === "inputs" && (
          <InputsTab
            year={selectedYear}
            gaps={projection?.context.gaps ?? []}
            onSaved={() => load(selectedYear)}
            onNavigate={setActiveTab}
          />
        )}
        {activeTab === "documents" && <DocumentsTab selectedYear={selectedYear} members={members} />}
        {activeTab === "picture" && <FinancialPictureTab selectedYear={selectedYear} />}
      </div>
    </CountryGate>
  );
}
