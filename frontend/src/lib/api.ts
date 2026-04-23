// Empty string = relative URLs, routed through Caddy proxy (/api/* -> FastAPI)
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    // Omit Content-Type for FormData — browser sets it with the correct multipart boundary
    ...(rest.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...((customHeaders as Record<string, string>) || {}),
  };

  const fetchInit: RequestInit = { headers, credentials: "include", ...rest };
  const res = await fetch(`${API_BASE}${path}`, fetchInit);

  if (res.status === 401) {
    const refreshRes = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (refreshRes.ok) {
      const retryRes = await fetch(`${API_BASE}${path}`, fetchInit);
      if (retryRes.ok) {
        if (retryRes.status === 204) return undefined as T;
        return retryRes.json();
      }
    }
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.replace("/login");
    }
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail;
    const message = Array.isArray(detail)
      ? detail.map((e: { msg?: string }) => e.msg ?? "Validation error").join("; ")
      : detail || `API error: ${res.status}`;
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface UserResponse {
  id: string;
  email: string;
  full_name: string;
  role: string;
  household_id: string;
  is_active: boolean;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  created_at: string;
}

export interface UserProfileUpdate {
  full_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
}

export async function login(email: string, password: string): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  return apiFetch<void>("/api/v1/auth/logout", { method: "POST" });
}

export async function register(
  email: string,
  password: string,
  full_name: string,
  household_name?: string
): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, full_name, household_name }),
  });
}

// ─── User Profile ───────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/users/me", {});
}

export async function updateProfile(
  data: UserProfileUpdate
): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function changePassword(
  current_password: string,
  new_password: string
): Promise<void> {
  return apiFetch<void>("/api/v1/users/me/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
  });
}

// ─── Household Settings (locale / currency / country) ────────────────────────

export interface CountryProfile {
  country_code: string;
  country_name: string;
  currency_code: string;
  locale: string;
  is_primary: boolean;
}

export interface HouseholdSettings {
  default_currency: string;
  default_locale: string;
  country_code: string;
  active_country_code: string;
  country_profiles: CountryProfile[];
}

export async function getHouseholdSettings(): Promise<HouseholdSettings> {
  return apiFetch<HouseholdSettings>("/api/v1/users/household/settings");
}

export async function updateHouseholdSettings(
  data: Partial<Pick<HouseholdSettings, "default_currency" | "default_locale" | "country_code">>
): Promise<HouseholdSettings> {
  return apiFetch<HouseholdSettings>("/api/v1/users/household/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function switchActiveCountry(country_code: string): Promise<HouseholdSettings> {
  return apiFetch<HouseholdSettings>("/api/v1/users/household/active-country", {
    method: "PATCH",
    body: JSON.stringify({ country_code }),
  });
}

// ─── Notification Preferences ────────────────────────────────────────────────

export interface NotificationPreferences {
  daily_summary: boolean;
  budget_alerts: boolean;
  bill_reminders: boolean;
  monthly_report: boolean;
  transaction_alerts: boolean;
}

export async function getNotifPrefs(): Promise<NotificationPreferences> {
  return apiFetch<NotificationPreferences>(
    "/api/v1/users/me/notification-preferences"
  );
}

export async function updateNotifPrefs(
  data: NotificationPreferences
): Promise<NotificationPreferences> {
  return apiFetch<NotificationPreferences>(
    "/api/v1/users/me/notification-preferences",
    { method: "PATCH", body: JSON.stringify(data) }
  );
}

// ─── Household Members ───────────────────────────────────────────────────────

export interface HouseholdMemberCreate {
  full_name: string;
  email: string;
  password: string;
  role?: string;
}

export async function listHouseholdMembers(): Promise<UserResponse[]> {
  return apiFetch<UserResponse[]>("/api/v1/users/household/members", {});
}

export async function addHouseholdMember(
  data: HouseholdMemberCreate
): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/users/household/members", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface HouseholdMemberUpdate {
  full_name?: string;
  email?: string;
  phone?: string;
  role?: string;
}

export async function updateHouseholdMember(
  memberId: string,
  data: HouseholdMemberUpdate
): Promise<UserResponse> {
  return apiFetch<UserResponse>(`/api/v1/users/household/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function removeHouseholdMember(memberId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/users/household/members/${memberId}`, {
    method: "DELETE",
  });
}

// ─── Plaid / Accounts ──────────────────────────────────────────────────────

export interface PlaidItem {
  id: string;
  item_id: string;
  institution_name: string | null;
  last_synced_at: string | null;
  account_count: number;
}

export interface Account {
  id: string;
  plaid_item_id: string | null;
  snaptrade_connection_id: string | null;
  owner_user_id: string | null;
  entity_id: string | null;
  account_scope: string;
  name: string;
  official_name: string | null;
  institution_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: string | null;
  available_balance: string | null;
  currency_code: string;
  country: string;
  is_hidden: boolean;
  is_manual: boolean;
  created_at: string;
}

export interface ManualAccountCreate {
  owner_user_id?: string | null;
  name: string;
  institution_name?: string;
  type: string;
  subtype?: string;
  mask?: string;
  current_balance?: number;
  currency_code?: string;
  country?: string;
}

export interface AccountUpdate {
  owner_user_id?: string | null;
  entity_id?: string | null;
  account_scope?: string;
  name?: string;
  institution_name?: string;
  type?: string;
  subtype?: string;
  mask?: string;
  current_balance?: number | null;
  is_hidden?: boolean;
  country?: string;
  currency_code?: string;
}

export interface TransactionSplit {
  id: string;
  transaction_id: string;
  amount: string;
  category: string;
  notes: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  account_id: string | null;
  amount: string;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  plaid_category: string | null;
  is_ignored: boolean;
  is_transfer: boolean;
  is_rental_income: boolean;
  is_property_expense: boolean;
  is_business: boolean;
  has_splits: boolean;
  splits: TransactionSplit[];
  receipt?: { id: string; status: string } | null;
  notes: string | null;
  created_at: string;
}

export async function getLinkToken(): Promise<{ link_token: string }> {
  return apiFetch("/api/v1/plaid/link-token", { method: "POST" });
}

export async function exchangePublicToken(
  public_token: string,
  institution_id: string | null,
  institution_name: string | null
): Promise<PlaidItem> {
  return apiFetch("/api/v1/plaid/exchange-token", {
    method: "POST",
    body: JSON.stringify({ public_token, institution_id, institution_name }),
  });
}

export async function listPlaidItems(): Promise<PlaidItem[]> {
  return apiFetch("/api/v1/plaid/items", {});
}

export async function syncPlaidItem(itemId: string): Promise<void> {
  return apiFetch(`/api/v1/plaid/items/${itemId}/sync`, { method: "POST" });
}

export async function deletePlaidItem(
  itemId: string,
  deleteTransactions: boolean
): Promise<void> {
  return apiFetch<void>(`/api/v1/plaid/items/${itemId}?delete_transactions=${deleteTransactions}`, {
    method: "DELETE",
  });
}

export async function listAccounts(): Promise<Account[]> {
  return apiFetch("/api/v1/accounts/", {});
}

export async function createManualAccount(
  data: ManualAccountCreate
): Promise<Account> {
  return apiFetch("/api/v1/accounts/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAccount(
  id: string,
  deleteTransactions: boolean
): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/${id}?delete_transactions=${deleteTransactions}`, {
    method: "DELETE",
  });
}

export async function updateAccount(
  id: string,
  data: AccountUpdate
): Promise<Account> {
  return apiFetch<Account>(`/api/v1/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function importCsv(
  accountId: string,
  file: File
): Promise<{ imported: number; duplicates: number; errors: { row: number; error: string }[]; total_rows: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/v1/accounts/${accountId}/import-csv`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Import error: ${res.status}`);
  }
  return res.json();
}

