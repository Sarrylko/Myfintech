// Empty string = relative URLs, routed through Caddy proxy (/api/* -> FastAPI)
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
  name: string;
  official_name: string | null;
  institution_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: string | null;
  available_balance: string | null;
  currency_code: string;
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
}

export interface AccountUpdate {
  owner_user_id?: string | null;
  name?: string;
  institution_name?: string;
  type?: string;
  subtype?: string;
  mask?: string;
  current_balance?: number | null;
  is_hidden?: boolean;
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

export async function listAllTransactions(
  limit = 100,
  offset = 0
): Promise<Transaction[]> {
  return apiFetch(`/api/v1/accounts/transactions?limit=${limit}&offset=${offset}`, {});
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
  created_at: string;
}

export interface PropertyCreate {
  address: string;
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
  created_at: string;
}

export interface TenantCreate {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
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
}

export interface RecurringTransaction {
  id: string;
  household_id: string;
  name: string;
  merchant_name: string | null;
  amount: string;
  frequency: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
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

export async function updateRecurring(
  id: string,
  data: { name?: string; is_active?: boolean; notes?: string; frequency?: string }
): Promise<RecurringTransaction> {
  return apiFetch<RecurringTransaction>(`/api/v1/recurring/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteRecurring(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/recurring/${id}`, { method: "DELETE" });
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

export async function createHolding(accountId: string, data: HoldingCreate): Promise<Holding> {
  return apiFetch<Holding>(`/api/v1/accounts/${accountId}/holdings`, { method: "POST", body: JSON.stringify(data) });
}

export async function updateHolding(holdingId: string, data: HoldingUpdate): Promise<Holding> {
  return apiFetch<Holding>(`/api/v1/accounts/holdings/${holdingId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteHolding(holdingId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/holdings/${holdingId}`, { method: "DELETE" });
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
): Promise<PortfolioReport> {
  return apiFetch<PortfolioReport>(
    `/api/v1/reports/portfolio?year=${year}&month=${month}`,
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

export async function copyBudgetsFromLastMonth(
  month: number,
  year: number
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>(
    `/api/v1/budgets/copy-from-last-month?month=${month}&year=${year}`,
    { method: "POST" }
  );
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