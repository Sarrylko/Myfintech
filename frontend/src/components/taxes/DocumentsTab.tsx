"use client";

import { useEffect, useState } from "react";
import {
  listFinancialDocuments,
  uploadFinancialDocument,
  downloadFinancialDocument,
  deleteFinancialDocument,
  FinancialDocument,
  UserResponse,
} from "@/lib/api";

export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Document taxonomy ────────────────────────────────────────────────────────

export const DOC_TYPES = [
  { value: "tax", label: "Tax Forms" },
  { value: "investment", label: "Investment" },
  { value: "retirement", label: "Retirement" },
  { value: "insurance", label: "Insurance" },
  { value: "banking", label: "Banking" },
  { value: "income", label: "Income" },
  { value: "estate", label: "Estate / Legal" },
  { value: "other", label: "Other" },
];

const DOC_CATEGORIES: Record<string, { value: string; label: string }[]> = {
  tax: [
    { value: "w2", label: "W-2 (Wages)" },
    { value: "1099_nec", label: "1099-NEC (Non-Employee)" },
    { value: "1099_misc", label: "1099-MISC" },
    { value: "1099_r", label: "1099-R (Retirement)" },
    { value: "ssa_1099", label: "SSA-1099 (Social Security)" },
    { value: "1099_b", label: "1099-B (Brokerage Sales)" },
    { value: "1099_div", label: "1099-DIV (Dividends)" },
    { value: "1099_int", label: "1099-INT (Interest)" },
    { value: "k1", label: "K-1 (Partnership)" },
    { value: "1098", label: "1098 (Mortgage Interest)" },
    { value: "1098_t", label: "1098-T (Tuition)" },
    { value: "schedule_e", label: "Schedule E (Rental)" },
    { value: "1040", label: "1040 (Federal Return)" },
    { value: "state_return", label: "State Tax Return" },
    { value: "tax_other", label: "Other Tax Doc" },
  ],
  investment: [
    { value: "brokerage_statement", label: "Brokerage Statement" },
    { value: "cost_basis", label: "Cost Basis Report" },
    { value: "stock_options", label: "Stock Options" },
    { value: "rsu_schedule", label: "RSU Vesting Schedule" },
    { value: "options_agreement", label: "Options Agreement" },
    { value: "investment_other", label: "Other Investment Doc" },
  ],
  retirement: [
    { value: "401k_statement", label: "401(k) Statement" },
    { value: "ira_statement", label: "IRA Statement" },
    { value: "pension_statement", label: "Pension Statement" },
    { value: "ss_statement", label: "Social Security Statement" },
    { value: "rmd_notice", label: "RMD Notice" },
    { value: "retirement_other", label: "Other Retirement Doc" },
  ],
  insurance: [
    { value: "life_insurance", label: "Life Insurance Policy" },
    { value: "disability_insurance", label: "Disability Insurance" },
    { value: "health_insurance", label: "Health Insurance" },
    { value: "umbrella_policy", label: "Umbrella Policy" },
    { value: "annuity", label: "Annuity" },
    { value: "insurance_other", label: "Other Insurance Doc" },
  ],
  banking: [
    { value: "bank_statement", label: "Bank Statement" },
    { value: "credit_report", label: "Credit Report" },
    { value: "loan_agreement", label: "Loan Agreement" },
    { value: "cd_statement", label: "CD Statement" },
    { value: "banking_other", label: "Other Banking Doc" },
  ],
  income: [
    { value: "pay_stub", label: "Pay Stub" },
    { value: "employment_contract", label: "Employment Contract" },
    { value: "offer_letter", label: "Offer Letter" },
    { value: "equity_agreement", label: "Equity Agreement" },
    { value: "income_other", label: "Other Income Doc" },
  ],
  estate: [
    { value: "will", label: "Will" },
    { value: "trust", label: "Trust Document" },
    { value: "power_of_attorney", label: "Power of Attorney" },
    { value: "beneficiary_designation", label: "Beneficiary Designation" },
    { value: "estate_other", label: "Other Estate/Legal Doc" },
  ],
  other: [
    { value: "other", label: "Other" },
  ],
};

export const TYPE_COLORS: Record<string, string> = {
  tax: "bg-purple-100 text-purple-700",
  investment: "bg-blue-100 text-blue-700",
  retirement: "bg-green-100 text-green-700",
  insurance: "bg-yellow-100 text-yellow-700",
  banking: "bg-gray-100 text-gray-600",
  income: "bg-teal-100 text-teal-700",
  estate: "bg-orange-100 text-orange-700",
  other: "bg-gray-100 text-gray-500",
};

function categoryLabel(type: string, category: string): string {
  return DOC_CATEGORIES[type]?.find((c) => c.value === category)?.label ?? category.replace(/_/g, " ");
}

function typeLabel(type: string): string {
  return DOC_TYPES.find((t) => t.value === type)?.label ?? type;
}