export async function updateTransaction(
  id: string,
  data: Partial<{
    name: string;
    merchant_name: string;
    amount: number;
    date: string;
    plaid_category: string;
    notes: string;
    pending: boolean;
    is_ignored: boolean;
  }>
): Promise<Transaction> {
  return apiFetch(`/api/v1/accounts/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function setTransactionSplits(
  txnId: string,
  splits: { amount: number; category: string; notes?: string }[]
): Promise<TransactionSplit[]> {
  return apiFetch(`/api/v1/accounts/transactions/${txnId}/splits`, {
    method: "PUT",
    body: JSON.stringify({ splits }),
  });
}

export async function clearTransactionSplits(txnId: string): Promise<void> {
  await apiFetch(`/api/v1/accounts/transactions/${txnId}/splits`, {
    method: "DELETE",
  });
}

// ─── Receipts ─────────────────────────────────────────────────────────────────

export interface ReceiptLineItem {
  id: string;
  description: string;
  amount: string;
  ai_category: string | null;
  notes: string | null;
  sort_order: number;
  is_confirmed: boolean;
}

export interface Receipt {
  id: string;
  transaction_id: string;
  filename: string;
  file_size: number;
  content_type: string;
  status: "pending" | "parsing" | "parsed" | "failed";
  parse_error: string | null;
  parsed_at: string | null;
  uploaded_at: string;
  line_items: ReceiptLineItem[];
}

export async function uploadReceipt(transactionId: string, file: File, provider: "local" | "claude" = "local"): Promise<Receipt> {
  const form = new FormData();
  form.append("file", file);
  form.append("provider", provider);
  return apiFetch(`/api/v1/transactions/${transactionId}/receipt`, {
    method: "POST",
    body: form,
  });
}

export async function getReceipt(transactionId: string): Promise<Receipt> {
  return apiFetch(`/api/v1/transactions/${transactionId}/receipt`);
}

export async function deleteReceipt(transactionId: string): Promise<void> {
  await apiFetch(`/api/v1/transactions/${transactionId}/receipt`, {
    method: "DELETE",
  });
}

export async function confirmReceiptSplits(
  transactionId: string,
  lineItems: { description: string; amount: number; ai_category?: string; notes?: string; sort_order?: number }[]
): Promise<Receipt> {
  return apiFetch(`/api/v1/transactions/${transactionId}/receipt/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lineItems),
  });
}

export async function reparseReceipt(transactionId: string, provider: "local" | "claude" = "local"): Promise<{ status: string }> {
  const form = new FormData();
  form.append("provider", provider);
  return apiFetch(`/api/v1/transactions/${transactionId}/receipt/reparse`, {
    method: "POST",
    body: form,
  });
}

export async function listAllTransactions(
  limit = 500,
  offset = 0,
  startDate?: string,
  endDate?: string
): Promise<Transaction[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return apiFetch(`/api/v1/accounts/transactions?${params}`, {});
}

export async function listAccountTransactions(
  accountId: string,
  limit = 50
): Promise<Transaction[]> {
  return apiFetch(`/api/v1/accounts/${accountId}/transactions?limit=${limit}`, {});
}

// ─── Properties ────────────────────────────────────────────────────────────

export interface Property {
  id: string;
  address: string;
  country: string;
  currency_code: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  county: string | null;
  pin: string | null;
  property_type: string | null;
  purchase_price: string | null;
  purchase_date: string | null;
  closing_costs: string | null;
  current_value: string | null;
  last_valuation_date: string | null;
  notes: string | null;
  is_primary_residence: boolean;
  is_property_managed: boolean;
  management_fee_pct: string | null;
  leasing_fee_amount: string | null;
  zillow_url: string | null;
  redfin_url: string | null;
  entity_id: string | null;
  created_at: string;
}

export interface PropertyCreate {
  address: string;
  country?: string;
  currency_code?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  county?: string;
  pin?: string;
  property_type?: string;
  purchase_price?: number;
  purchase_date?: string;
  closing_costs?: number;
  current_value?: number;
  notes?: string;
  is_primary_residence?: boolean;
  is_property_managed?: boolean;
  management_fee_pct?: number;
  leasing_fee_amount?: number;
}

export async function listProperties(): Promise<Property[]> {
  return apiFetch<Property[]>("/api/v1/properties/", {});
}

export async function createProperty(
  data: PropertyCreate
): Promise<Property> {
  return apiFetch<Property>("/api/v1/properties/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProperty(
  id: string,
  data: Partial<PropertyCreate>
): Promise<Property> {
  return apiFetch<Property>(`/api/v1/properties/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteProperty(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/properties/${id}`, {
    method: "DELETE",
  });
}

// ─── Property Documents ───────────────────────────────────────────────────────

export interface PropertyDocument {
  id: string;
  property_id: string;
  filename: string;
  file_size: number;
  content_type: string;
  category: string | null;
  description: string | null;
  uploaded_at: string;
}

export async function listPropertyDocuments(propertyId: string): Promise<PropertyDocument[]> {
  return apiFetch<PropertyDocument[]>(`/api/v1/properties/${propertyId}/documents`, {});
}

export async function uploadPropertyDocument(
  propertyId: string,
  file: File,
  category: string | null,
  description: string | null
): Promise<PropertyDocument> {
  const formData = new FormData();
  formData.append("file", file);
  if (category) formData.append("category", category);
  if (description) formData.append("description", description);
  const res = await fetch(`/api/v1/properties/${propertyId}/documents`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function downloadPropertyDocument(
  propertyId: string,
  docId: string,
  filename: string
): Promise<void> {
  const res = await fetch(`/api/v1/properties/${propertyId}/documents/${docId}/download`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deletePropertyDocument(propertyId: string, docId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/properties/${propertyId}/documents/${docId}`, {
    method: "DELETE",
  });
}

// ─── Property Cost Statuses ───────────────────────────────────────────────────

export interface PropertyCostStatus {
  id: string;
  property_id: string;
  year: number;
  category: string;  // "property_tax" | "hoa" | "insurance"
  is_paid: boolean;
  paid_date: string | null;
  updated_at: string;
}

export async function listPropertyCostStatuses(
  propertyId: string,
  year?: number
): Promise<PropertyCostStatus[]> {
  const params = year ? `?year=${year}` : "";
  return apiFetch<PropertyCostStatus[]>(
    `/api/v1/properties/${propertyId}/cost-statuses${params}`,
    {}
  );
}

export async function upsertPropertyCostStatus(
  propertyId: string,
  year: number,
  category: string,
  isPaid: boolean,
  paidDate?: string | null
): Promise<PropertyCostStatus> {
  return apiFetch<PropertyCostStatus>(
    `/api/v1/properties/${propertyId}/cost-statuses/${year}/${category}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_paid: isPaid, paid_date: paidDate ?? null }),
    }
  );
}

// ─── Rentals ─────────────────────────────────────────────────────────────────

export interface Unit {
  id: string;
  property_id: string;
  unit_label: string;
  beds: number | null;
  baths: string | null;
  sqft: number | null;
  is_rentable: boolean;
  notes: string | null;
  created_at: string;
}

export interface UnitCreate {
  unit_label: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  is_rentable?: boolean;
  notes?: string;
}

export interface Tenant {
  id: string;
  household_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  country: string;
  created_at: string;
}

export interface TenantCreate {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  country?: string;
}

export interface Lease {
  id: string;
  unit_id: string;
  tenant_id: string;
  lease_start: string;
  lease_end: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  monthly_rent: string;
  deposit: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface LeaseCreate {
  unit_id: string;
  tenant_id: string;
  lease_start: string;
  lease_end?: string;
  move_in_date?: string;
  monthly_rent: number;
  deposit?: number;
  status?: string;
  notes?: string;
}

export interface LeaseUpdate {
  tenant_id?: string;
  lease_start?: string;
  lease_end?: string | null;
  move_in_date?: string | null;
  move_out_date?: string | null;
  monthly_rent?: number;
  deposit?: number | null;
  status?: string;
  notes?: string | null;
}

export interface RentCharge {
  id: string;
  lease_id: string;
  charge_date: string;
  amount: string;
  charge_type: string;
  notes: string | null;
  created_at: string;
}

export interface RentChargeCreate {
  charge_date: string;
  amount: number;
  charge_type?: string;
  notes?: string;
}

export interface Payment {
  id: string;
  lease_id: string;
  payment_date: string;
  amount: string;
  method: string | null;
  applied_to_charge_id: string | null;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface PaymentCreate {
  payment_date: string;
  amount: number;
  method?: string;
  applied_to_charge_id?: string;
  notes?: string;
}

// Units
export async function listUnits(propertyId: string): Promise<Unit[]> {
  return apiFetch<Unit[]>(`/api/v1/properties/${propertyId}/units`, {});
}
export async function createUnit(propertyId: string, data: UnitCreate): Promise<Unit> {
  return apiFetch<Unit>(`/api/v1/properties/${propertyId}/units`, { method: "POST", body: JSON.stringify(data) });
}
export async function updateUnit(id: string, data: Partial<UnitCreate>): Promise<Unit> {
  return apiFetch<Unit>(`/api/v1/units/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteUnit(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/units/${id}`, { method: "DELETE" });
}

// Tenants
export async function listTenants(): Promise<Tenant[]> {
  return apiFetch<Tenant[]>("/api/v1/tenants/", {});
}
export async function createTenant(data: TenantCreate): Promise<Tenant> {
  return apiFetch<Tenant>("/api/v1/tenants/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateTenant(id: string, data: Partial<TenantCreate>): Promise<Tenant> {
  return apiFetch<Tenant>(`/api/v1/tenants/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteTenant(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/tenants/${id}`, { method: "DELETE" });
}

// Leases
export async function listLeases(status?: string): Promise<Lease[]> {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<Lease[]>(`/api/v1/leases/${qs}`, {});
}
export async function listUnitLeases(unitId: string): Promise<Lease[]> {
  return apiFetch<Lease[]>(`/api/v1/units/${unitId}/leases`, {});
}
export async function createLease(data: LeaseCreate): Promise<Lease> {
  return apiFetch<Lease>("/api/v1/leases/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateLease(id: string, data: LeaseUpdate): Promise<Lease> {
  return apiFetch<Lease>(`/api/v1/leases/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteLease(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/leases/${id}`, { method: "DELETE" });
}

// Charges
export async function listCharges(leaseId: string): Promise<RentCharge[]> {
  return apiFetch<RentCharge[]>(`/api/v1/leases/${leaseId}/charges`, {});
}
export async function createCharge(leaseId: string, data: RentChargeCreate): Promise<RentCharge> {
  return apiFetch<RentCharge>(`/api/v1/leases/${leaseId}/charges`, { method: "POST", body: JSON.stringify(data) });
}

// Payments
export async function listPayments(leaseId: string): Promise<Payment[]> {
  return apiFetch<Payment[]>(`/api/v1/leases/${leaseId}/payments`, {});
}
export async function createPayment(leaseId: string, data: PaymentCreate): Promise<Payment> {
  return apiFetch<Payment>(`/api/v1/leases/${leaseId}/payments`, { method: "POST", body: JSON.stringify(data) });
}
export async function updatePayment(id: string, data: Partial<PaymentCreate>): Promise<Payment> {
  return apiFetch<Payment>(`/api/v1/payments/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deletePayment(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/payments/${id}`, { method: "DELETE" });
}

export interface RentalLink {
  lease_id: string;
  amount: number;
}

export async function linkRentalPayment(transactionId: string, links: RentalLink[]): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/transactions/${transactionId}/link-rental`, {
    method: "POST",
    body: JSON.stringify(links),
  });
}

export async function unlinkRentalPayment(transactionId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/transactions/${transactionId}/link-rental`, {
    method: "DELETE",
  });
}

export interface PropertyExpenseLink {
  property_id: string;
  expense_category: string;
  amount: number;
  is_capex?: boolean;
  notes?: string;
}

export async function linkPropertyExpense(transactionId: string, links: PropertyExpenseLink[]): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/transactions/${transactionId}/link-property-expense`, {
    method: "POST",
    body: JSON.stringify(links),
  });
}

export async function unlinkPropertyExpense(transactionId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/transactions/${transactionId}/link-property-expense`, {
    method: "DELETE",
  });
}

export interface PaymentImportResult {
  imported: number;
  total_rows: number;
  errors: { row: number; error: string }[];
}

export async function importPayments(
  leaseId: string,
  file: File,
): Promise<PaymentImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/v1/leases/${leaseId}/payments/import-csv`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Import error: ${res.status}`);
  }
  return res.json();
}

