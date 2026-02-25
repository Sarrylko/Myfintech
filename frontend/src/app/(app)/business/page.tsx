"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  listBusinessEntities,
  createBusinessEntity,
  updateBusinessEntity,
  deleteBusinessEntity,
  getBusinessEntityDetail,
  addEntityOwnership,
  removeEntityOwnership,
  listHouseholdMembers,
  listBusinessDocuments,
  uploadBusinessDocument,
  downloadBusinessDocument,
  deleteBusinessDocument,
  BusinessEntityResponse,
  BusinessEntityDetail,
  EntityOwnershipResponse,
  EntityType,
  BusinessDocument,
  BUSINESS_DOC_CATEGORIES,
} from "@/lib/api";

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  trust: "Trust",
  partnership: "Partnership",
  sole_prop: "Sole Proprietorship",
};

const ENTITY_TYPE_COLORS: Record<EntityType, string> = {
  llc: "bg-blue-100 text-blue-700",
  s_corp: "bg-purple-100 text-purple-700",
  c_corp: "bg-indigo-100 text-indigo-700",
  trust: "bg-amber-100 text-amber-700",
  partnership: "bg-green-100 text-green-700",
  sole_prop: "bg-gray-100 text-gray-600",
};

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

interface FormState {
  name: string;
  entity_type: EntityType;
  parent_id: string;
  state_of_formation: string;
  ein: string;
  description: string;
  is_active: boolean;
}

const DEFAULT_FORM: FormState = {
  name: "",
  entity_type: "llc",
  parent_id: "",
  state_of_formation: "",
  ein: "",
  description: "",
  is_active: true,
};

