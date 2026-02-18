"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  listProperties,
  listUnits,
  createUnit,
  deleteUnit,
  listTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  listLeases,
  listUnitLeases,
  createLease,
  updateLease,
  listPayments,
  createPayment,
  updatePayment,
  deletePayment,
  listCapitalEvents,
  createCapitalEvent,
  deleteCapitalEvent,
  getPropertyReport,
  getPortfolioReport,
  Property,
  Unit,
  Tenant,
  Lease,
  Payment,
  UnitCreate,
  TenantCreate,
  LeaseCreate,
  LeaseUpdate,
  PaymentCreate,
  CapitalEvent,
  CapitalEventCreate,
  PropertyReport,
  PortfolioReport,
} from "@/lib/api";

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(val));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

const TABS = ["Overview", "Units & Leases", "Tenants", "Payments", "Reports"] as const;
type Tab = typeof TABS[number];

// ─── Sub-components ────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow border border-gray-100 p-6">{children}</div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg shadow border border-gray-100 p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function CurrencyInput({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
        <input
          type="number" min="0" step="any" value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "0"}
          className="border border-gray-300 rounded-lg pl-6 pr-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
    </div>
  );
}

function TextInput({
  label, value, onChange, placeholder, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function RentalsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Overview");

  // Global data
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [allLeases, setAllLeases] = useState<Lease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const token = getToken();

  useEffect(() => {
    if (!token) { router.replace("/login"); return; }
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    if (!token) return;
    setLoading(true);
    try {
      const [props, tnts, lses] = await Promise.all([
        listProperties(token),
        listTenants(token),
        listLeases(token),
      ]);
      setProperties(props);
      setTenants(tnts);
      setAllLeases(lses);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading rentals...
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Rentals</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
              tab === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <OverviewTab
          properties={properties}
          allLeases={allLeases}
          tenants={tenants}
          token={token!}
        />
      )}
      {tab === "Units & Leases" && (
        <UnitsLeasesTab
          properties={properties}
          tenants={tenants}
          allLeases={allLeases}
          setAllLeases={setAllLeases}
          token={token!}
        />
      )}
      {tab === "Tenants" && (
        <TenantsTab
          tenants={tenants}
          setTenants={setTenants}
          allLeases={allLeases}
          token={token!}
        />
      )}
      {tab === "Payments" && (
        <PaymentsTab
          allLeases={allLeases}
          tenants={tenants}
          token={token!}
        />
      )}
      {tab === "Reports" && (
        <ReportsTab
          properties={properties}
          token={token!}
        />
      )}
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────

function OverviewTab({
  properties, allLeases, tenants, token,
}: {
  properties: Property[];
  allLeases: Lease[];
  tenants: Tenant[];
  token: string;
}) {
  const [recentPayments, setRecentPayments] = useState<(Payment & { leaseLabel: string })[]>([]);

  useEffect(() => {
    async function load() {
      const activeLeases = allLeases.filter((l) => l.status === "active");
      const paymentsByLease = await Promise.all(
        activeLeases.slice(0, 5).map(async (l) => {
          try {
            const pays = await listPayments(l.id, token);
            return pays.slice(0, 3).map((p) => ({ ...p, leaseLabel: l.id }));
          } catch { return []; }
        })
      );
      setRecentPayments(paymentsByLease.flat().sort(
        (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
      ).slice(0, 10));
    }
    if (allLeases.length > 0) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLeases]);

  const activeLeases = allLeases.filter((l) => l.status === "active");
  const totalRentRoll = activeLeases.reduce((s, l) => s + Number(l.monthly_rent), 0);

  // We'd need unit counts — approximate from leases
  const occupiedCount = activeLeases.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Properties" value={String(properties.length)} />
        <SummaryCard label="Active Leases" value={String(occupiedCount)} />
        <SummaryCard label="Monthly Rent Roll" value={fmt(totalRentRoll)} />
        <SummaryCard label="Tenants" value={String(tenants.length)} />
      </div>

      <SectionCard>
        <h3 className="font-semibold text-gray-800 mb-4">Active Leases</h3>
        {activeLeases.length === 0 ? (
          <p className="text-sm text-gray-400">No active leases. Add units and tenants to get started.</p>
        ) : (
          <div className="space-y-3">
            {activeLeases.map((l) => {
              const tenant = tenants.find((t) => t.id === l.tenant_id);
              return (
                <div key={l.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{tenant?.name ?? "Unknown tenant"}</p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(l.lease_start)} – {l.lease_end ? fmtDate(l.lease_end) : "month-to-month"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-700">{fmt(l.monthly_rent)}/mo</p>
                    {l.deposit && <p className="text-xs text-gray-400">Deposit: {fmt(l.deposit)}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Units & Leases Tab ────────────────────────────────────────────────────

function UnitsLeasesTab({
  properties, tenants, allLeases, setAllLeases, token,
}: {
  properties: Property[];
  tenants: Tenant[];
  allLeases: Lease[];
  setAllLeases: React.Dispatch<React.SetStateAction<Lease[]>>;
  token: string;
}) {
  const [selectedPropId, setSelectedPropId] = useState<string>(properties[0]?.id ?? "");
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);

  // Add unit form
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [unitForm, setUnitForm] = useState<UnitCreate>({ unit_label: "" });
  const [savingUnit, setSavingUnit] = useState(false);

  // Lease management
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [unitLeases, setUnitLeases] = useState<Record<string, Lease[]>>({});
  const [showAddLease, setShowAddLease] = useState<string | null>(null);
  const [leaseForm, setLeaseForm] = useState<Partial<LeaseCreate>>({});
  const [savingLease, setSavingLease] = useState(false);

  // Lease editing — use a loose form type to avoid TS strictness on numeric | undefined
  const [editLeaseId, setEditLeaseId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editLeaseForm, setEditLeaseForm] = useState<Record<string, any>>({});
  const [savingLeaseEdit, setSavingLeaseEdit] = useState(false);

  useEffect(() => {
    if (selectedPropId) loadUnits(selectedPropId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPropId]);

  async function loadUnits(propId: string) {
    setLoadingUnits(true);
    try {
      setUnits(await listUnits(propId, token));
    } catch { /* ignore */ }
    finally { setLoadingUnits(false); }
  }

  async function handleAddUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!unitForm.unit_label.trim()) return;
    setSavingUnit(true);
    try {
      const u = await createUnit(selectedPropId, unitForm, token);
      setUnits((prev) => [...prev, u]);
      setUnitForm({ unit_label: "" });
      setShowAddUnit(false);
    } catch { /* ignore */ }
    finally { setSavingUnit(false); }
  }

  async function handleDeleteUnit(id: string) {
    if (!confirm("Delete this unit? All associated leases will also be removed.")) return;
    try {
      await deleteUnit(id, token);
      setUnits((prev) => prev.filter((u) => u.id !== id));
    } catch { /* ignore */ }
  }

  async function toggleUnit(unitId: string) {
    if (expandedUnit === unitId) { setExpandedUnit(null); return; }
    setExpandedUnit(unitId);
    if (!unitLeases[unitId]) {
      try {
        const lses = await listUnitLeases(unitId, token);
        setUnitLeases((prev) => ({ ...prev, [unitId]: lses }));
      } catch { /* ignore */ }
    }
  }

  async function handleAddLease(unitId: string) {
    if (!leaseForm.tenant_id || !leaseForm.lease_start || !leaseForm.monthly_rent) return;
    setSavingLease(true);
    try {
      const lease = await createLease({ ...leaseForm, unit_id: unitId } as LeaseCreate, token);
      setUnitLeases((prev) => ({ ...prev, [unitId]: [lease, ...(prev[unitId] ?? [])] }));
      setAllLeases((prev) => [lease, ...prev]);
      setShowAddLease(null);
      setLeaseForm({});
    } catch { /* ignore */ }
    finally { setSavingLease(false); }
  }

  async function handleEndLease(lease: Lease) {
    const today = new Date().toISOString().split("T")[0];
    const updated = await updateLease(lease.id, { status: "ended", move_out_date: today } as LeaseUpdate, token);
    setUnitLeases((prev) => ({
      ...prev,
      [lease.unit_id]: (prev[lease.unit_id] ?? []).map((l) => l.id === updated.id ? updated : l),
    }));
    setAllLeases((prev) => prev.map((l) => l.id === updated.id ? updated : l));
  }

  function openEditLease(l: Lease) {
    setEditLeaseId(l.id);
    setEditLeaseForm({
      tenant_id:     l.tenant_id,
      monthly_rent:  l.monthly_rent,
      deposit:       l.deposit ?? "",
      lease_start:   l.lease_start,
      lease_end:     l.lease_end ?? "",
      move_in_date:  l.move_in_date ?? "",
      move_out_date: l.move_out_date ?? "",
      status:        l.status,
      notes:         l.notes ?? "",
    });
  }

  async function handleSaveLeaseEdit(leaseId: string, unitId: string) {
    setSavingLeaseEdit(true);
    try {
      const f = editLeaseForm;
      const payload: LeaseUpdate = {
        tenant_id:     f.tenant_id,
        lease_start:   f.lease_start,
        monthly_rent:  f.monthly_rent ? Number(f.monthly_rent) : undefined,
        deposit:       f.deposit ? Number(f.deposit) : null,
        lease_end:     f.lease_end || null,
        move_in_date:  f.move_in_date || null,
        move_out_date: f.move_out_date || null,
        status:        f.status,
        notes:         f.notes || null,
      };

      const updated = await updateLease(leaseId, payload, token);
      setUnitLeases((prev) => ({
        ...prev,
        [unitId]: (prev[unitId] ?? []).map((l) => l.id === updated.id ? updated : l),
      }));
      setAllLeases((prev) => prev.map((l) => l.id === updated.id ? updated : l));
      setEditLeaseId(null);
      setEditLeaseForm({});
    } catch { /* ignore */ }
    finally { setSavingLeaseEdit(false); }
  }

  if (properties.length === 0) {
    return (
      <SectionCard>
        <p className="text-sm text-gray-400">
          No properties yet. <a href="/settings" className="text-primary-600 underline">Add a property</a> first.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Property selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Property:</label>
        <select
          value={selectedPropId}
          onChange={(e) => setSelectedPropId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.address}</option>
          ))}
        </select>
      </div>

      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Units</h3>
          <button
            onClick={() => setShowAddUnit(!showAddUnit)}
            className="text-sm bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 transition"
          >
            + Add Unit
          </button>
        </div>

        {/* Add unit form */}
        {showAddUnit && (
          <form onSubmit={handleAddUnit} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">New Unit</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <TextInput label="Unit Label *" value={unitForm.unit_label} onChange={(v) => setUnitForm((f) => ({ ...f, unit_label: v }))} placeholder="Unit 1, A, Main..." />
              <TextInput label="Beds" type="number" value={String(unitForm.beds ?? "")} onChange={(v) => setUnitForm((f) => ({ ...f, beds: v ? Number(v) : undefined }))} placeholder="2" />
              <TextInput label="Baths" type="number" value={String(unitForm.baths ?? "")} onChange={(v) => setUnitForm((f) => ({ ...f, baths: v ? Number(v) : undefined }))} placeholder="1" />
              <TextInput label="Sq Ft" type="number" value={String(unitForm.sqft ?? "")} onChange={(v) => setUnitForm((f) => ({ ...f, sqft: v ? Number(v) : undefined }))} placeholder="850" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={savingUnit || !unitForm.unit_label.trim()}
                className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {savingUnit ? "Adding..." : "Add Unit"}
              </button>
              <button type="button" onClick={() => setShowAddUnit(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">
                Cancel
              </button>
            </div>
          </form>
        )}

        {loadingUnits ? (
          <p className="text-sm text-gray-400">Loading units...</p>
        ) : units.length === 0 ? (
          <p className="text-sm text-gray-400">No units yet. Add your first unit above.</p>
        ) : (
          <div className="space-y-3">
            {units.map((unit) => {
              const leases = unitLeases[unit.id] ?? [];
              const activeLease = leases.find((l) => l.status === "active");
              const tenant = activeLease ? tenants.find((t) => t.id === activeLease.tenant_id) : null;
              const isExpanded = expandedUnit === unit.id;

              return (
                <div key={unit.id} className="border border-gray-100 rounded-lg overflow-hidden">
                  {/* Unit row */}
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-800">{unit.unit_label}</span>
                      {(unit.beds || unit.baths || unit.sqft) && (
                        <span className="text-xs text-gray-400">
                          {[
                            unit.beds ? `${unit.beds}bd` : null,
                            unit.baths ? `${unit.baths}ba` : null,
                            unit.sqft ? `${unit.sqft} sqft` : null,
                          ].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {activeLease ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          {tenant?.name ?? "Occupied"} · {fmt(activeLease.monthly_rent)}/mo
                        </span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Vacant</span>
                      )}
                      <button
                        onClick={() => toggleUnit(unit.id)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                      >
                        {isExpanded ? "Hide" : "Manage Lease"}
                      </button>
                      <button
                        onClick={() => handleDeleteUnit(unit.id)}
                        className="text-gray-300 hover:text-red-400 text-sm"
                        title="Delete unit"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Lease panel */}
                  {isExpanded && (
                    <div className="px-4 py-4 border-t border-gray-100">
                      {leases.length > 0 ? (
                        <div className="space-y-3 mb-4">
                          {leases.map((l) => {
                            const t = tenants.find((x) => x.id === l.tenant_id);
                            const isEditing = editLeaseId === l.id;

                            if (isEditing) {
                              return (
                                <div key={l.id} className="border border-primary-200 rounded-lg p-4 bg-primary-50 space-y-3">
                                  <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide">Edit Lease</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Tenant *</label>
                                      <select
                                        value={editLeaseForm.tenant_id ?? ""}
                                        onChange={(e) => setEditLeaseForm((f) => ({ ...f, tenant_id: e.target.value }))}
                                        className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                                      >
                                        {tenants.map((t) => (
                                          <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <CurrencyInput
                                      label="Monthly Rent *"
                                      value={String(editLeaseForm.monthly_rent ?? "")}
                                      onChange={(v) => setEditLeaseForm((f) => ({ ...f, monthly_rent: v ? Number(v) : undefined }))}
                                      placeholder="1500"
                                    />
                                    <TextInput
                                      label="Lease Start *"
                                      type="date"
                                      value={editLeaseForm.lease_start ?? ""}
                                      onChange={(v) => setEditLeaseForm((f) => ({ ...f, lease_start: v }))}
                                    />
                                    <TextInput
                                      label="Lease End"
                                      type="date"
                                      value={editLeaseForm.lease_end ?? ""}
                                      onChange={(v) => setEditLeaseForm((f) => ({ ...f, lease_end: v || undefined }))}
                                    />
                                    <CurrencyInput
                                      label="Deposit"
                                      value={String(editLeaseForm.deposit ?? "")}
                                      onChange={(v) => setEditLeaseForm((f) => ({ ...f, deposit: v ? Number(v) : undefined }))}
                                      placeholder="1500"
                                    />
                                    <TextInput
                                      label="Move-in Date"
                                      type="date"
                                      value={editLeaseForm.move_in_date ?? ""}
                                      onChange={(v) => setEditLeaseForm((f) => ({ ...f, move_in_date: v || undefined }))}
                                    />
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                                      <select
                                        value={editLeaseForm.status ?? "active"}
                                        onChange={(e) => setEditLeaseForm((f) => ({ ...f, status: e.target.value }))}
                                        className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                                      >
                                        <option value="active">Active</option>
                                        <option value="ended">Ended</option>
                                      </select>
                                    </div>
                                    {editLeaseForm.status === "ended" && (
                                      <TextInput
                                        label="Move-out Date"
                                        type="date"
                                        value={editLeaseForm.move_out_date ?? ""}
                                        onChange={(v) => setEditLeaseForm((f) => ({ ...f, move_out_date: v || undefined }))}
                                      />
                                    )}
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                                    <textarea
                                      value={editLeaseForm.notes ?? ""}
                                      onChange={(e) => setEditLeaseForm((f) => ({ ...f, notes: e.target.value || undefined }))}
                                      rows={2}
                                      placeholder="Optional notes..."
                                      className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSaveLeaseEdit(l.id, l.unit_id)}
                                      disabled={savingLeaseEdit || !editLeaseForm.tenant_id || !editLeaseForm.lease_start || !editLeaseForm.monthly_rent}
                                      className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                                    >
                                      {savingLeaseEdit ? "Saving..." : "Save Changes"}
                                    </button>
                                    <button
                                      onClick={() => { setEditLeaseId(null); setEditLeaseForm({}); }}
                                      className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={l.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-800">{t?.name ?? "—"}</p>
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    {fmtDate(l.lease_start)} – {l.lease_end ? fmtDate(l.lease_end) : "ongoing"}
                                    {" · "}{fmt(l.monthly_rent)}/mo
                                    {l.deposit ? ` · Deposit: ${fmt(l.deposit)}` : ""}
                                  </p>
                                  {l.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{l.notes}</p>}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${l.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                    {l.status}
                                  </span>
                                  <button
                                    onClick={() => openEditLease(l)}
                                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                                  >
                                    Edit
                                  </button>
                                  {l.status === "active" && (
                                    <button
                                      onClick={() => handleEndLease(l)}
                                      className="text-xs text-red-400 hover:text-red-600 font-medium"
                                    >
                                      End
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 mb-3">No leases for this unit.</p>
                      )}

                      {/* Add lease */}
                      {!activeLease && (
                        <>
                          {showAddLease === unit.id ? (
                            <div className="p-3 bg-blue-50 rounded-lg space-y-3">
                              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">New Lease</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Tenant *</label>
                                  <select
                                    value={leaseForm.tenant_id ?? ""}
                                    onChange={(e) => setLeaseForm((f) => ({ ...f, tenant_id: e.target.value }))}
                                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                  >
                                    <option value="">Select tenant...</option>
                                    {tenants.map((t) => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <CurrencyInput label="Monthly Rent *" value={String(leaseForm.monthly_rent ?? "")} onChange={(v) => setLeaseForm((f) => ({ ...f, monthly_rent: v ? Number(v) : undefined }))} placeholder="1500" />
                                <TextInput label="Lease Start *" type="date" value={leaseForm.lease_start ?? ""} onChange={(v) => setLeaseForm((f) => ({ ...f, lease_start: v }))} />
                                <TextInput label="Lease End" type="date" value={leaseForm.lease_end ?? ""} onChange={(v) => setLeaseForm((f) => ({ ...f, lease_end: v || undefined }))} />
                                <CurrencyInput label="Deposit" value={String(leaseForm.deposit ?? "")} onChange={(v) => setLeaseForm((f) => ({ ...f, deposit: v ? Number(v) : undefined }))} placeholder="1500" />
                                <TextInput label="Move-in Date" type="date" value={leaseForm.move_in_date ?? ""} onChange={(v) => setLeaseForm((f) => ({ ...f, move_in_date: v || undefined }))} />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleAddLease(unit.id)}
                                  disabled={savingLease || !leaseForm.tenant_id || !leaseForm.lease_start || !leaseForm.monthly_rent}
                                  className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                                >
                                  {savingLease ? "Saving..." : "Save Lease"}
                                </button>
                                <button onClick={() => { setShowAddLease(null); setLeaseForm({}); }} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowAddLease(unit.id)}
                              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                            >
                              + Add Lease
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Tenants Tab ───────────────────────────────────────────────────────────

function TenantsTab({
  tenants, setTenants, allLeases, token,
}: {
  tenants: Tenant[];
  setTenants: React.Dispatch<React.SetStateAction<Tenant[]>>;
  allLeases: Lease[];
  token: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<TenantCreate>({ name: "" });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TenantCreate>({ name: "" });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const t = await createTenant(form, token);
      setTenants((prev) => [...prev, t]);
      setForm({ name: "" });
      setShowAdd(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  async function handleEdit(id: string) {
    setSaving(true);
    try {
      const updated = await updateTenant(id, editForm, token);
      setTenants((prev) => prev.map((t) => t.id === id ? updated : t));
      setEditId(null);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this tenant?")) return;
    try {
      await deleteTenant(id, token);
      setTenants((prev) => prev.filter((t) => t.id !== id));
    } catch { /* ignore */ }
  }

  function currentLease(tenantId: string): Lease | undefined {
    return allLeases.find((l) => l.tenant_id === tenantId && l.status === "active");
  }

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Tenant Directory</h3>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-sm bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 transition"
          >
            + Add Tenant
          </button>
        </div>

        {showAdd && (
          <form onSubmit={handleAdd} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">New Tenant</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextInput label="Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Jane Smith" />
              <TextInput label="Email" type="email" value={form.email ?? ""} onChange={(v) => setForm((f) => ({ ...f, email: v || undefined }))} placeholder="jane@example.com" />
              <TextInput label="Phone" type="tel" value={form.phone ?? ""} onChange={(v) => setForm((f) => ({ ...f, phone: v || undefined }))} placeholder="+1 555-0100" />
              <TextInput label="Notes" value={form.notes ?? ""} onChange={(v) => setForm((f) => ({ ...f, notes: v || undefined }))} placeholder="Optional notes" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving || !form.name.trim()}
                className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {saving ? "Adding..." : "Add Tenant"}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">Cancel</button>
            </div>
          </form>
        )}

        {tenants.length === 0 ? (
          <p className="text-sm text-gray-400">No tenants yet. Add your first tenant above.</p>
        ) : (
          <div className="space-y-2">
            {tenants.map((t) => {
              const lease = currentLease(t.id);
              return (
                <div key={t.id} className="border border-gray-100 rounded-lg px-4 py-3">
                  {editId === t.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <TextInput label="Name" value={editForm.name} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} />
                        <TextInput label="Email" type="email" value={editForm.email ?? ""} onChange={(v) => setEditForm((f) => ({ ...f, email: v || undefined }))} />
                        <TextInput label="Phone" value={editForm.phone ?? ""} onChange={(v) => setEditForm((f) => ({ ...f, phone: v || undefined }))} />
                        <TextInput label="Notes" value={editForm.notes ?? ""} onChange={(v) => setEditForm((f) => ({ ...f, notes: v || undefined }))} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(t.id)} disabled={saving}
                          className="bg-primary-600 text-white px-3 py-1 rounded text-sm hover:bg-primary-700 disabled:opacity-50">
                          {saving ? "..." : "Save"}
                        </button>
                        <button onClick={() => setEditId(null)} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{t.name}</p>
                        <p className="text-xs text-gray-400">
                          {[t.email, t.phone].filter(Boolean).join(" · ") || "No contact info"}
                        </p>
                        {lease && (
                          <p className="text-xs text-green-600 mt-0.5">Active lease · {fmt(lease.monthly_rent)}/mo</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditId(t.id); setEditForm({ name: t.name, email: t.email ?? undefined, phone: t.phone ?? undefined, notes: t.notes ?? undefined }); }}
                          className="text-xs text-primary-600 hover:text-primary-700"
                        >
                          Edit
                        </button>
                        <button onClick={() => handleDelete(t.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Reports Tab ───────────────────────────────────────────────────────────

const CAPITAL_EVENT_TYPES = [
  "acquisition", "additional_investment", "refi_proceeds", "sale", "other",
];

type KpiBenchmark = { label: string; textColor: string; bgColor: string; hint: string };

// ── Industry benchmark evaluators ─────────────────────────────────────────────
function bmOccupancy(pct: number): KpiBenchmark {
  if (pct >= 95) return { label: "Best",      textColor: "text-green-700",  bgColor: "bg-green-100",  hint: "95%+ — full occupancy" };
  if (pct >= 85) return { label: "Good",      textColor: "text-green-600",  bgColor: "bg-green-50",   hint: "Good: 85-95%" };
  if (pct >= 75) return { label: "Average",   textColor: "text-yellow-700", bgColor: "bg-yellow-50",  hint: "Avg: 75-85%" };
  if (pct >= 60) return { label: "Low",       textColor: "text-orange-600", bgColor: "bg-orange-50",  hint: "Below avg: 60-75%" };
  return               { label: "Critical",  textColor: "text-red-600",    bgColor: "bg-red-50",     hint: "Under 60% — high risk" };
}
function bmCapRate(pct: number): KpiBenchmark {
  if (pct >= 9) return  { label: "High Yield", textColor: "text-green-700",  bgColor: "bg-green-100",  hint: "Aggressive: 9%+" };
  if (pct >= 6) return  { label: "Good",       textColor: "text-green-600",  bgColor: "bg-green-50",   hint: "Strong: 6-9%" };
  if (pct >= 4) return  { label: "Average",    textColor: "text-yellow-700", bgColor: "bg-yellow-50",  hint: "Avg: 4-6%" };
  if (pct >= 2) return  { label: "Low",        textColor: "text-orange-600", bgColor: "bg-orange-50",  hint: "Below avg: 2-4%" };
  return                { label: "Very Low",   textColor: "text-red-600",    bgColor: "bg-red-50",     hint: "Under 2%" };
}
function bmIrr(pct: number): KpiBenchmark {
  if (pct >= 20) return { label: "Excellent",  textColor: "text-green-700",  bgColor: "bg-green-100",  hint: "Top quartile: 20%+" };
  if (pct >= 15) return { label: "Good",       textColor: "text-green-600",  bgColor: "bg-green-50",   hint: "Strong: 15-20%" };
  if (pct >= 10) return { label: "Average",    textColor: "text-yellow-700", bgColor: "bg-yellow-50",  hint: "Avg: 10-15%" };
  if (pct >= 6)  return { label: "Below Avg",  textColor: "text-orange-600", bgColor: "bg-orange-50",  hint: "Below avg: 6-10%" };
  return                { label: "Poor",       textColor: "text-red-600",    bgColor: "bg-red-50",     hint: "Under 6%" };
}
function bmCoc(pct: number): KpiBenchmark {
  if (pct >= 12) return { label: "Excellent",  textColor: "text-green-700",  bgColor: "bg-green-100",  hint: "Top quartile: 12%+" };
  if (pct >= 8)  return { label: "Good",       textColor: "text-green-600",  bgColor: "bg-green-50",   hint: "Strong: 8-12%" };
  if (pct >= 4)  return { label: "Average",    textColor: "text-yellow-700", bgColor: "bg-yellow-50",  hint: "Avg: 4-8%" };
  if (pct >= 0)  return { label: "Low",        textColor: "text-orange-600", bgColor: "bg-orange-50",  hint: "Below avg: 0-4%" };
  return                { label: "Negative",   textColor: "text-red-600",    bgColor: "bg-red-50",     hint: "Losing money" };
}
function bmDelinquency(pct: number): KpiBenchmark {
  if (pct === 0)  return { label: "None",     textColor: "text-green-700",  bgColor: "bg-green-100",  hint: "0% — ideal" };
  if (pct <= 2)   return { label: "Minimal",  textColor: "text-green-600",  bgColor: "bg-green-50",   hint: "Under 2% — healthy" };
  if (pct <= 5)   return { label: "Average",  textColor: "text-yellow-700", bgColor: "bg-yellow-50",  hint: "Avg: 2-5%" };
  if (pct <= 10)  return { label: "High",     textColor: "text-orange-600", bgColor: "bg-orange-50",  hint: "Above avg: 5-10%" };
  return                 { label: "Severe",   textColor: "text-red-600",    bgColor: "bg-red-50",     hint: "Over 10% — critical" };
}
function bmTurnover(count: number): KpiBenchmark {
  if (count === 0) return { label: "Excellent", textColor: "text-green-700",  bgColor: "bg-green-100", hint: "Zero turnover this quarter" };
  if (count === 1) return { label: "Good",      textColor: "text-green-600",  bgColor: "bg-green-50",  hint: "1 — manageable" };
  if (count === 2) return { label: "Average",   textColor: "text-yellow-700", bgColor: "bg-yellow-50", hint: "2 — monitor closely" };
  if (count <= 3)  return { label: "High",      textColor: "text-orange-600", bgColor: "bg-orange-50", hint: "3 — high churn" };
  return                  { label: "Critical",  textColor: "text-red-600",    bgColor: "bg-red-50",    hint: "4+ — serious issue" };
}
function bmNoiMargin(pct: number): KpiBenchmark {
  if (pct >= 65) return { label: "Excellent",  textColor: "text-green-700",  bgColor: "bg-green-100",  hint: "65%+ NOI margin" };
  if (pct >= 50) return { label: "Good",       textColor: "text-green-600",  bgColor: "bg-green-50",   hint: "Strong: 50-65%" };
  if (pct >= 35) return { label: "Average",    textColor: "text-yellow-700", bgColor: "bg-yellow-50",  hint: "Avg: 35-50%" };
  if (pct >= 20) return { label: "Thin",       textColor: "text-orange-600", bgColor: "bg-orange-50",  hint: "Below avg: 20-35%" };
  return                { label: "Very Thin",  textColor: "text-red-600",    bgColor: "bg-red-50",     hint: "Under 20% — concern" };
}
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color = "gray", icon, higherIsBetter, trend, benchmark,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "gray" | "green" | "red" | "blue" | "purple";
  icon?: string;
  higherIsBetter?: boolean | null;        // null = no direction hint at all
  trend?: "up" | "down" | null;           // compared to previous period; null = no comparison available
  benchmark?: KpiBenchmark | null;        // industry benchmark badge
}) {
  const valueColors: Record<string, string> = {
    gray: "text-gray-900", green: "text-green-600", red: "text-red-600",
    blue: "text-blue-700", purple: "text-purple-700",
  };

  let arrowEl: React.ReactNode = null;
  let hintText: string | null = null;

  if (higherIsBetter !== null && higherIsBetter !== undefined) {
    hintText = higherIsBetter ? "↑ Higher is better" : "↓ Lower is better";
    // Only show arrow when we have actual previous-period comparison
    if (trend !== null && trend !== undefined) {
      const isUp = trend === "up";
      const isGood = higherIsBetter ? isUp : !isUp;
      const arrowColor = isGood ? "text-green-500" : "text-red-500";
      arrowEl = (
        <span className={`${arrowColor} text-sm font-bold leading-none flex-shrink-0`}>
          {isUp ? "↑" : "↓"}
        </span>
      );
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-1">
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs text-gray-400 uppercase tracking-wide leading-tight">
          {icon && <span className="mr-1">{icon}</span>}
          {label}
        </p>
        {arrowEl}
      </div>
      <p className={`text-xl font-bold ${valueColors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
      {benchmark && (
        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full self-start ${benchmark.bgColor}`}>
          <span className={`text-[10px] font-bold ${benchmark.textColor}`}>{benchmark.label}</span>
          <span className="text-[10px] text-gray-400">· {benchmark.hint}</span>
        </div>
      )}
      {hintText && (
        <p className="text-[10px] text-gray-300 font-medium mt-0.5">{hintText}</p>
      )}
    </div>
  );
}

function fmtM(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined, suffix = "%"): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}${suffix}`;
}

type PeriodPreset = "MTD" | "YTD" | "LTD" | "LastMonth" | "LastYear" | "Custom";

function ReportsTab({
  properties, token,
}: { properties: Property[]; token: string }) {
  const today = new Date();
  const [selectedPropId, setSelectedPropId] = useState<string>("all");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based
  // selectedPreset is independent of year/month so MTD vs YTD can be distinct
  // and clicking any preset always triggers a fresh fetch via useEffect
  const [selectedPreset, setSelectedPreset] = useState<PeriodPreset>("MTD");

  const [report, setReport] = useState<PropertyReport | null>(null);
  const [prevReport, setPrevReport] = useState<PropertyReport | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Capital events
  const [capitalEvents, setCapitalEvents] = useState<CapitalEvent[]>([]);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventForm, setEventForm] = useState<CapitalEventCreate>({
    event_date: today.toISOString().split("T")[0],
    event_type: "acquisition",
    amount: 0,
  });
  const [savingEvent, setSavingEvent] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const monthStr = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`;

  async function loadReport() {
    setLoading(true);
    setError("");
    setReport(null);
    setPrevReport(null);
    setPortfolio(null);
    try {
      if (selectedPropId === "all") {
        const data = await getPortfolioReport(year, monthStr, token);
        setPortfolio(data);
      } else if (selectedPreset === "LTD") {
        // Lifetime: pass period=ltd, no prev-month comparison
        const [data, events] = await Promise.all([
          getPropertyReport(selectedPropId, year, monthStr, token, "ltd"),
          listCapitalEvents(selectedPropId, token),
        ]);
        setReport(data);
        setCapitalEvents(events);
      } else {
        // Standard: fetch current period + previous month for trend arrows
        const prevDate = new Date(year, month - 2, 1);
        const prevY = prevDate.getFullYear();
        const prevM = prevDate.getMonth() + 1;
        const prevMonthStr = `${prevY.toString().padStart(4, "0")}-${prevM.toString().padStart(2, "0")}`;

        const [data, prev, events] = await Promise.all([
          getPropertyReport(selectedPropId, year, monthStr, token),
          getPropertyReport(selectedPropId, prevY, prevMonthStr, token).catch(() => null),
          listCapitalEvents(selectedPropId, token),
        ]);
        setReport(data);
        setPrevReport(prev);
        setCapitalEvents(events);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (properties.length > 0) loadReport();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPropId, year, month, selectedPreset]); // selectedPreset ensures MTD↔YTD re-fetches

  async function handleAddEvent() {
    if (!selectedPropId || selectedPropId === "all") return;
    setSavingEvent(true);
    setError("");
    try {
      const created = await createCapitalEvent(selectedPropId, {
        ...eventForm,
        amount: Number(eventForm.amount),
      }, token);
      setCapitalEvents((prev) => [...prev, created]);
      setShowAddEvent(false);
      setEventForm({ event_date: today.toISOString().split("T")[0], event_type: "acquisition", amount: 0 });
      // Refresh report for updated IRR
      loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save event");
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleDeleteEvent(id: string) {
    if (!confirm("Remove this capital event?")) return;
    setDeletingEventId(id);
    try {
      await deleteCapitalEvent(id, token);
      setCapitalEvents((prev) => prev.filter((e) => e.id !== id));
      loadReport();
    } catch { /* ignore */ }
    finally { setDeletingEventId(null); }
  }

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function renderSinglePropertyReport(r: PropertyReport, prev?: PropertyReport | null, preset?: PeriodPreset) {
    const m = r.monthly;
    const q = r.quarterly;
    const a = r.annual;
    const lt = r.lifetime;
    const qNum = r.quarter.split("Q")[1];
    const pm = prev?.monthly;
    const pq = prev?.quarterly;
    const pa = prev?.annual;

    // trend: "up" | "down" | null — only shows when previous period data exists
    function tr(curr: number, prevVal?: number | null): "up" | "down" | null {
      if (prevVal === null || prevVal === undefined) return null;
      if (curr > prevVal) return "up";
      if (curr < prevVal) return "down";
      return null;
    }

    // Derived benchmarks
    const deliqPct = m.rent_charged > 0 ? (m.delinquency / m.rent_charged) * 100 : 0;
    const noiMarginPct = m.rent_collected > 0 ? (m.noi / m.rent_collected) * 100 : 0;

    // Section header labels depend on preset
    const monthLabel = preset === "MTD"
      ? `MTD — ${MONTHS[month - 1]} ${year}`
      : `Monthly — ${MONTHS[month - 1]} ${year}`;
    const annualLabel = preset === "YTD"
      ? `YTD — Jan–${MONTHS[month - 1]} ${year}`
      : `Annual — ${year}`;

    return (
      <div className="space-y-6">
        {/* Lifetime section (LTD only) */}
        {preset === "LTD" && lt && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              LTD — Lifetime to Date
            </p>
            <p className="text-xs text-gray-300 mb-3">
              Since {new Date(lt.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })} · {lt.months} months
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon="🏠" label="Total Rent Roll"    value={fmtM(lt.rent_charged)}  higherIsBetter={true} trend={null} />
              <KpiCard icon="💰" label="Total Collected"    value={fmtM(lt.rent_collected)} color="green" higherIsBetter={true} trend={null} />
              <KpiCard icon="⚠️" label="Total Delinquency"  value={fmtM(lt.delinquency)}    color={lt.delinquency > 0 ? "red" : "gray"}
                higherIsBetter={false} trend={null}
                benchmark={lt.rent_charged > 0 ? bmDelinquency((lt.delinquency / lt.rent_charged) * 100) : null} />
              <KpiCard icon="📊" label="Occupancy (now)"    value={`${m.occupancy_pct.toFixed(0)}%`}
                sub={`${m.occupied_units}/${m.rentable_units} units`}
                color={m.occupancy_pct >= 95 ? "green" : m.occupancy_pct >= 75 ? "blue" : "red"}
                higherIsBetter={true} trend={null}
                benchmark={m.rentable_units > 0 ? bmOccupancy(m.occupancy_pct) : null} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiCard icon="🔧" label="Total OpEx"         value={fmtM(lt.opex)}          color="red"  higherIsBetter={false} trend={null} />
              <KpiCard icon="📈" label="Total NOI"          value={fmtM(lt.noi)}           color={lt.noi >= 0 ? "green" : "red"} higherIsBetter={true} trend={null}
                benchmark={lt.rent_collected > 0 ? bmNoiMargin((lt.noi / lt.rent_collected) * 100) : null} />
              <KpiCard icon="🏦" label="Total Debt Service" value={fmtM(lt.debt_service)}  higherIsBetter={null} />
              <KpiCard icon="💵" label="Total Cash Flow"    value={fmtM(lt.cash_flow)}     color={lt.cash_flow >= 0 ? "green" : "red"} higherIsBetter={true} trend={null} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiCard icon="📅" label="Avg Monthly NOI"    value={fmtM(lt.avg_monthly_noi)}
                sub="Per month average" color={lt.avg_monthly_noi >= 0 ? "green" : "red"} higherIsBetter={true} trend={null} />
              <KpiCard icon="💵" label="Avg Monthly CF"     value={fmtM(lt.avg_monthly_cash_flow)}
                sub="Per month average" color={lt.avg_monthly_cash_flow >= 0 ? "green" : "red"} higherIsBetter={true} trend={null} />
              <KpiCard icon="🎯" label="Cap Rate (current)" value={lt.cap_rate !== null ? `${lt.cap_rate.toFixed(2)}%` : "—"}
                color="blue" higherIsBetter={true} trend={null}
                benchmark={lt.cap_rate !== null ? bmCapRate(lt.cap_rate) : null} />
              <KpiCard icon="🚀" label="IRR (lifetime)"     value={lt.irr !== null ? `${lt.irr.toFixed(1)}%` : "—"}
                color={lt.irr !== null && lt.irr > 0 ? "green" : "gray"} higherIsBetter={true} trend={null}
                benchmark={lt.irr !== null ? bmIrr(lt.irr) : null} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-2 gap-3 mt-3">
              <KpiCard icon="💼" label="Total Equity Invested" value={fmtM(lt.total_equity_invested)}
                sub="Down pmt + closing costs" higherIsBetter={null} />
              <KpiCard icon="💎" label="Current Equity"        value={fmtM(lt.current_equity)}
                sub="Value − loan balances" color={lt.current_equity >= 0 ? "green" : "red"} higherIsBetter={true} trend={null} />
            </div>
          </div>
        )}

        {/* Monthly */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            {monthLabel}
            {prev && preset !== "LTD" && <span className="font-normal text-gray-300 ml-2">vs {MONTHS[(month === 1 ? 12 : month - 1) - 1]}</span>}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon="🏠" label="Rent Roll" value={fmtM(m.rent_charged)}
              higherIsBetter={true} trend={tr(m.rent_charged, pm?.rent_charged)} />
            <KpiCard icon="💰" label="Collected" value={fmtM(m.rent_collected)} color="green"
              higherIsBetter={true} trend={tr(m.rent_collected, pm?.rent_collected)} />
            <KpiCard icon="⚠️" label="Delinquency" value={fmtM(m.delinquency)}
              color={m.delinquency > 0 ? "red" : "gray"}
              higherIsBetter={false} trend={tr(m.delinquency, pm?.delinquency)}
              benchmark={m.rent_charged > 0 ? bmDelinquency(deliqPct) : null} />
            <KpiCard icon="📊" label="Occupancy" value={`${m.occupancy_pct.toFixed(0)}%`}
              sub={`${m.occupied_units}/${m.rentable_units} units`}
              color={m.occupancy_pct >= 95 ? "green" : m.occupancy_pct >= 75 ? "blue" : "red"}
              higherIsBetter={true} trend={tr(m.occupancy_pct, pm?.occupancy_pct)}
              benchmark={m.rentable_units > 0 ? bmOccupancy(m.occupancy_pct) : null} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <KpiCard icon="🔧" label="OpEx" value={fmtM(m.opex)} color="red"
              higherIsBetter={false} trend={tr(m.opex, pm?.opex)} />
            <KpiCard icon="📈" label="NOI" value={fmtM(m.noi)} color={m.noi >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={tr(m.noi, pm?.noi)}
              benchmark={m.rent_collected > 0 ? bmNoiMargin(noiMarginPct) : null} />
            <KpiCard icon="🏦" label="Debt Service" value={fmtM(m.debt_service)} sub="estimated"
              higherIsBetter={null} />
            <KpiCard icon="💵" label="Cash Flow" value={fmtM(m.cash_flow)} color={m.cash_flow >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={tr(m.cash_flow, pm?.cash_flow)} />
          </div>
          {m.capex > 0 && (
            <p className="text-xs text-purple-600 mt-2">+ {fmtM(m.capex)} CapEx spend (excluded from NOI)</p>
          )}
        </div>

        {/* Quarterly */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Quarterly — {r.quarter}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <KpiCard icon="📊" label="Cash-on-Cash YTD"
              value={q.cash_on_cash_ytd !== null ? `${q.cash_on_cash_ytd.toFixed(1)}%` : "—"}
              color="blue" sub="YTD return on equity"
              higherIsBetter={true} trend={tr(q.cash_on_cash_ytd ?? 0, pq?.cash_on_cash_ytd)}
              benchmark={q.cash_on_cash_ytd !== null ? bmCoc(q.cash_on_cash_ytd) : null} />
            <KpiCard icon="🔄" label="Turnover" value={String(q.turnover_count)}
              sub={q.avg_vacancy_days > 0 ? `${q.avg_vacancy_days.toFixed(0)} avg vacancy days` : "No vacancies"}
              higherIsBetter={false} trend={tr(q.turnover_count, pq?.turnover_count)}
              benchmark={bmTurnover(q.turnover_count)} />
            <KpiCard icon="📈" label="Q NOI" value={fmtM(q.noi)} color={q.noi >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={tr(q.noi, pq?.noi)} />
          </div>
          {q.expense_by_category.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 mb-3">Expense Breakdown — Q{qNum}</p>
              <div className="space-y-2">
                {q.expense_by_category.map((row) => {
                  const total = q.expense_by_category.reduce((s, r) => s + r.total, 0);
                  const pct = total > 0 ? (row.total / total) * 100 : 0;
                  return (
                    <div key={row.category} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-28 shrink-0 capitalize">{row.category.replace(/_/g, " ")}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full">
                        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-700 font-medium w-20 text-right">{fmtM(row.total)}</span>
                      <span className="text-xs text-gray-400 w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Annual */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            {annualLabel}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <KpiCard icon="🎯" label="Cap Rate" value={a.cap_rate !== null ? `${a.cap_rate.toFixed(2)}%` : "—"}
              sub="NOI / Current Value" color="blue"
              higherIsBetter={true} trend={tr(a.cap_rate ?? 0, pa?.cap_rate)}
              benchmark={a.cap_rate !== null ? bmCapRate(a.cap_rate) : null} />
            <KpiCard icon="🚀" label="IRR" value={a.irr !== null ? `${a.irr.toFixed(1)}%` : "—"}
              sub="Since acquisition" color={a.irr !== null && a.irr > 0 ? "green" : "gray"}
              higherIsBetter={true} trend={tr(a.irr ?? 0, pa?.irr)}
              benchmark={a.irr !== null ? bmIrr(a.irr) : null} />
            <KpiCard icon="📈" label="Annual NOI" value={fmtM(a.noi)} color={a.noi >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={tr(a.noi, pa?.noi)} />
            <KpiCard icon="📊" label="NOI YoY" value={a.noi_yoy_pct !== null ? fmtPct(a.noi_yoy_pct) : "—"}
              color={a.noi_yoy_pct !== null && a.noi_yoy_pct >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={a.noi_yoy_pct !== null ? (a.noi_yoy_pct >= 0 ? "up" : "down") : null} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon="🏛️" label="Property Tax (ann.)" value={fmtM(a.property_tax_annual)}
              higherIsBetter={null} />
            <KpiCard icon="🛡️" label="Insurance (ann.)" value={fmtM(a.insurance_annual)}
              higherIsBetter={null} />
            <KpiCard icon="💼" label="Equity Invested" value={fmtM(a.total_equity_invested)}
              sub="Down pmt + closing costs" higherIsBetter={null} />
            <KpiCard icon="💎" label="Current Equity" value={fmtM(a.current_equity)}
              sub="Value − loan balances" color={a.current_equity >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={tr(a.current_equity, pa?.current_equity)} />
          </div>
        </div>

        {/* Capital Events */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Capital Events
              <span className="text-gray-300 font-normal ml-1">— used for IRR calculation</span>
            </p>
            {!showAddEvent && (
              <button onClick={() => setShowAddEvent(true)} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                + Add Event
              </button>
            )}
          </div>

          {showAddEvent && (
            <div className="mb-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" value={eventForm.event_date}
                    onChange={(e) => setEventForm((f) => ({ ...f, event_date: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select value={eventForm.event_type ?? "other"}
                    onChange={(e) => setEventForm((f) => ({ ...f, event_type: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {CAPITAL_EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Amount <span className="text-gray-400">(negative = cash out)</span>
                  </label>
                  <input type="number" step="any" value={eventForm.amount || ""}
                    onChange={(e) => setEventForm((f) => ({ ...f, amount: Number(e.target.value) }))}
                    placeholder="-50000"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <input type="text" value={eventForm.description ?? ""}
                    onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value || undefined }))}
                    placeholder="e.g. Down payment"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddEvent} disabled={savingEvent || !eventForm.event_date || !eventForm.amount}
                  className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                  {savingEvent ? "Saving..." : "Add Event"}
                </button>
                <button onClick={() => setShowAddEvent(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3">Cancel</button>
              </div>
            </div>
          )}

          {capitalEvents.length === 0 ? (
            <div className="bg-gray-50 rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-sm text-gray-400">
                No capital events recorded. The IRR is auto-estimated from property purchase data if available.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {capitalEvents.map((e) => (
                <div key={e.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 shrink-0">
                      {new Date(e.event_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 capitalize">
                      {e.event_type.replace(/_/g, " ")}
                    </span>
                    {e.description && <span className="text-sm text-gray-600">{e.description}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-semibold ${Number(e.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {Number(e.amount) >= 0 ? "+" : ""}{fmtM(Number(e.amount))}
                    </span>
                    <button onClick={() => handleDeleteEvent(e.id)} disabled={deletingEventId === e.id}
                      className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderPortfolioReport(p: PortfolioReport) {
    const tot = p.portfolio_total;
    const m = tot.monthly;
    const a = tot.annual;
    const occ = m.rentable_units > 0 ? (m.occupied_units / m.rentable_units * 100) : 0;
    return (
      <div className="space-y-6">
        {/* Portfolio totals */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Portfolio — {MONTHS[month - 1]} {year}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon="🏠" label="Rent Roll" value={fmtM(m.rent_charged)}
              higherIsBetter={true} trend={null} />
            <KpiCard icon="💰" label="Collected" value={fmtM(m.rent_collected)} color="green"
              higherIsBetter={true} trend={null} />
            <KpiCard icon="⚠️" label="Delinquency" value={fmtM(m.delinquency)} color={m.delinquency > 0 ? "red" : "gray"}
              higherIsBetter={false} trend={null}
              benchmark={m.rent_charged > 0 ? bmDelinquency((m.delinquency / m.rent_charged) * 100) : null} />
            <KpiCard icon="📊" label="Occupancy" value={`${occ.toFixed(0)}%`} sub={`${m.occupied_units}/${m.rentable_units} units`}
              color={occ >= 95 ? "green" : occ >= 75 ? "blue" : "red"}
              higherIsBetter={true} trend={null}
              benchmark={m.rentable_units > 0 ? bmOccupancy(occ) : null} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <KpiCard icon="🔧" label="OpEx" value={fmtM(m.opex)} color="red"
              higherIsBetter={false} trend={null} />
            <KpiCard icon="📈" label="NOI" value={fmtM(m.noi)} color={m.noi >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={null} />
            <KpiCard icon="🏦" label="Debt Service" value={fmtM(m.debt_service)} sub="estimated"
              higherIsBetter={null} />
            <KpiCard icon="💵" label="Cash Flow" value={fmtM(m.cash_flow)} color={m.cash_flow >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={null} />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Annual — {year}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon="📈" label="Annual NOI" value={fmtM(a.noi)} color={a.noi >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={null} />
            <KpiCard icon="💵" label="Annual Cash Flow" value={fmtM(a.cash_flow)} color={a.cash_flow >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={null} />
            <KpiCard icon="💼" label="Total Equity Invested" value={fmtM(a.total_equity_invested)}
              higherIsBetter={null} />
            <KpiCard icon="💎" label="Total Current Equity" value={fmtM(a.current_equity)} color={a.current_equity >= 0 ? "green" : "red"}
              higherIsBetter={true} trend={null} />
          </div>
        </div>
        {/* Per-property breakdown */}
        {p.properties.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Per Property</p>
            <div className="space-y-2">
              {p.properties.map((pr) => (
                <div key={pr.property_id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="md:col-span-2">
                    <p className="text-sm font-medium text-gray-800 truncate">{pr.property_address}</p>
                    <p className="text-xs text-gray-400">{pr.monthly.occupied_units}/{pr.monthly.rentable_units} units occupied</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Collected</p>
                    <p className="text-sm font-semibold text-green-600">{fmtM(pr.monthly.rent_collected)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">NOI</p>
                    <p className={`text-sm font-semibold ${pr.monthly.noi >= 0 ? "text-green-600" : "text-red-600"}`}>{fmtM(pr.monthly.noi)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Cash Flow</p>
                    <p className={`text-sm font-semibold ${pr.monthly.cash_flow >= 0 ? "text-green-600" : "text-red-600"}`}>{fmtM(pr.monthly.cash_flow)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="bg-white rounded-xl shadow border border-gray-100 p-5 space-y-4">
        {/* Property selector */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Property</label>
          <select
            value={selectedPropId}
            onChange={(e) => { setSelectedPropId(e.target.value); setReport(null); setPortfolio(null); setCapitalEvents([]); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 min-w-60"
          >
            <option value="all">All Properties (Portfolio)</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.address}</option>
            ))}
          </select>
        </div>

        {/* Quick period presets */}
        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">Period</p>
          <div className="flex flex-wrap gap-2 items-center">
            {(() => {
              const curY = today.getFullYear();
              const curM = today.getMonth() + 1;
              const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
              const lmY = lastMonthDate.getFullYear();
              const lmM = lastMonthDate.getMonth() + 1;

              type PresetDef = { key: PeriodPreset; label: string; sublabel: string; y: number; m: number };
              const presets: PresetDef[] = [
                { key: "MTD",       label: "MTD",        sublabel: `${MONTHS[curM - 1]} ${curY}`,         y: curY,     m: curM  },
                { key: "YTD",       label: "YTD",        sublabel: `Jan–${MONTHS[curM - 1]} ${curY}`,     y: curY,     m: curM  },
                { key: "LTD",       label: "LTD",        sublabel: "Since acquisition",                   y: curY,     m: curM  },
                { key: "LastMonth", label: "Last Month", sublabel: `${MONTHS[lmM - 1]} ${lmY}`,           y: lmY,      m: lmM   },
                { key: "LastYear",  label: "Last Year",  sublabel: `Full ${curY - 1}`,                    y: curY - 1, m: 12    },
              ];

              return presets.map((p) => {
                const active = selectedPreset === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => { setSelectedPreset(p.key); setYear(p.y); setMonth(p.m); }}
                    className={`flex flex-col items-center px-4 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary-600 border-primary-600 text-white"
                        : "bg-white border-gray-200 text-gray-600 hover:border-primary-400 hover:text-primary-600"
                    }`}
                  >
                    <span className="font-semibold">{p.label}</span>
                    <span className={`font-normal ${active ? "text-primary-100" : "text-gray-400"}`}>{p.sublabel}</span>
                  </button>
                );
              });
            })()}

            {/* Custom date range */}
            <div className="flex items-center gap-2 border-l border-gray-200 pl-3 ml-1">
              <span className="text-xs text-gray-300 shrink-0">Custom:</span>
              <select
                value={year}
                onChange={(e) => { setYear(Number(e.target.value)); setSelectedPreset("Custom"); }}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {[today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2, today.getFullYear() - 3].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select
                value={month}
                onChange={(e) => { setMonth(Number(e.target.value)); setSelectedPreset("Custom"); }}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {MONTHS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-12 text-center text-gray-400">
          Loading report...
        </div>
      )}

      {!loading && properties.length === 0 && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-8 text-center text-gray-400">
          <p>No properties found. Add properties in the Real Estate page first.</p>
        </div>
      )}

      {!loading && report && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">{report.property_address}</h3>
          {renderSinglePropertyReport(report, prevReport, selectedPreset)}
        </div>
      )}

      {!loading && portfolio && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Portfolio Report</h3>
          {renderPortfolioReport(portfolio)}
        </div>
      )}
    </div>
  );
}

// ─── Payments Tab ──────────────────────────────────────────────────────────

const METHODS = ["cash", "check", "ach", "zelle", "other"];

function PaymentsTab({
  allLeases, tenants, token,
}: {
  allLeases: Lease[];
  tenants: Tenant[];
  token: string;
}) {
  const [selectedLeaseId, setSelectedLeaseId] = useState<string>(
    allLeases.find((l) => l.status === "active")?.id ?? allLeases[0]?.id ?? ""
  );
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<PaymentCreate>({
    payment_date: new Date().toISOString().split("T")[0],
    amount: 0,
  });
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PaymentCreate>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedLeaseId) loadPayments(selectedLeaseId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeaseId]);

  async function loadPayments(leaseId: string) {
    setLoadingPayments(true);
    try {
      setPayments(await listPayments(leaseId, token));
    } catch { /* ignore */ }
    finally { setLoadingPayments(false); }
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || !selectedLeaseId) return;
    setSaving(true);
    try {
      const p = await createPayment(selectedLeaseId, form, token);
      setPayments((prev) => [p, ...prev]);
      setShowAdd(false);
      setForm({ payment_date: new Date().toISOString().split("T")[0], amount: 0 });
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  function openEdit(p: Payment) {
    setEditId(p.id);
    setEditForm({
      payment_date: p.payment_date,
      amount: Number(p.amount),
      method: p.method ?? undefined,
      notes: p.notes ?? undefined,
    });
    setShowAdd(false);
  }

  async function handleSaveEdit(id: string) {
    setEditSaving(true);
    try {
      const updated = await updatePayment(id, editForm, token);
      setPayments((prev) => prev.map((p) => p.id === id ? updated : p));
      setEditId(null);
    } catch { /* ignore */ }
    finally { setEditSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this payment? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await deletePayment(id, token);
      setPayments((prev) => prev.filter((p) => p.id !== id));
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  }

  function leaseLabel(lease: Lease): string {
    const tenant = tenants.find((t) => t.id === lease.tenant_id);
    return `${tenant?.name ?? "Unknown"} (${fmtDate(lease.lease_start)}${lease.status === "ended" ? " – ended" : ""})`;
  }

  if (allLeases.length === 0) {
    return (
      <SectionCard>
        <p className="text-sm text-gray-400">No leases yet. Add units and leases first.</p>
      </SectionCard>
    );
  }

  const selectedLease = allLeases.find((l) => l.id === selectedLeaseId);
  const totalCollected = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="space-y-4">
      <SectionCard>
        {/* Lease selector */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm font-medium text-gray-700">Lease:</label>
          <select
            value={selectedLeaseId}
            onChange={(e) => { setSelectedLeaseId(e.target.value); setEditId(null); setShowAdd(false); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {allLeases.map((l) => (
              <option key={l.id} value={l.id}>{leaseLabel(l)}</option>
            ))}
          </select>
          {selectedLease && (
            <span className="text-sm text-gray-500">
              Rent: <span className="font-medium text-gray-700">{fmt(selectedLease.monthly_rent)}/mo</span>
            </span>
          )}
        </div>

        {/* Summary */}
        {payments.length > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Total Collected</p>
              <p className="text-lg font-bold text-green-700">{fmt(totalCollected)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Payments Recorded</p>
              <p className="text-lg font-bold text-gray-700">{payments.length}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Payment History</h3>
          <button
            onClick={() => { setShowAdd(!showAdd); setEditId(null); }}
            className="text-sm bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 transition"
          >
            + Record Payment
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <form onSubmit={handleAddPayment} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Record Payment</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <TextInput label="Date *" type="date" value={form.payment_date} onChange={(v) => setForm((f) => ({ ...f, payment_date: v }))} />
              <CurrencyInput label="Amount *" value={String(form.amount || "")} onChange={(v) => setForm((f) => ({ ...f, amount: v ? Number(v) : 0 }))} placeholder={selectedLease ? String(Math.round(Number(selectedLease.monthly_rent))) : "1500"} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                <select value={form.method ?? ""} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value || undefined }))}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="">Select method...</option>
                  {METHODS.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <TextInput label="Notes" value={form.notes ?? ""} onChange={(v) => setForm((f) => ({ ...f, notes: v || undefined }))} placeholder="Optional notes" />
            <div className="flex gap-2">
              <button type="submit" disabled={saving || !form.amount || !form.payment_date}
                className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save Payment"}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5">Cancel</button>
            </div>
          </form>
        )}

        {/* Payment list */}
        {loadingPayments ? (
          <p className="text-sm text-gray-400">Loading payments...</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded for this lease.</p>
        ) : (
          <div className="space-y-1">
            {payments.map((p) => (
              <div key={p.id} className="border border-gray-100 rounded-lg overflow-hidden">
                {editId === p.id ? (
                  /* ── Inline edit form ── */
                  <div className="p-4 bg-blue-50 space-y-3">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Edit Payment</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <TextInput
                        label="Date"
                        type="date"
                        value={editForm.payment_date ?? ""}
                        onChange={(v) => setEditForm((f) => ({ ...f, payment_date: v }))}
                      />
                      <CurrencyInput
                        label="Amount"
                        value={String(editForm.amount ?? "")}
                        onChange={(v) => setEditForm((f) => ({ ...f, amount: v ? Number(v) : undefined }))}
                      />
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                        <select
                          value={editForm.method ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, method: e.target.value || undefined }))}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          <option value="">No method</option>
                          {METHODS.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                        </select>
                      </div>
                    </div>
                    <TextInput
                      label="Notes"
                      value={editForm.notes ?? ""}
                      onChange={(v) => setEditForm((f) => ({ ...f, notes: v || undefined }))}
                      placeholder="Optional notes"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(p.id)}
                        disabled={editSaving}
                        className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                      >
                        {editSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Read row ── */
                  <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition group">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{fmt(p.amount)}</p>
                      <p className="text-xs text-gray-400">
                        {fmtDate(p.payment_date)}
                        {p.method ? ` · ${p.method}` : ""}
                        {p.notes ? ` · ${p.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Received</span>
                      <button
                        onClick={() => openEdit(p)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium opacity-0 group-hover:opacity-100 transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deletingId === p.id}
                        className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
                        title="Delete payment"
                      >
                        {deletingId === p.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