// ─── Property Details: Loans ─────────────────────────────────────────────────

export interface Loan {
  id: string;
  property_id: string;
  account_id: string | null;
  lender_name: string | null;
  loan_type: string;
  original_amount: string | null;
  current_balance: string | null;
  interest_rate: string | null;
  monthly_payment: string | null;
  payment_due_day: number | null;
  escrow_included: boolean;
  escrow_amount: string | null;
  origination_date: string | null;
  maturity_date: string | null;
  term_months: number | null;
  notes: string | null;
  created_at: string;
}

export interface LoanCreate {
  account_id?: string | null;
  lender_name?: string;
  loan_type?: string;
  original_amount?: number;
  current_balance?: number;
  interest_rate?: number;
  monthly_payment?: number;
  payment_due_day?: number;
  escrow_included?: boolean;
  escrow_amount?: number;
  origination_date?: string;
  maturity_date?: string;
  term_months?: number;
  notes?: string;
}

export async function listAllLoans(): Promise<Loan[]> {
  return apiFetch<Loan[]>(`/api/v1/loans`, {});
}
export async function listLoans(propertyId: string): Promise<Loan[]> {
  return apiFetch<Loan[]>(`/api/v1/properties/${propertyId}/loans`, {});
}
export async function createLoan(propertyId: string, data: LoanCreate): Promise<Loan> {
  return apiFetch<Loan>(`/api/v1/properties/${propertyId}/loans`, { method: "POST", body: JSON.stringify(data) });
}
export async function updateLoan(id: string, data: Partial<LoanCreate>): Promise<Loan> {
  return apiFetch<Loan>(`/api/v1/loans/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteLoan(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/loans/${id}`, { method: "DELETE" });
}

// ─── Property Details: Recurring Costs ───────────────────────────────────────

export interface PropertyCost {
  id: string;
  property_id: string;
  category: string;
  label: string | null;
  amount: string;
  frequency: string;
  is_active: boolean;
  is_escrowed: boolean;
  effective_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface PropertyCostCreate {
  category?: string;
  label?: string;
  amount: number;
  frequency?: string;
  is_active?: boolean;
  is_escrowed?: boolean;
  effective_date?: string;
  notes?: string;
}

export async function listPropertyCosts(propertyId: string): Promise<PropertyCost[]> {
  return apiFetch<PropertyCost[]>(`/api/v1/properties/${propertyId}/costs`, {});
}
export async function createPropertyCost(propertyId: string, data: PropertyCostCreate): Promise<PropertyCost> {
  return apiFetch<PropertyCost>(`/api/v1/properties/${propertyId}/costs`, { method: "POST", body: JSON.stringify(data) });
}
export async function updatePropertyCost(id: string, data: Partial<PropertyCostCreate>): Promise<PropertyCost> {
  return apiFetch<PropertyCost>(`/api/v1/property-costs/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deletePropertyCost(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/property-costs/${id}`, { method: "DELETE" });
}

// ─── Property Details: Maintenance Expenses ───────────────────────────────────

export interface MaintenanceExpense {
  id: string;
  property_id: string;
  expense_date: string;
  amount: string;
  category: string;
  description: string;
  vendor: string | null;
  is_capex: boolean;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface MaintenanceExpenseCreate {
  expense_date: string;
  amount: number;
  category?: string;
  description: string;
  vendor?: string;
  is_capex?: boolean;
  notes?: string;
}

export async function listMaintenanceExpenses(propertyId: string): Promise<MaintenanceExpense[]> {
  return apiFetch<MaintenanceExpense[]>(`/api/v1/properties/${propertyId}/expenses`, {});
}
export async function createMaintenanceExpense(propertyId: string, data: MaintenanceExpenseCreate): Promise<MaintenanceExpense> {
  return apiFetch<MaintenanceExpense>(`/api/v1/properties/${propertyId}/expenses`, { method: "POST", body: JSON.stringify(data) });
}
export async function updateMaintenanceExpense(id: string, data: Partial<MaintenanceExpenseCreate>): Promise<MaintenanceExpense> {
  return apiFetch<MaintenanceExpense>(`/api/v1/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteMaintenanceExpense(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/expenses/${id}`, { method: "DELETE" });
}

export async function importMaintenanceExpenses(
  propertyId: string,
  file: File
): Promise<{ imported: number; errors: { row: number; error: string }[]; total_rows: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/v1/properties/${propertyId}/expenses/import-csv`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Import error: ${res.status}`);
  }
  return res.json();
}

// ─── Property Valuations (Value History) ────────────────────────────────────

export interface PropertyValuation {
  id: string;
  property_id: string;
  value: string;           // Decimal serialized as string
  source: string;          // manual | appraisal | zillow | redfin
  valuation_date: string;
  notes: string | null;
  created_at: string;
}

export interface PropertyValuationCreate {
  value: number;
  source?: string;
  valuation_date?: string;
  notes?: string;
}