export default function BusinessPage() {
  const [entities, setEntities] = useState<BusinessEntityResponse[]>([]);
  const [selected, setSelected] = useState<BusinessEntityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ownership form
  const [showOwnershipForm, setShowOwnershipForm] = useState(false);
  const [ownerType, setOwnerType] = useState<"person" | "entity">("person");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [ownerEntityId, setOwnerEntityId] = useState("");
  const [ownershipPct, setOwnershipPct] = useState("");
  const [members, setMembers] = useState<{ id: string; full_name: string }[]>([]);

  // Documents
  const [documents, setDocuments] = useState<BusinessDocument[]>([]);
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await listBusinessEntities();
      setEntities(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load entities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    listHouseholdMembers().then(setMembers).catch(() => {});
  }, []);

  async function selectEntity(id: string) {
    setDetailLoading(true);
    setSelected(null);
    setDocuments([]);
    setShowUploadForm(false);
    try {
      const [detail, docs] = await Promise.all([
        getBusinessEntityDetail(id),
        listBusinessDocuments(id),
      ]);
      setSelected(detail);
      setDocuments(docs);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleUploadDoc() {
    if (!selected || !uploadFile) return;
    setUploading(true);
    try {
      const doc = await uploadBusinessDocument(selected.id, uploadFile, uploadCategory || null, uploadDescription || null);
      setDocuments((prev) => [doc, ...prev]);
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadCategory("");
      setUploadDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc(docId: string) {
    if (!selected) return;
    if (!confirm("Delete this document?")) return;
    try {
      await deleteBusinessDocument(selected.id, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleDownloadDoc(docId: string, filename: string) {
    if (!selected) return;
    try {
      await downloadBusinessDocument(selected.id, docId, filename);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  function openCreate(parentId?: string) {
    setEditingId(null);
    setForm({ ...DEFAULT_FORM, parent_id: parentId ?? "" });
    setShowForm(true);
    setError(null);
  }

  function openEdit(entity: BusinessEntityResponse) {
    setEditingId(entity.id);
    setForm({
      name: entity.name,
      entity_type: entity.entity_type as EntityType,
      parent_id: entity.parent_id ?? "",
      state_of_formation: entity.state_of_formation ?? "",
      ein: entity.ein ?? "",
      description: entity.description ?? "",
      is_active: entity.is_active,
    });
    setShowForm(true);
    setError(null);
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        entity_type: form.entity_type,
        parent_id: form.parent_id || null,
        state_of_formation: form.state_of_formation || null,
        ein: form.ein || null,
        description: form.description || null,
        is_active: form.is_active,
      };
      if (editingId) {
        await updateBusinessEntity(editingId, payload);
      } else {
        await createBusinessEntity(payload);
      }
      setShowForm(false);
      await load();
      if (selected && (editingId === selected.id)) {
        await selectEntity(selected.id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this entity? This cannot be undone.")) return;
    try {
      await deleteBusinessEntity(id);
      if (selected?.id === id) setSelected(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleAddOwnership() {
    if (!selected) return;
    if (!ownershipPct || isNaN(parseFloat(ownershipPct))) {
      setError("Enter a valid ownership percentage"); return;
    }
    try {
      await addEntityOwnership(selected.id, {
        owner_user_id: ownerType === "person" ? (ownerUserId || null) : null,
        owner_entity_id: ownerType === "entity" ? (ownerEntityId || null) : null,
        ownership_pct: parseFloat(ownershipPct),
      });
      setShowOwnershipForm(false);
      setOwnerUserId(""); setOwnerEntityId(""); setOwnershipPct("");
      await selectEntity(selected.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add ownership");
    }
  }

  async function handleRemoveOwnership(ownershipId: string) {
    if (!selected) return;
    try {
      await removeEntityOwnership(selected.id, ownershipId);
      await selectEntity(selected.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove ownership");
    }
  }

  const topLevel = entities.filter(e => !e.parent_id);
  const children = (parentId: string) => entities.filter(e => e.parent_id === parentId);

  function EntityRow({ entity, depth = 0 }: { entity: BusinessEntityResponse; depth?: number }) {
    const isSelected = selected?.id === entity.id;
    const kids = children(entity.id);
    return (
      <>
        <div
          onClick={() => selectEntity(entity.id)}
          style={{ paddingLeft: `${16 + depth * 20}px` }}
          className={`flex items-center gap-2 py-2.5 pr-3 cursor-pointer rounded-lg transition-colors ${
            isSelected
              ? "bg-primary-50 dark:bg-primary-900/30 border-l-2 border-primary-500"
              : "hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          {depth > 0 && <span className="text-gray-300 text-xs">└</span>}
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
            ENTITY_TYPE_COLORS[entity.entity_type as EntityType] ?? "bg-gray-100 text-gray-600"
          }`}>
            {ENTITY_TYPE_LABELS[entity.entity_type as EntityType] ?? entity.entity_type}
          </span>
          <span className={`flex-1 text-sm font-medium truncate ${
            entity.is_active ? "text-gray-900 dark:text-gray-100" : "text-gray-400 line-through"
          }`}>
            {entity.name}
          </span>
          {entity.state_of_formation && (
            <span className="text-xs text-gray-400">{entity.state_of_formation}</span>
          )}
        </div>
        {kids.map(child => (
          <EntityRow key={child.id} entity={child} depth={depth + 1} />
        ))}
      </>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Business Entities</h1>
          <p className="text-sm text-gray-500 mt-0.5">LLCs, Trusts, Corporations & Partnerships</p>
        </div>
        <button
          onClick={() => openCreate()}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
        >
          <span className="text-lg leading-none">+</span> New Entity
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex gap-6">
        {/* ── Left: Entity List ── */}
        <div className="w-80 shrink-0">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-2">
            {loading ? (
              <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
            ) : entities.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-2xl mb-2">🏢</p>
                <p className="text-sm text-gray-500">No entities yet</p>
                <button onClick={() => openCreate()} className="mt-3 text-sm text-primary-600 hover:text-primary-700">
                  + Create first entity
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">
                {topLevel.map(entity => (
                  <EntityRow key={entity.id} entity={entity} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Detail Panel ── */}
        <div className="flex-1">
          {detailLoading ? (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-400">
              Loading…
            </div>
          ) : selected ? (
            <div className="space-y-4">
              {/* Header card */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${
                        ENTITY_TYPE_COLORS[selected.entity_type as EntityType] ?? "bg-gray-100 text-gray-600"
                      }`}>
                        {ENTITY_TYPE_LABELS[selected.entity_type as EntityType] ?? selected.entity_type}
                      </span>
                      {!selected.is_active && (
                        <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded">Inactive</span>
                      )}
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">{selected.name}</h2>
                    <div className="flex gap-4 mt-1 text-sm text-gray-500">
                      {selected.state_of_formation && <span>State: <strong>{selected.state_of_formation}</strong></span>}
                      {selected.ein && <span>EIN: <strong>{selected.ein}</strong></span>}
                    </div>
                    {selected.description && (
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{selected.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openCreate(selected.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                    >
                      + Child Entity
                    </button>
                    <button
                      onClick={() => openEdit(selected)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(selected.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Ownership */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200">Ownership</h3>
                  <button
                    onClick={() => { setShowOwnershipForm(v => !v); setError(null); }}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    + Add owner
                  </button>
                </div>

                {showOwnershipForm && (
                  <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name="ownerType" checked={ownerType === "person"}
                          onChange={() => setOwnerType("person")} />
                        Person
                      </label>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name="ownerType" checked={ownerType === "entity"}
                          onChange={() => setOwnerType("entity")} />
                        Entity
                      </label>
                    </div>
                    {ownerType === "person" ? (
                      <select value={ownerUserId} onChange={e => setOwnerUserId(e.target.value)}
                        className="input text-sm w-full">
                        <option value="">Select household member…</option>
                        {members.map(m => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    ) : (
                      <select value={ownerEntityId} onChange={e => setOwnerEntityId(e.target.value)}
                        className="input text-sm w-full">
                        <option value="">Select entity…</option>
                        {entities.filter(e => e.id !== selected.id).map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min="0" max="100" step="0.01"
                        placeholder="Ownership %" value={ownershipPct}
                        onChange={e => setOwnershipPct(e.target.value)}
                        className="input text-sm w-32"
                      />
                      <span className="text-sm text-gray-500">%</span>
                      <button onClick={handleAddOwnership}
                        className="btn-primary text-xs px-3 py-1.5 ml-auto">
                        Add
                      </button>
                    </div>
                  </div>
                )}

                {selected.ownership.length === 0 ? (
                  <p className="text-sm text-gray-400">No owners recorded</p>
                ) : (
                  <div className="space-y-2">
                    {selected.ownership.map((o: EntityOwnershipResponse) => (
                      <div key={o.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {o.owner_name ?? (o.owner_user_id ? "Person" : "Entity")}
                          </span>
                          {o.owner_entity_id && (
                            <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Entity</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                            {parseFloat(o.ownership_pct).toFixed(1)}%
                          </span>
                          <button onClick={() => handleRemoveOwnership(o.id)}
                            className="text-xs text-red-400 hover:text-red-600">✕</button>
                        </div>
                      </div>
                    ))}
                    <div className="pt-1 text-xs text-gray-400 text-right">
                      Total: {selected.ownership.reduce((s, o) => s + parseFloat(o.ownership_pct), 0).toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>

              {/* Linked Properties */}
              {selected.properties.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">
                    Linked Properties ({selected.properties.length})
                  </h3>
                  <div className="space-y-2">
                    {selected.properties.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.address}</p>
                          {(p.city || p.state) && (
                            <p className="text-xs text-gray-500">{[p.city, p.state].filter(Boolean).join(", ")}</p>
                          )}
                        </div>
                        {p.current_value && (
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                            ${parseFloat(p.current_value).toLocaleString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Linked Accounts */}
              {selected.accounts.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">
                    Linked Accounts ({selected.accounts.length})
                  </h3>
                  <div className="space-y-2">
                    {selected.accounts.map(a => (
                      <div key={a.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{a.name}</p>
                          <p className="text-xs text-gray-500">{a.institution_name ?? a.type}</p>
                        </div>
                        {a.current_balance && (
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                            ${parseFloat(a.current_balance).toLocaleString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Documents */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                    Documents {documents.length > 0 && `(${documents.length})`}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowUploadForm((v) => !v)}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    + Upload
                  </button>
                </div>

                {showUploadForm && (
                  <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
                    <div>
                      <label htmlFor="biz-doc-category" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
                      <select
                        id="biz-doc-category"
                        value={uploadCategory}
                        onChange={(e) => setUploadCategory(e.target.value)}
                        className="input text-sm w-full"
                      >
                        <option value="">— Select category —</option>
                        {Object.entries(BUSINESS_DOC_CATEGORIES).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="biz-doc-description" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description (optional)</label>
                      <input
                        id="biz-doc-description"
                        type="text"
                        value={uploadDescription}
                        onChange={(e) => setUploadDescription(e.target.value)}
                        placeholder="e.g. 2024 Annual Report"
                        className="input text-sm w-full"
                      />
                    </div>
                    <div>
                      <label htmlFor="biz-doc-file" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">File</label>
                      <input
                        id="biz-doc-file"
                        type="file"
                        ref={fileInputRef}
                        onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                        className="text-sm text-gray-600 w-full"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => { setShowUploadForm(false); setUploadFile(null); setUploadCategory(""); setUploadDescription(""); }}
                        className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleUploadDoc}
                        disabled={!uploadFile || uploading}
                        className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50"
                      >
                        {uploading ? "Uploading…" : "Upload"}
                      </button>
                    </div>
                  </div>
                )}

                {documents.length === 0 ? (
                  <p className="text-sm text-gray-400">No documents uploaded yet</p>
                ) : (
                  <div className="space-y-2">
                    {documents.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{doc.filename}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {doc.category && (
                              <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                                {BUSINESS_DOC_CATEGORIES[doc.category] ?? doc.category}
                              </span>
                            )}
                            {doc.description && (
                              <span className="text-xs text-gray-400 truncate">{doc.description}</span>
                            )}
                            <span className="text-xs text-gray-400 ml-auto shrink-0">
                              {(doc.file_size / 1024).toFixed(0)} KB
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2 ml-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDownloadDoc(doc.id, doc.filename)}
                            className="text-xs text-primary-600 hover:text-primary-700"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Child Entities */}
              {selected.children.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">
                    Subsidiaries / Child Entities ({selected.children.length})
                  </h3>
                  <div className="space-y-1">
                    {selected.children.map(child => (
                      <div key={child.id}
                        onClick={() => selectEntity(child.id)}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                          ENTITY_TYPE_COLORS[child.entity_type as EntityType] ?? "bg-gray-100 text-gray-600"
                        }`}>
                          {ENTITY_TYPE_LABELS[child.entity_type as EntityType] ?? child.entity_type}
                        </span>
                        <span className="text-sm text-gray-800 dark:text-gray-200">{child.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
              <p className="text-4xl mb-3">🏢</p>
              <p className="text-gray-500 text-sm">Select an entity to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Create / Edit Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingId ? "Edit Entity" : "New Business Entity"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Entity Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Marwaha Holdings LLC" className="input mt-1 w-full" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Entity Type *</label>
                <select value={form.entity_type} onChange={e => setForm(f => ({ ...f, entity_type: e.target.value as EntityType }))}
                  className="input mt-1 w-full">
                  {(Object.entries(ENTITY_TYPE_LABELS) as [EntityType, string][]).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">State of Formation</label>
                  <select value={form.state_of_formation} onChange={e => setForm(f => ({ ...f, state_of_formation: e.target.value }))}
                    className="input mt-1 w-full">
                    <option value="">—</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">EIN</label>
                  <input value={form.ein} onChange={e => setForm(f => ({ ...f, ein: e.target.value }))}
                    placeholder="XX-XXXXXXX" className="input mt-1 w-full" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Parent Entity</label>
                <select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                  className="input mt-1 w-full">
                  <option value="">None (top-level)</option>
                  {entities.filter(e => e.id !== editingId).map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2} placeholder="Optional notes…" className="input mt-1 w-full resize-none" />
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_active" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="rounded border-gray-300" />
                <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowForm(false); setError(null); }}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 btn-primary text-sm py-2 disabled:opacity-50">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Entity"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