// ─── Documents Tab ────────────────────────────────────────────────────────────

export default function DocumentsTab({
  selectedYear,
  members,
}: {
  selectedYear: number;
  members: UserResponse[];
}) {
  const [docs, setDocs] = useState<FinancialDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [filterType, setFilterType] = useState<string>("");

  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState("tax");
  const [uploadCategory, setUploadCategory] = useState("w2");
  const [uploadYear, setUploadYear] = useState<string>(String(selectedYear));
  const [uploadMember, setUploadMember] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploading, setUploading] = useState(false);

  const [downloading, setDownloading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    loadDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, filterType]);

  // Reset category when type changes
  useEffect(() => {
    const cats = DOC_CATEGORIES[uploadType];
    if (cats && cats.length > 0) setUploadCategory(cats[0].value);
  }, [uploadType]);

  async function loadDocs() {
    setLoadingDocs(true);
    setErr("");
    try {
      const data = await listFinancialDocuments(selectedYear,
        filterType || null
      );
      setDocs(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoadingDocs(false);
    }
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setErr("");
    try {
      const doc = await uploadFinancialDocument(
        selectedFile,
        {
          document_type: uploadType,
          category: uploadCategory,
          reference_year: uploadYear ? Number(uploadYear) : null,
          owner_user_id: uploadMember || null,
          description: uploadDescription.trim() || null,
        });
      setDocs((prev) => [doc, ...prev]);
      setSelectedFile(null);
      setUploadDescription("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: FinancialDocument) {
    setDownloading(doc.id);
    try {
      await downloadFinancialDocument(doc.id, doc.filename);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await deleteFinancialDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const memberName = (id: string | null) =>
    id ? (members.find((m) => m.id === id)?.full_name ?? "Unknown") : null;

  return (
    <div className="space-y-6">
      {err && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{err}</div>
      )}

      {/* Upload form */}
      <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
        <p className="text-sm font-semibold text-gray-700 mb-4">Upload Document</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          {/* Type */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Document Type</label>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {/* Category */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category / Form</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {(DOC_CATEGORIES[uploadType] ?? []).map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          {/* Year */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Year (optional)</label>
            <input
              type="number"
              value={uploadYear}
              onChange={(e) => setUploadYear(e.target.value)}
              placeholder="e.g. 2024"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          {/* Member */}
          {members.length > 1 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">For (member)</label>
              <select
                value={uploadMember}
                onChange={(e) => setUploadMember(e.target.value)}
                title="Select household member"
                className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">— All / Household —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Description */}
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
            <input
              type="text"
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              placeholder='e.g. "Employer: Acme Corp" or "Chase savings 1099"'
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="sr-only" htmlFor="fin-doc-file">Choose file to upload</label>
          <input
            id="fin-doc-file"
            type="file"
            title="Choose file to upload"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-white file:text-primary-600 file:hover:bg-gray-50 file:cursor-pointer"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 shrink-0"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>

      {/* Filter + list */}
      <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <p className="text-sm font-semibold text-gray-700">
            Documents{filterType ? ` — ${typeLabel(filterType)}` : ""} · {selectedYear}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Filter:</span>
            <button
              type="button"
              onClick={() => setFilterType("")}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${!filterType ? "bg-gray-800 text-white border-gray-800" : "border-gray-300 text-gray-600 hover:border-gray-500"}`}
            >
              All
            </button>
            {DOC_TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => setFilterType(t.value)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${filterType === t.value ? "bg-gray-800 text-white border-gray-800" : "border-gray-300 text-gray-600 hover:border-gray-500"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loadingDocs ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4">
            No documents uploaded for {selectedYear} yet. Upload W-2s, 1099s, 1098s, investment statements, and more.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {docs.map((doc) => {
              const member = memberName(doc.owner_user_id);
              return (
                <div key={doc.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[doc.document_type] ?? TYPE_COLORS.other}`}>
                        {typeLabel(doc.document_type)}
                      </span>
                      <span className="text-xs text-gray-500 font-medium">
                        {categoryLabel(doc.document_type, doc.category)}
                      </span>
                      {doc.reference_year && (
                        <span className="text-xs text-gray-400">{doc.reference_year}</span>
                      )}
                      {member && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {member}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{doc.filename}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-400">{fmtFileSize(doc.file_size)}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(doc.uploaded_at).toLocaleDateString()}
                      </span>
                      {doc.description && (
                        <span className="text-xs text-gray-500 italic truncate">{doc.description}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      disabled={downloading === doc.id}
                      className="text-xs text-primary-600 hover:text-primary-800 font-medium px-2 py-1 rounded hover:bg-primary-50 transition disabled:opacity-50"
                    >
                      {downloading === doc.id ? "…" : "Download"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition disabled:opacity-50"
                    >
                      {deletingId === doc.id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