export async function listPropertyValuations(propertyId: string): Promise<PropertyValuation[]> {
  return apiFetch<PropertyValuation[]>(`/api/v1/properties/${propertyId}/valuations`, {});
}
export async function createPropertyValuation(propertyId: string, data: PropertyValuationCreate): Promise<PropertyValuation> {
  return apiFetch<PropertyValuation>(`/api/v1/properties/${propertyId}/valuations`, { method: "POST", body: JSON.stringify(data) });
}
export async function deletePropertyValuation(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/valuations/${id}`, { method: "DELETE" });
}

// ─── Recurring Transactions ──────────────────────────────────────────────────

export interface RecurringCandidate {
  key: string;
  name: string;
  merchant_name: string | null;
  amount: string;          // Decimal as string
  frequency: string;       // weekly | biweekly | monthly | quarterly | annual
  last_date: string;       // ISO date
  next_expected: string;   // ISO date
  occurrences: number;
  confidence: number;      // 0–1
  transaction_ids: string[];
  amount_varies: boolean;
}

export interface RecurringPayment {
  id: string;
  recurring_id: string;
  household_id: string;
  amount: string;
  paid_date: string;
  notes: string | null;
  transaction_id: string | null;
  created_at: string;
}

export interface RecurringTransaction {
  id: string;
  household_id: string;
  name: string;
  merchant_name: string | null;
  amount: string;
  frequency: string;
  tag: string;           // home | personal | food | transport | health | subscriptions | savings | insurance | education | other
  spending_type: string; // need | want | saving
  country: string;
  next_due_date: string | null;
  start_date: string | null;
  is_active: boolean;
  amount_type: string;   // "fixed" | "variable"
  notes: string | null;
  created_at: string;
  payments: RecurringPayment[];
}

export async function detectRecurring(): Promise<RecurringCandidate[]> {
  return apiFetch<RecurringCandidate[]>("/api/v1/recurring/detect", { method: "POST" });
}

export async function confirmRecurring(
  candidates: RecurringCandidate[]
): Promise<RecurringTransaction[]> {
  return apiFetch<RecurringTransaction[]>("/api/v1/recurring/confirm", {
    method: "POST",
    body: JSON.stringify({ candidates }),
  });
}

export async function listRecurring(): Promise<RecurringTransaction[]> {
  return apiFetch<RecurringTransaction[]>("/api/v1/recurring/", {});
}

export async function createRecurring(data: {
  name: string; amount: number; frequency: string; tag: string; spending_type: string;
  merchant_name?: string; next_due_date?: string; start_date?: string; notes?: string; country?: string;
}): Promise<RecurringTransaction> {
  return apiFetch<RecurringTransaction>("/api/v1/recurring/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateRecurring(
  id: string,
  data: {
    name?: string; amount?: number; is_active?: boolean; notes?: string; frequency?: string;
    tag?: string; spending_type?: string; next_due_date?: string | null; start_date?: string | null;
  }
): Promise<RecurringTransaction> {
  return apiFetch<RecurringTransaction>(`/api/v1/recurring/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteRecurring(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/recurring/${id}`, { method: "DELETE" });
}

export async function logRecurringPayment(
  recurringId: string,
  data: { amount: number; paid_date: string; notes?: string; create_transaction?: boolean; existing_transaction_id?: string }
): Promise<RecurringPayment> {
  return apiFetch<RecurringPayment>(`/api/v1/recurring/${recurringId}/payments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteRecurringPayment(
  recurringId: string,
  paymentId: string
): Promise<void> {
  return apiFetch<void>(`/api/v1/recurring/${recurringId}/payments/${paymentId}`, {
    method: "DELETE",
  });
}

export async function getRecurringByTransaction(txnId: string): Promise<RecurringTransaction | null> {
  try {
    return await apiFetch<RecurringTransaction>(`/api/v1/recurring/by-transaction/${txnId}`, {});
  } catch {
    return null;
  }
}

export async function unlinkTransactionFromRecurring(txnId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/recurring/unlink-transaction/${txnId}`, { method: "DELETE" });
}

// ─── Investment Holdings ─────────────────────────────────────────────────────

export interface Holding {
  id: string;
  account_id: string;
  security_id: string | null;
  ticker_symbol: string | null;
  name: string | null;
  quantity: string;        // Decimal as string
  cost_basis: string | null;
  current_value: string | null;
  currency_code: string;
  asset_class: string | null;
  coingecko_id: string | null;
  previous_close: string | null;   // price per share at prior close — for daily P&L
  as_of_date: string | null;
  created_at: string;
}

export async function listHoldings(accountId: string): Promise<Holding[]> {
  return apiFetch<Holding[]>(`/api/v1/accounts/${accountId}/holdings`, {});
}

export interface HoldingCreate {
  ticker_symbol?: string | null;
  name?: string | null;
  quantity: string;
  cost_basis?: string | null;
  current_value?: string | null;
  currency_code?: string;
  asset_class?: string | null;
  coingecko_id?: string | null;
}

export type HoldingUpdate = Partial<HoldingCreate>;

export interface TickerInfo {
  symbol: string;
  name: string | null;
  last_price: number | null;
  found: boolean;
}

export async function getTickerInfo(symbol: string): Promise<TickerInfo> {
  return apiFetch<TickerInfo>(`/api/v1/investments/ticker-info?symbol=${encodeURIComponent(symbol)}`, {});
}

export interface CoinInfo {
  id: string;
  symbol: string;
  name: string;
  last_price: number | null;
  found: boolean;
}

export async function cryptoSearch(query: string): Promise<CoinInfo[]> {
  return apiFetch<CoinInfo[]>(`/api/v1/investments/crypto-search?query=${encodeURIComponent(query)}`, {});
}

export async function createHolding(accountId: string, data: HoldingCreate): Promise<Holding> {
  return apiFetch<Holding>(`/api/v1/accounts/${accountId}/holdings`, { method: "POST", body: JSON.stringify(data) });
}

export async function updateHolding(holdingId: string, data: HoldingUpdate): Promise<Holding> {
  return apiFetch<Holding>(`/api/v1/accounts/holdings/${holdingId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteHolding(holdingId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/holdings/${holdingId}`, { method: "DELETE" });
}

// ─── Investment Transactions ─────────────────────────────────────────────────

export interface InvestmentTransaction {
  id: string;
  account_id: string;
  ticker_symbol: string | null;
  name: string;
  type: string;          // buy | sell | dividend | split | transfer_in | transfer_out | other
  date: string;          // ISO timestamp
  quantity: string | null;   // Decimal as string
  price: string | null;
  amount: string;
  fees: string | null;
  notes: string | null;
  currency_code: string;
  created_at: string;
}

export interface InvestmentTransactionCreate {
  ticker_symbol: string;
  name: string;
  type: string;
  date: string;          // ISO timestamp string
  quantity?: string | null;
  price?: string | null;
  amount: string;
  fees?: string | null;
  notes?: string | null;
  currency_code?: string;
}

export type InvestmentTransactionUpdate = Partial<InvestmentTransactionCreate>;

export interface TickerRollup {
  ticker_symbol: string;
  name: string;
  net_shares: string;
  avg_cost_per_share: string | null;
  total_cost_basis: string | null;
  total_fees: string;
  realized_gain: string;
  transaction_count: number;
  last_transaction_date: string;
  transactions: InvestmentTransaction[];
}

export interface AccountTransactionSummary {
  account_id: string;
  positions: TickerRollup[];
}

export interface CSVImportResult {
  imported: number;
  errors: string[];
}

export async function listInvestmentTransactionRollup(
  accountId: string
): Promise<AccountTransactionSummary> {
  return apiFetch<AccountTransactionSummary>(
    `/api/v1/accounts/${accountId}/investment-transactions`,
    {}
  );
}

export async function createInvestmentTransaction(
  accountId: string,
  data: InvestmentTransactionCreate
): Promise<InvestmentTransaction> {
  return apiFetch<InvestmentTransaction>(
    `/api/v1/accounts/${accountId}/investment-transactions`,
    { method: "POST", body: JSON.stringify(data) }
  );
}

export async function updateInvestmentTransaction(
  id: string,
  data: InvestmentTransactionUpdate
): Promise<InvestmentTransaction> {
  return apiFetch<InvestmentTransaction>(
    `/api/v1/investment-transactions/${id}`,
    { method: "PATCH", body: JSON.stringify(data) }
  );
}

export async function deleteInvestmentTransaction(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/investment-transactions/${id}`, { method: "DELETE" });
}

export async function importInvestmentTransactionsCSV(
  accountId: string,
  file: File
): Promise<CSVImportResult> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<CSVImportResult>(
    `/api/v1/accounts/${accountId}/investment-transactions/import-csv`,
    { method: "POST", body: form }
  );
}

export function downloadInvestmentCSVTemplate(): void {
  window.open("/api/v1/investment-transactions/csv-template", "_blank");
}

// ─── Categorization Rules ───────────────────────────────────────────────────

export interface Rule {
  id: string;
  name: string;
  match_field: string;       // "name" | "merchant_name" | "account_type"
  match_type: string;        // "contains" | "exact"
  match_value: string;
  action: string;            // "categorize" | "ignore"
  category_string: string | null;
  negate_amount: boolean;
  priority: number;
  is_active: boolean;
  created_at: string;
  account_type_filter: string | null;  // e.g. "depository", "credit"
}

export interface RuleCreate {
  name: string;
  match_field: string;
  match_type: string;
  match_value: string;
  action?: string;
  category_string?: string;
  negate_amount?: boolean;
  priority?: number;
  account_type_filter?: string | null;
}

export async function listRules(): Promise<Rule[]> {
  return apiFetch<Rule[]>("/api/v1/rules/", {});
}

export async function createRule(data: RuleCreate): Promise<Rule> {
  return apiFetch<Rule>("/api/v1/rules/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateRule(
  id: string,
  data: Partial<RuleCreate & { is_active: boolean }>
): Promise<Rule> {
  return apiFetch<Rule>(`/api/v1/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteRule(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/rules/${id}`, {
    method: "DELETE",
  });
}

export async function applyRules(): Promise<{ applied: number }> {
  return apiFetch<{ applied: number }>("/api/v1/rules/apply", {
    method: "POST",
  });
}

// ─── Custom Categories ──────────────────────────────────────────────────────

export interface CustomCategory {
  id: string;
  name: string;
  parent_id: string | null;
  is_income: boolean;
  created_at: string;
}

export async function listCustomCategories(): Promise<CustomCategory[]> {
  return apiFetch<CustomCategory[]>("/api/v1/categories/", {});
}

export async function createCustomCategory(
  data: { name: string; parent_id?: string; is_income?: boolean }
): Promise<CustomCategory> {
  return apiFetch<CustomCategory>("/api/v1/categories/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateCustomCategory(
  id: string,
  data: { name: string }
): Promise<CustomCategory> {
  return apiFetch<CustomCategory>(`/api/v1/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteCustomCategory(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/categories/${id}`, {
    method: "DELETE",
  });
}

export async function seedDefaultCategories(): Promise<CustomCategory[]> {
  return apiFetch<CustomCategory[]>("/api/v1/categories/seed-defaults", {
    method: "POST",
  });
}

// ─── Capital Events ──────────────────────────────────────────────────────────

export interface CapitalEvent {
  id: string;
  property_id: string;
  event_date: string;
  event_type: string; // acquisition | additional_investment | refi_proceeds | sale | other
  amount: number; // signed: negative = cash out, positive = cash in
  description: string | null;
  notes: string | null;
  created_at: string;
}

export interface CapitalEventCreate {
  event_date: string;
  event_type?: string;
  amount: number;
  description?: string;
  notes?: string;
}

export async function listCapitalEvents(propertyId: string): Promise<CapitalEvent[]> {
  return apiFetch<CapitalEvent[]>(`/api/v1/properties/${propertyId}/capital-events`, {});
}
export async function createCapitalEvent(propertyId: string, data: CapitalEventCreate): Promise<CapitalEvent> {
  return apiFetch<CapitalEvent>(`/api/v1/properties/${propertyId}/capital-events`, { method: "POST", body: JSON.stringify(data) });
}
export async function updateCapitalEvent(id: string, data: Partial<CapitalEventCreate>): Promise<CapitalEvent> {
  return apiFetch<CapitalEvent>(`/api/v1/capital-events/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteCapitalEvent(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/capital-events/${id}`, { method: "DELETE" });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ExpenseBreakdown {
  loan_payment: number;
  property_tax: number;
  insurance: number;
  hoa: number;
  other_fixed: number;
  repairs: number;
  management_fee: number;
}

export interface MonthlyReport {
  rent_charged: number;
  rent_collected: number;
  delinquency: number;
  opex: number;
  capex: number;
  noi: number;
  debt_service: number;
  cash_flow: number;
  occupancy_pct: number;
  rentable_units: number;
  occupied_units: number;
  expense_breakdown: ExpenseBreakdown;
}

export interface QuarterlyReport {
  rent_charged: number;
  rent_collected: number;
  opex: number;
  noi: number;
  debt_service: number;
  cash_flow: number;
  cash_on_cash_ytd: number | null;
  expense_by_category: { category: string; total: number }[];
  turnover_count: number;
  avg_vacancy_days: number;
}

export interface AnnualReport {
  rent_charged: number;
  rent_collected: number;
  opex: number;
  capex: number;
  noi: number;
  debt_service: number;
  cash_flow: number;
  cap_rate: number | null;
  irr: number | null;
  noi_prior_year: number;
  noi_yoy_pct: number | null;
  property_tax_annual: number;
  insurance_annual: number;
  total_equity_invested: number;
  current_equity: number;
}

export interface YtdReport {
  months: number;              // number of months Jan–selected month
  rent_charged: number;
  rent_collected: number;
  delinquency: number;
  opex: number;
  capex: number;
  noi: number;
  debt_service: number;
  cash_flow: number;
  occupancy_pct: number;
  rentable_units: number;
  occupied_units: number;
  expense_breakdown: ExpenseBreakdown;
}

export interface LifetimeReport {
  start_date: string;          // ISO date of acquisition / first charge
  months: number;              // total months tracked
  rent_charged: number;
  rent_collected: number;
  delinquency: number;
  opex: number;
  capex: number;
  noi: number;
  debt_service: number;
  cash_flow: number;
  avg_monthly_noi: number;
  avg_monthly_cash_flow: number;
  cap_rate: number | null;
  irr: number | null;
  current_equity: number;
  total_equity_invested: number;
  expense_breakdown: ExpenseBreakdown;
}

export interface PropertyReport {
  property_id: string;
  property_address: string;
  year: number;
  month: string;
  quarter: string;
  monthly: MonthlyReport;
  ytd: YtdReport;
  quarterly: QuarterlyReport;
  annual: AnnualReport;
  lifetime?: LifetimeReport;   // only present when period=ltd
}

export interface PortfolioReport {
  year: number;
  month: string;
  properties: PropertyReport[];
  portfolio_total: {
    monthly: Omit<MonthlyReport, "occupancy_pct">;
    ytd: YtdReport;
    annual: Pick<AnnualReport, "rent_charged" | "rent_collected" | "opex" | "noi" | "debt_service" | "cash_flow" | "total_equity_invested" | "current_equity">;
  };
}

export async function getPropertyReport(
  propertyId: string,
  year: number,
  month: string, // YYYY-MM
  period?: string, // "default" | "ltd"
): Promise<PropertyReport> {
  const params = new URLSearchParams({ year: String(year), month });
  if (period) params.set("period", period);
  return apiFetch<PropertyReport>(
    `/api/v1/reports/property/${propertyId}?${params}`,
    {}
  );
}

export async function getPortfolioReport(
  year: number,
  month: string, // YYYY-MM
  country?: string,
): Promise<PortfolioReport> {
  const params = new URLSearchParams({ year: String(year), month });
  if (country) params.set("country", country);
  return apiFetch<PortfolioReport>(
    `/api/v1/reports/portfolio?${params}`,
    {}
  );
}

// ─── Investment Price Refresh ──────────────────────────────────────────────────

export interface InvestmentRefreshSettings {
  price_refresh_enabled: boolean;
  price_refresh_interval_minutes: number;
}

export interface RefreshStatus {
  last_refresh: string | null;
  next_refresh: string | null;
  enabled: boolean;
  interval_minutes: number;
}

export interface MarketStatus {
  is_open: boolean;
  next_open: string | null;
}

export interface RefreshResult {
  refreshed: number;
}

export async function getInvestmentSettings(): Promise<InvestmentRefreshSettings> {
  return apiFetch<InvestmentRefreshSettings>("/api/v1/investments/settings", {});
}

export async function updateInvestmentSettings(
  data: InvestmentRefreshSettings
): Promise<InvestmentRefreshSettings> {
  return apiFetch<InvestmentRefreshSettings>("/api/v1/investments/settings", { method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getRefreshStatus(): Promise<RefreshStatus> {
  return apiFetch<RefreshStatus>("/api/v1/investments/refresh-status", {});
}

export async function getMarketStatus(): Promise<MarketStatus> {
  return apiFetch<MarketStatus>("/api/v1/investments/market-status", {});
}

export async function refreshInvestmentPrices(): Promise<RefreshResult> {
  return apiFetch<RefreshResult>("/api/v1/investments/refresh-prices", { method: "POST",
  });
}

// ─── SnapTrade ──────────────────────────────────────────────────────────────

export interface SnapTradeConnection {
  id: string;
  brokerage_name: string | null;
  brokerage_slug: string | null;
  snaptrade_authorization_id: string;
  is_active: boolean;
  last_synced_at: string | null;
  account_count: number;
}

export interface SnapTradeRegisterResponse {
  registered: boolean;
  snaptrade_user_id: string;
}

export interface SnapTradeSyncResponse {
  accounts_synced: number;
  holdings_synced: number;
}

export async function registerSnapTradeUser(): Promise<SnapTradeRegisterResponse> {
  return apiFetch<SnapTradeRegisterResponse>("/api/v1/snaptrade/register-user", { method: "POST",
  });
}

export async function getSnapTradeConnectUrl(): Promise<{ redirect_url: string }> {
  return apiFetch<{ redirect_url: string }>("/api/v1/snaptrade/connect-url", { method: "POST",
  });
}

export async function listSnapTradeConnections(): Promise<SnapTradeConnection[]> {
  return apiFetch<SnapTradeConnection[]>("/api/v1/snaptrade/connections", {});
}

export async function syncSnapTradeAuthorizations(): Promise<SnapTradeConnection[]> {
  return apiFetch<SnapTradeConnection[]>("/api/v1/snaptrade/sync-authorizations", { method: "POST",
  });
}

export async function syncSnapTradeConnection(
  connectionId: string
): Promise<SnapTradeSyncResponse> {
  return apiFetch<SnapTradeSyncResponse>(
    `/api/v1/snaptrade/connections/${connectionId}/sync`,
    { method: "POST" }
  );
}

export async function deleteSnapTradeConnection(
  connectionId: string
): Promise<void> {
  await apiFetch<void>(`/api/v1/snaptrade/connections/${connectionId}`, { method: "DELETE",
  });
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

export type BudgetType = 'monthly' | 'annual' | 'quarterly' | 'custom';

export interface BudgetCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  is_income: boolean;
}

export interface BudgetCreate {
  category_id: string;
  amount: number;
  budget_type?: BudgetType;
  year: number;
  month?: number;       // required only for monthly
  start_date?: string;  // ISO date string, required for quarterly/custom
  end_date?: string;    // ISO date string, required for quarterly/custom
  rollover_enabled?: boolean;
  alert_threshold?: number;
  country?: string;
}

export interface BudgetUpdate {
  amount?: number;
  rollover_enabled?: boolean;
  alert_threshold?: number;
}

export interface Budget {
  id: string;
  household_id: string;
  category_id: string;
  category: BudgetCategory;
  amount: string; // Decimal serialized as string
  budget_type: BudgetType;
  country: string;
  month: number | null;
  year: number;
  start_date: string | null;
  end_date: string | null;
  rollover_enabled: boolean;
  alert_threshold: number;
  created_at: string;
}

export interface BudgetWithActual extends Budget {
  actual_spent: string; // Decimal as string
  remaining: string; // Decimal as string — negative if over budget
  percent_used: string; // Decimal as string
}

export interface BudgetBulkCreate {
  budgets: BudgetCreate[];
}

export async function listBudgets(
  month: number,
  year: number
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>(
    `/api/v1/budgets/?month=${month}&year=${year}`,
    {}
  );
}

export async function listLongTermBudgets(
  year: number
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>(
    `/api/v1/budgets/?year=${year}&budget_type=long_term`,
    {}
  );
}

export async function createBudget(
  data: BudgetCreate
): Promise<BudgetWithActual> {
  return apiFetch<BudgetWithActual>("/api/v1/budgets/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createBudgetsBulk(
  data: BudgetBulkCreate
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>("/api/v1/budgets/bulk", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateBudget(
  id: string,
  data: BudgetUpdate
): Promise<BudgetWithActual> {
  return apiFetch<BudgetWithActual>(`/api/v1/budgets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteBudget(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/budgets/${id}`, {
    method: "DELETE",
  });
}

export async function getBudgetTransactions(
  budgetId: string
): Promise<Transaction[]> {
  return apiFetch<Transaction[]>(`/api/v1/budgets/${budgetId}/transactions`, {});
}

export async function copyBudgetsFromLastMonth(
  month: number,
  year: number
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>(
    `/api/v1/budgets/copy-from-last-month?month=${month}&year=${year}`,
    { method: "POST" }
  );
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export type GoalType = "savings" | "debt_payoff" | "investment" | "custom";

export interface GoalCreate {
  name: string;
  description?: string;
  goal_type: GoalType;
  target_amount: string;
  current_amount?: string;
  currency_code?: string;
  country?: string;
  start_date: string; // YYYY-MM-DD
  target_date: string; // YYYY-MM-DD
  linked_account_id?: string;
  linked_budget_id?: string;
}

export interface GoalUpdate {
  name?: string;
  description?: string;
  goal_type?: GoalType;
  target_amount?: string;
  current_amount?: string;
  currency_code?: string;
  start_date?: string;
  target_date?: string;
  linked_account_id?: string | null;
  linked_budget_id?: string | null;
  is_completed?: boolean;
}

export interface GoalLinkedAccount {
  id: string;
  name: string;
  type: string;
  current_balance: string | null;
}

export interface GoalLinkedBudget {
  id: string;
  amount: string;
  budget_type: string;
  month: number | null;
  year: number;
}

export interface Goal {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  goal_type: GoalType;
  target_amount: string;
  current_amount: string | null;
  currency_code: string;
  country: string;
  start_date: string;
  target_date: string;
  linked_account_id: string | null;
  linked_budget_id: string | null;
  is_completed: boolean;
  linked_account: GoalLinkedAccount | null;
  linked_budget: GoalLinkedBudget | null;
  progress_amount: string;
  progress_percent: string;
  days_remaining: number;
  is_on_track: boolean;
}

export async function listGoals(): Promise<Goal[]> {
  return apiFetch<Goal[]>("/api/v1/goals/", {});
}

export async function createGoal(data: GoalCreate): Promise<Goal> {
  return apiFetch<Goal>("/api/v1/goals/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateGoal(id: string, data: GoalUpdate): Promise<Goal> {
  return apiFetch<Goal>(`/api/v1/goals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteGoal(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/goals/${id}`, { method: "DELETE" });
}

// ─── Net Worth Snapshots ──────────────────────────────────────────────────────

export interface NetWorthSnapshot {
  id: string;
  snapshot_date: string;      // ISO datetime string
  total_cash: string;         // Decimal as string
  total_investments: string;
  total_real_estate: string;
  total_debts: string;
  net_worth: string;
}

export async function listNetWorthSnapshots(
  days: number
): Promise<NetWorthSnapshot[]> {
  return apiFetch<NetWorthSnapshot[]>(
    `/api/v1/networth/snapshots?days=${days}`,
    {}
  );
}

export async function takeNetWorthSnapshot(): Promise<NetWorthSnapshot> {
  return apiFetch<NetWorthSnapshot>("/api/v1/networth/snapshots", {
    method: "POST",
  });
}


// ─── Financial Documents ────────────────────────────────────────────────────

export interface FinancialDocument {
  id: string;
  household_id: string;
  owner_user_id: string | null;
  document_type: string;
  category: string;
  reference_year: number | null;
  filename: string;
  stored_filename: string;
  file_size: number;
  content_type: string;
  description: string | null;
  uploaded_at: string;
}

export async function listFinancialDocuments(
  year?: number | null,
  document_type?: string | null
): Promise<FinancialDocument[]> {
  const params = new URLSearchParams();
  if (year) params.append("year", String(year));
  if (document_type) params.append("document_type", document_type);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<FinancialDocument[]>(`/api/v1/financial-documents${qs}`, {});
}

export async function uploadFinancialDocument(
  file: File,
  meta: {
    document_type: string;
    category: string;
    reference_year?: number | null;
    owner_user_id?: string | null;
    description?: string | null;
  }
): Promise<FinancialDocument> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("document_type", meta.document_type);
  formData.append("category", meta.category);
  if (meta.reference_year != null) formData.append("reference_year", String(meta.reference_year));
  if (meta.owner_user_id) formData.append("owner_user_id", meta.owner_user_id);
  if (meta.description) formData.append("description", meta.description);
  const res = await fetch("/api/v1/financial-documents", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function downloadFinancialDocument(
  docId: string,
  filename: string
): Promise<void> {
  const res = await fetch(`/api/v1/financial-documents/${docId}/download`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteFinancialDocument(docId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/financial-documents/${docId}`, { method: "DELETE" });
}

// ─── Business Entities ─────────────────────────────────────────────────────

export type EntityType = "llc" | "s_corp" | "c_corp" | "trust" | "partnership" | "sole_prop";

export interface BusinessEntityResponse {
  id: string;
  household_id: string;
  parent_id: string | null;
  name: string;
  entity_type: EntityType;
  state_of_formation: string | null;
  ein: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BusinessEntityTree extends BusinessEntityResponse {
  children: BusinessEntityTree[];
}

export interface EntityOwnershipResponse {
  id: string;
  entity_id: string;
  owner_user_id: string | null;
  owner_entity_id: string | null;
  ownership_pct: string;
  created_at: string;
  owner_name: string | null;
}

export interface LinkedPropertySummary {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  current_value: string | null;
}

export interface LinkedAccountSummary {
  id: string;
  name: string;
  type: string;
  institution_name: string | null;
  current_balance: string | null;
  account_scope: string;
}

export interface BusinessEntityDetail extends BusinessEntityResponse {
  ownership: EntityOwnershipResponse[];
  properties: LinkedPropertySummary[];
  accounts: LinkedAccountSummary[];
  children: BusinessEntityResponse[];
}

export interface BusinessEntityCreate {
  name: string;
  entity_type: EntityType;
  parent_id?: string | null;
  state_of_formation?: string | null;
  ein?: string | null;
  description?: string | null;
  is_active?: boolean;
}

export interface BusinessEntityUpdate {
  name?: string;
  entity_type?: EntityType;
  parent_id?: string | null;
  state_of_formation?: string | null;
  ein?: string | null;
  description?: string | null;
  is_active?: boolean;
}

export async function listBusinessEntities(): Promise<BusinessEntityResponse[]> {
  return apiFetch<BusinessEntityResponse[]>("/api/v1/business-entities/");
}

export async function getBusinessEntityTree(): Promise<BusinessEntityTree[]> {
  return apiFetch<BusinessEntityTree[]>("/api/v1/business-entities/tree");
}

export async function getBusinessEntityDetail(id: string): Promise<BusinessEntityDetail> {
  return apiFetch<BusinessEntityDetail>(`/api/v1/business-entities/${id}`);
}

export async function createBusinessEntity(
  payload: BusinessEntityCreate
): Promise<BusinessEntityResponse> {
  return apiFetch<BusinessEntityResponse>("/api/v1/business-entities/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateBusinessEntity(
  id: string,
  payload: BusinessEntityUpdate
): Promise<BusinessEntityResponse> {
  return apiFetch<BusinessEntityResponse>(`/api/v1/business-entities/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteBusinessEntity(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/business-entities/${id}`, { method: "DELETE" });
}

export async function addEntityOwnership(
  entityId: string,
  payload: { owner_user_id?: string | null; owner_entity_id?: string | null; ownership_pct: number }
): Promise<EntityOwnershipResponse> {
  return apiFetch<EntityOwnershipResponse>(
    `/api/v1/business-entities/${entityId}/ownership`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function removeEntityOwnership(
  entityId: string,
  ownershipId: string
): Promise<void> {
  return apiFetch<void>(
    `/api/v1/business-entities/${entityId}/ownership/${ownershipId}`,
    { method: "DELETE" }
  );
}

// ─── Business Documents ────────────────────────────────────────────────────

export interface BusinessDocument {
  id: string;
  entity_id: string;
  filename: string;
  file_size: number;
  content_type: string;
  category: string | null;
  description: string | null;
  uploaded_at: string;
}

export const BUSINESS_DOC_CATEGORIES: Record<string, string> = {
  ein_certificate: "EIN Certificate",
  operating_agreement: "Operating Agreement",
  articles_of_organization: "Articles of Organization",
  bylaws: "Bylaws",
  annual_report: "Annual Report",
  tax_return: "Tax Return",
  bank_statement: "Bank Statement",
  legal_agreement: "Legal Agreement",
  shareholder_agreement: "Shareholder Agreement",
  insurance: "Insurance",
  other: "Other",
};

export async function listBusinessDocuments(entityId: string): Promise<BusinessDocument[]> {
  return apiFetch<BusinessDocument[]>(`/api/v1/business-entities/${entityId}/documents`);
}

export async function uploadBusinessDocument(
  entityId: string,
  file: File,
  category: string | null,
  description: string | null
): Promise<BusinessDocument> {
  const form = new FormData();
  form.append("file", file);
  if (category) form.append("category", category);
  if (description) form.append("description", description);
  const res = await fetch(`/api/v1/business-entities/${entityId}/documents`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function downloadBusinessDocument(
  entityId: string,
  docId: string,
  filename: string
): Promise<void> {
  const res = await fetch(`/api/v1/business-entities/${entityId}/documents/${docId}/download`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteBusinessDocument(entityId: string, docId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/business-entities/${entityId}/documents/${docId}`, {
    method: "DELETE",
  });
}

// ─── AI Assistant ──────────────────────────────────────────────────────────────

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LearnedAnswer {
  id: string;
  question: string;
  answer: string;
  saved_at: string;
}

/**
 * Open a streaming SSE connection to the AI chat endpoint.
 * Returns the raw Response so the caller can read the body as a stream.
 */
export async function streamAiChat(messages: AiChatMessage[]): Promise<Response> {
  const res = await fetch(`${API_BASE}/api/v1/ai/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`AI chat error: ${res.status}`);
  return res;
}

export async function saveLearnedAnswer(question: string, answer: string): Promise<void> {
  await apiFetch<void>("/api/v1/ai/learn", {
    method: "POST",
    body: JSON.stringify({ question, answer }),
  });
}

export async function getLearnedAnswers(): Promise<{ items: LearnedAnswer[] }> {
  return apiFetch<{ items: LearnedAnswer[] }>("/api/v1/ai/learned");
}

// ─── Financial Picture ────────────────────────────────────────────────────────

export interface FinancialPictureCache {
  cached: boolean;
  report_text: string | null;
  generated_at: string | null;
  year: number;
}

/** Fetch the cached financial picture report (instant, no AI call). */
export async function getFinancialPicture(year?: number | null): Promise<FinancialPictureCache> {
  const qs = year ? `?year=${year}` : "";
  return apiFetch<FinancialPictureCache>(`/api/v1/ai/financial-picture${qs}`);
}

/** Stream a fresh financial picture report (documents + live DB). Updates cache when done. */
export async function streamFinancialPicture(year?: number | null): Promise<Response> {
  const qs = year ? `?year=${year}` : "";
  const res = await fetch(`${API_BASE}/api/v1/ai/financial-picture${qs}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Financial picture error: ${res.status}`);
  }
  return res;
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────

export interface Vehicle {
  id: string;
  household_id: string;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  nickname: string | null;
  color: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface VehicleCreate {
  make: string;
  model: string;
  year?: number;
  vin?: string;
  nickname?: string;
  color?: string;
  is_active?: boolean;
  notes?: string;
}

export async function listVehicles(): Promise<Vehicle[]> {
  return apiFetch<Vehicle[]>("/api/v1/vehicles/");
}
export async function createVehicle(data: VehicleCreate): Promise<Vehicle> {
  return apiFetch<Vehicle>("/api/v1/vehicles/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateVehicle(id: string, data: Partial<VehicleCreate>): Promise<Vehicle> {
  return apiFetch<Vehicle>(`/api/v1/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteVehicle(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/vehicles/${id}`, { method: "DELETE" });
}

// ─── Insurance ────────────────────────────────────────────────────────────────

export type PolicyType =
  | "life_term" | "life_whole" | "life_universal"
  | "home" | "renters" | "auto" | "umbrella"
  | "health" | "dental" | "vision"
  | "disability" | "long_term_care" | "business" | "other";

export type PremiumFrequency = "monthly" | "quarterly" | "semi_annual" | "annual" | "one_time";

export interface InsuranceBeneficiary {
  id: string;
  policy_id: string;
  name: string;
  relationship: string | null;
  beneficiary_type: "primary" | "contingent";
  percentage: string; // Decimal returned as string
  created_at: string;
}

export interface InsurancePolicy {
  id: string;
  household_id: string;
  policy_type: PolicyType;
  provider: string;
  policy_number: string | null;
  country: string;
  premium_amount: string | null;
  premium_frequency: PremiumFrequency;
  coverage_amount: string | null;
  deductible: string | null;
  start_date: string | null;
  renewal_date: string | null;
  auto_renew: boolean;
  is_active: boolean;
  property_id: string | null;
  vehicle_id: string | null;
  insured_user_id: string | null;
  entity_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface InsurancePolicyDetail extends InsurancePolicy {
  beneficiaries: InsuranceBeneficiary[];
  property_address: string | null;
  vehicle_label: string | null;
  insured_user_name: string | null;
  entity_name: string | null;
}

export interface InsurancePolicyCreate {
  policy_type: PolicyType;
  provider: string;
  policy_number?: string;
  country?: string;
  premium_amount?: number;
  premium_frequency?: PremiumFrequency;
  coverage_amount?: number;
  deductible?: number;
  start_date?: string;
  renewal_date?: string;
  auto_renew?: boolean;
  is_active?: boolean;
  property_id?: string;
  vehicle_id?: string;
  insured_user_id?: string;
  entity_id?: string;
  notes?: string;
}

export async function listPolicies(params?: { policy_type?: PolicyType; is_active?: boolean; property_id?: string }): Promise<InsurancePolicy[]> {
  const qs = new URLSearchParams();
  if (params?.policy_type) qs.set("policy_type", params.policy_type);
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  if (params?.property_id) qs.set("property_id", params.property_id);
  const query = qs.toString() ? `?${qs}` : "";
  return apiFetch<InsurancePolicy[]>(`/api/v1/insurance/${query}`);
}
export async function getPolicyDetail(id: string): Promise<InsurancePolicyDetail> {
  return apiFetch<InsurancePolicyDetail>(`/api/v1/insurance/${id}`);
}
export async function createPolicy(data: InsurancePolicyCreate): Promise<InsurancePolicy> {
  return apiFetch<InsurancePolicy>("/api/v1/insurance/", { method: "POST", body: JSON.stringify(data) });
}
export async function updatePolicy(id: string, data: Partial<InsurancePolicyCreate>): Promise<InsurancePolicy> {
  return apiFetch<InsurancePolicy>(`/api/v1/insurance/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deletePolicy(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/insurance/${id}`, { method: "DELETE" });
}
export async function addBeneficiary(
  policyId: string,
  data: { name: string; relationship?: string; beneficiary_type?: string; percentage: number }
): Promise<InsuranceBeneficiary> {
  return apiFetch<InsuranceBeneficiary>(`/api/v1/insurance/${policyId}/beneficiaries`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function updateBeneficiary(
  policyId: string,
  benId: string,
  data: Partial<{ name: string; relationship: string; beneficiary_type: string; percentage: number }>
): Promise<InsuranceBeneficiary> {
  return apiFetch<InsuranceBeneficiary>(`/api/v1/insurance/${policyId}/beneficiaries/${benId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
export async function deleteBeneficiary(policyId: string, benId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/insurance/${policyId}/beneficiaries/${benId}`, { method: "DELETE" });
}

// ─── Retirement Planning ────────────────────────────────────────────────────

export interface RetirementProfile {
  id: string;
  household_id: string;
  birth_year: number;
  retirement_age: number;
  life_expectancy_age: number;
  desired_annual_income: string;
  social_security_estimate: string | null;
  expected_return_rate: string;
  inflation_rate: string;
  safe_withdrawal_rate: string;
  annual_contribution: string;
  include_spouse: boolean;
  spouse_birth_year: number | null;
  spouse_retirement_age: number | null;
  spouse_life_expectancy_age: number | null;
  spouse_social_security_estimate: string | null;
  spouse_annual_contribution: string | null;
  yearly_income: string | null;
  spouse_yearly_income: string | null;
  monthly_essential_expenses: string | null;
  monthly_non_essential_expenses: string | null;
  retirement_account_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface RetirementAccountInfo {
  id: string;
  name: string;
  institution_name: string | null;
  type: string;
  subtype: string | null;
  current_balance: number;
  tax_treatment: "tax_deferred" | "tax_exempt" | "taxable" | "non_investment";
  is_auto_included: boolean;
  is_selected: boolean;
  is_manual_mode: boolean;
}

export interface YearlyProjection {
  year: number;
  age: number;
  projected: number;
  required: number;
}

export interface ScenarioProjection {
  year: number;
  age: number;
  optimistic: number;
  base: number;
  pessimistic: number;
  required: number;
}

export interface IncomeSource {
  label: string;
  annual_amount: number;
  source_type: string;
}

export interface RetirementProjection {
  profile: RetirementProfile;
  current_age: number;
  years_to_retirement: number;
  current_retirement_assets: number;
  total_net_worth: number;
  retirement_wealth_target: number;
  projected_wealth_at_retirement: number;
  pessimistic_wealth_at_retirement: number;
  optimistic_wealth_at_retirement: number;
  gap: number;
  required_additional_annual_saving: number;
  monthly_saving_needed: number;
  on_track_pct: number;
  probability_of_success: number;
  tax_deferred_balance: number;
  taxable_investment_balance: number;
  tax_exempt_balance: number;
  total_monthly_expenses: number;
  income_sources: IncomeSource[];
  yearly_projections: YearlyProjection[];
  scenario_projections: ScenarioProjection[];
  insights: string[];
}

export async function getRetirementProfile(): Promise<RetirementProfile | { has_profile: false }> {
  return apiFetch<RetirementProfile | { has_profile: false }>("/api/v1/retirement/profile");
}

export async function upsertRetirementProfile(data: {
  birth_year: number;
  retirement_age: number;
  life_expectancy_age: number;
  desired_annual_income: number;
  social_security_estimate?: number | null;
  expected_return_rate: number;
  inflation_rate: number;
  safe_withdrawal_rate?: number;
  annual_contribution: number;
  include_spouse?: boolean;
  spouse_birth_year?: number | null;
  spouse_retirement_age?: number | null;
  spouse_life_expectancy_age?: number | null;
  spouse_social_security_estimate?: number | null;
  spouse_annual_contribution?: number | null;
  yearly_income?: number | null;
  spouse_yearly_income?: number | null;
  monthly_essential_expenses?: number | null;
  monthly_non_essential_expenses?: number | null;
}): Promise<RetirementProfile> {
  return apiFetch<RetirementProfile>("/api/v1/retirement/profile", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getRetirementProjection(): Promise<RetirementProjection> {
  return apiFetch<RetirementProjection>("/api/v1/retirement/projection");
}

export async function getRetirementAccounts(): Promise<RetirementAccountInfo[]> {
  return apiFetch<RetirementAccountInfo[]>("/api/v1/retirement/accounts");
}

export async function updateRetirementAccountSelection(accountIds: string[] | null): Promise<RetirementProfile> {
  return apiFetch<RetirementProfile>("/api/v1/retirement/accounts/selection", {
    method: "PUT",
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

export interface YearlyPlanRow {
  year: number;
  age: number;
  spouse_age: number | null;
  savings_start_of_year: number;
  essential_expenses: number;
  non_essential_expenses: number;
  estimated_taxes: number;
  total_expenses: number;
  earned_income: number;
  other_income: number;
  total_income: number;
  savings_withdrawals: number;
  rmd_amount: number;
  withdrawal_pct: number;
  savings_end_of_year: number;
  net_surplus_deficit: number;
}

export async function getRetirementYearlyPlan(): Promise<YearlyPlanRow[]> {
  return apiFetch<YearlyPlanRow[]>("/api/v1/retirement/yearly-plan");
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface SankeyNode {
  id: string;
  label: string;
  color: string;
  value: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
  total_income: number;
  total_expenses: number;
  remaining: number;
  month: number;
  year: number;
  is_annual?: boolean;
  sankey_type?: "standard" | "payroll";
  gross_income?: number;
}

export async function getSankeyData(params: {
  month?: number;
  year?: number;
  startDate?: string;
  endDate?: string;
  memberId?: string;
  annual?: boolean;
}): Promise<SankeyData> {
  const q = new URLSearchParams();
  if (params.annual) {
    q.set("annual", "true");
    if (params.year !== undefined) q.set("year", String(params.year));
  } else if (params.startDate && params.endDate) {
    q.set("start_date", params.startDate);
    q.set("end_date", params.endDate);
  } else if (params.month !== undefined && params.year !== undefined) {
    q.set("month", String(params.month));
    q.set("year", String(params.year));
  }
  if (params.memberId) q.set("member_id", params.memberId);
  return apiFetch<SankeyData>(`/api/v1/analytics/sankey?${q.toString()}`);
}

export interface SalaryWithholding {
  id: string;
  household_id: string;
  user_id: string;
  year: number;
  employer_name: string | null;
  gross_wages: string;
  federal_wages: string;
  medicare_wages: string;
  federal_income_tax: string;
  state_income_tax: string;
  social_security_tax: string;
  medicare_tax: string;
  traditional_401k: string;
  roth_401k: string;
  esop_income: string;
  hsa: string;
  health_insurance: string;
  group_term_life: string;
  fsa_section125: string;
}

export interface SalaryWithholdingUpsert {
  user_id: string;
  year: number;
  employer_name?: string;
  gross_wages?: string;
  federal_wages?: string;
  medicare_wages?: string;
  federal_income_tax?: string;
  state_income_tax?: string;
  social_security_tax?: string;
  medicare_tax?: string;
  traditional_401k?: string;
  roth_401k?: string;
  esop_income?: string;
  hsa?: string;
  health_insurance?: string;
  group_term_life?: string;
  fsa_section125?: string;
}

export async function listSalaryWithholdings(year?: number): Promise<SalaryWithholding[]> {
  const q = year !== undefined ? `?year=${year}` : "";
  return apiFetch<SalaryWithholding[]>(`/api/v1/salary/withholdings${q}`);
}

export async function upsertSalaryWithholding(data: SalaryWithholdingUpsert): Promise<SalaryWithholding> {
  return apiFetch<SalaryWithholding>("/api/v1/salary/withholdings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteSalaryWithholding(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/salary/withholdings/${id}`, { method: "DELETE" });
}

