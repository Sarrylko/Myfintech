// Empty string = relative URLs, routed through Caddy proxy (/api/* → FastAPI)
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface FetchOptions extends RequestInit {
  token?: string;
}

export async function apiFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { token, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...rest,
  });

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

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

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

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

export function setTokens(tokens: TokenResponse) {
  localStorage.setItem("access_token", tokens.access_token);
  localStorage.setItem("refresh_token", tokens.refresh_token);
}

export function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  return apiFetch<TokenResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
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

export async function getProfile(token: string): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/users/me", { token });
}

export async function updateProfile(
  data: UserProfileUpdate,
  token: string
): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function changePassword(
  current_password: string,
  new_password: string,
  token: string
): Promise<void> {
  return apiFetch<void>("/api/v1/users/me/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
    token,
  });
}

// ─── Household Members ───────────────────────────────────────────────────────

export interface HouseholdMemberCreate {
  full_name: string;
  email: string;
  password: string;
  role?: string;
}

export async function listHouseholdMembers(token: string): Promise<UserResponse[]> {
  return apiFetch<UserResponse[]>("/api/v1/users/household/members", { token });
}

export async function addHouseholdMember(
  data: HouseholdMemberCreate,
  token: string
): Promise<UserResponse> {
  return apiFetch<UserResponse>("/api/v1/users/household/members", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function removeHouseholdMember(memberId: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/users/household/members/${memberId}`, {
    method: "DELETE",
    token,
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

export async function getLinkToken(token: string): Promise<{ link_token: string }> {
  return apiFetch("/api/v1/plaid/link-token", { method: "POST", token });
}

export async function exchangePublicToken(
  public_token: string,
  institution_id: string | null,
  institution_name: string | null,
  token: string
): Promise<PlaidItem> {
  return apiFetch("/api/v1/plaid/exchange-token", {
    method: "POST",
    body: JSON.stringify({ public_token, institution_id, institution_name }),
    token,
  });
}

export async function listPlaidItems(token: string): Promise<PlaidItem[]> {
  return apiFetch("/api/v1/plaid/items", { token });
}

export async function syncPlaidItem(itemId: string, token: string): Promise<void> {
  return apiFetch(`/api/v1/plaid/items/${itemId}/sync`, { method: "POST", token });
}

export async function deletePlaidItem(
  itemId: string,
  deleteTransactions: boolean,
  token: string
): Promise<void> {
  return apiFetch<void>(`/api/v1/plaid/items/${itemId}?delete_transactions=${deleteTransactions}`, {
    method: "DELETE",
    token,
  });
}

export async function listAccounts(token: string): Promise<Account[]> {
  return apiFetch("/api/v1/accounts/", { token });
}

export async function createManualAccount(
  data: ManualAccountCreate,
  token: string
): Promise<Account> {
  return apiFetch("/api/v1/accounts/", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteAccount(
  id: string,
  deleteTransactions: boolean,
  token: string
): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/${id}?delete_transactions=${deleteTransactions}`, {
    method: "DELETE",
    token,
  });
}

export async function updateAccount(
  id: string,
  data: AccountUpdate,
  token: string
): Promise<Account> {
  return apiFetch<Account>(`/api/v1/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function importCsv(
  accountId: string,
  file: File,
  token: string
): Promise<{ imported: number; duplicates: number; errors: { row: number; error: string }[]; total_rows: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/v1/accounts/${accountId}/import-csv`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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
  }>,
  token: string
): Promise<Transaction> {
  return apiFetch(`/api/v1/accounts/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function listAllTransactions(
  token: string,
  limit = 100,
  offset = 0
): Promise<Transaction[]> {
  return apiFetch(`/api/v1/accounts/transactions?limit=${limit}&offset=${offset}`, { token });
}

export async function listAccountTransactions(
  accountId: string,
  token: string,
  limit = 50
): Promise<Transaction[]> {
  return apiFetch(`/api/v1/accounts/${accountId}/transactions?limit=${limit}`, { token });
}

// ─── Properties ────────────────────────────────────────────────────────────

export interface Property {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
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

export async function listProperties(token: string): Promise<Property[]> {
  return apiFetch<Property[]>("/api/v1/properties/", { token });
}

export async function createProperty(
  data: PropertyCreate,
  token: string
): Promise<Property> {
  return apiFetch<Property>("/api/v1/properties/", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function updateProperty(
  id: string,
  data: Partial<PropertyCreate>,
  token: string
): Promise<Property> {
  return apiFetch<Property>(`/api/v1/properties/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteProperty(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/properties/${id}`, {
    method: "DELETE",
    token,
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
export async function listUnits(propertyId: string, token: string): Promise<Unit[]> {
  return apiFetch<Unit[]>(`/api/v1/properties/${propertyId}/units`, { token });
}
export async function createUnit(propertyId: string, data: UnitCreate, token: string): Promise<Unit> {
  return apiFetch<Unit>(`/api/v1/properties/${propertyId}/units`, { method: "POST", body: JSON.stringify(data), token });
}
export async function updateUnit(id: string, data: Partial<UnitCreate>, token: string): Promise<Unit> {
  return apiFetch<Unit>(`/api/v1/units/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deleteUnit(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/units/${id}`, { method: "DELETE", token });
}

// Tenants
export async function listTenants(token: string): Promise<Tenant[]> {
  return apiFetch<Tenant[]>("/api/v1/tenants/", { token });
}
export async function createTenant(data: TenantCreate, token: string): Promise<Tenant> {
  return apiFetch<Tenant>("/api/v1/tenants/", { method: "POST", body: JSON.stringify(data), token });
}
export async function updateTenant(id: string, data: Partial<TenantCreate>, token: string): Promise<Tenant> {
  return apiFetch<Tenant>(`/api/v1/tenants/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deleteTenant(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/tenants/${id}`, { method: "DELETE", token });
}

// Leases
export async function listLeases(token: string, status?: string): Promise<Lease[]> {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<Lease[]>(`/api/v1/leases/${qs}`, { token });
}
export async function listUnitLeases(unitId: string, token: string): Promise<Lease[]> {
  return apiFetch<Lease[]>(`/api/v1/units/${unitId}/leases`, { token });
}
export async function createLease(data: LeaseCreate, token: string): Promise<Lease> {
  return apiFetch<Lease>("/api/v1/leases/", { method: "POST", body: JSON.stringify(data), token });
}
export async function updateLease(id: string, data: LeaseUpdate, token: string): Promise<Lease> {
  return apiFetch<Lease>(`/api/v1/leases/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deleteLease(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/leases/${id}`, { method: "DELETE", token });
}

// Charges
export async function listCharges(leaseId: string, token: string): Promise<RentCharge[]> {
  return apiFetch<RentCharge[]>(`/api/v1/leases/${leaseId}/charges`, { token });
}
export async function createCharge(leaseId: string, data: RentChargeCreate, token: string): Promise<RentCharge> {
  return apiFetch<RentCharge>(`/api/v1/leases/${leaseId}/charges`, { method: "POST", body: JSON.stringify(data), token });
}

// Payments
export async function listPayments(leaseId: string, token: string): Promise<Payment[]> {
  return apiFetch<Payment[]>(`/api/v1/leases/${leaseId}/payments`, { token });
}
export async function createPayment(leaseId: string, data: PaymentCreate, token: string): Promise<Payment> {
  return apiFetch<Payment>(`/api/v1/leases/${leaseId}/payments`, { method: "POST", body: JSON.stringify(data), token });
}
export async function updatePayment(id: string, data: Partial<PaymentCreate>, token: string): Promise<Payment> {
  return apiFetch<Payment>(`/api/v1/payments/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deletePayment(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/payments/${id}`, { method: "DELETE", token });
}

export interface PaymentImportResult {
  imported: number;
  total_rows: number;
  errors: { row: number; error: string }[];
}

export async function importPayments(
  leaseId: string,
  file: File,
  token: string,
): Promise<PaymentImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/v1/leases/${leaseId}/payments/import-csv`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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

export async function listLoans(propertyId: string, token: string): Promise<Loan[]> {
  return apiFetch<Loan[]>(`/api/v1/properties/${propertyId}/loans`, { token });
}
export async function createLoan(propertyId: string, data: LoanCreate, token: string): Promise<Loan> {
  return apiFetch<Loan>(`/api/v1/properties/${propertyId}/loans`, { method: "POST", body: JSON.stringify(data), token });
}
export async function updateLoan(id: string, data: Partial<LoanCreate>, token: string): Promise<Loan> {
  return apiFetch<Loan>(`/api/v1/loans/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deleteLoan(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/loans/${id}`, { method: "DELETE", token });
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
  notes: string | null;
  created_at: string;
}

export interface PropertyCostCreate {
  category?: string;
  label?: string;
  amount: number;
  frequency?: string;
  is_active?: boolean;
  notes?: string;
}

export async function listPropertyCosts(propertyId: string, token: string): Promise<PropertyCost[]> {
  return apiFetch<PropertyCost[]>(`/api/v1/properties/${propertyId}/costs`, { token });
}
export async function createPropertyCost(propertyId: string, data: PropertyCostCreate, token: string): Promise<PropertyCost> {
  return apiFetch<PropertyCost>(`/api/v1/properties/${propertyId}/costs`, { method: "POST", body: JSON.stringify(data), token });
}
export async function updatePropertyCost(id: string, data: Partial<PropertyCostCreate>, token: string): Promise<PropertyCost> {
  return apiFetch<PropertyCost>(`/api/v1/property-costs/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deletePropertyCost(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/property-costs/${id}`, { method: "DELETE", token });
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

export async function listMaintenanceExpenses(propertyId: string, token: string): Promise<MaintenanceExpense[]> {
  return apiFetch<MaintenanceExpense[]>(`/api/v1/properties/${propertyId}/expenses`, { token });
}
export async function createMaintenanceExpense(propertyId: string, data: MaintenanceExpenseCreate, token: string): Promise<MaintenanceExpense> {
  return apiFetch<MaintenanceExpense>(`/api/v1/properties/${propertyId}/expenses`, { method: "POST", body: JSON.stringify(data), token });
}
export async function updateMaintenanceExpense(id: string, data: Partial<MaintenanceExpenseCreate>, token: string): Promise<MaintenanceExpense> {
  return apiFetch<MaintenanceExpense>(`/api/v1/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deleteMaintenanceExpense(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/expenses/${id}`, { method: "DELETE", token });
}

export async function importMaintenanceExpenses(
  propertyId: string,
  file: File,
  token: string
): Promise<{ imported: number; errors: { row: number; error: string }[]; total_rows: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/v1/properties/${propertyId}/expenses/import-csv`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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

export async function listPropertyValuations(propertyId: string, token: string): Promise<PropertyValuation[]> {
  return apiFetch<PropertyValuation[]>(`/api/v1/properties/${propertyId}/valuations`, { token });
}
export async function createPropertyValuation(propertyId: string, data: PropertyValuationCreate, token: string): Promise<PropertyValuation> {
  return apiFetch<PropertyValuation>(`/api/v1/properties/${propertyId}/valuations`, { method: "POST", body: JSON.stringify(data), token });
}
export async function deletePropertyValuation(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/valuations/${id}`, { method: "DELETE", token });
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

export async function detectRecurring(token: string): Promise<RecurringCandidate[]> {
  return apiFetch<RecurringCandidate[]>("/api/v1/recurring/detect", { method: "POST", token });
}

export async function confirmRecurring(
  candidates: RecurringCandidate[],
  token: string
): Promise<RecurringTransaction[]> {
  return apiFetch<RecurringTransaction[]>("/api/v1/recurring/confirm", {
    method: "POST",
    body: JSON.stringify({ candidates }),
    token,
  });
}

export async function listRecurring(token: string): Promise<RecurringTransaction[]> {
  return apiFetch<RecurringTransaction[]>("/api/v1/recurring/", { token });
}

export async function updateRecurring(
  id: string,
  data: { name?: string; is_active?: boolean; notes?: string; frequency?: string },
  token: string
): Promise<RecurringTransaction> {
  return apiFetch<RecurringTransaction>(`/api/v1/recurring/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteRecurring(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/recurring/${id}`, { method: "DELETE", token });
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

export async function listHoldings(accountId: string, token: string): Promise<Holding[]> {
  return apiFetch<Holding[]>(`/api/v1/accounts/${accountId}/holdings`, { token });
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

export async function getTickerInfo(symbol: string, token: string): Promise<TickerInfo> {
  return apiFetch<TickerInfo>(`/api/v1/investments/ticker-info?symbol=${encodeURIComponent(symbol)}`, { token });
}

export async function createHolding(accountId: string, data: HoldingCreate, token: string): Promise<Holding> {
  return apiFetch<Holding>(`/api/v1/accounts/${accountId}/holdings`, { token, method: "POST", body: JSON.stringify(data) });
}

export async function updateHolding(holdingId: string, data: HoldingUpdate, token: string): Promise<Holding> {
  return apiFetch<Holding>(`/api/v1/accounts/holdings/${holdingId}`, { token, method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteHolding(holdingId: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/accounts/holdings/${holdingId}`, { token, method: "DELETE" });
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

export async function listRules(token: string): Promise<Rule[]> {
  return apiFetch<Rule[]>("/api/v1/rules/", { token });
}

export async function createRule(data: RuleCreate, token: string): Promise<Rule> {
  return apiFetch<Rule>("/api/v1/rules/", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function updateRule(
  id: string,
  data: Partial<RuleCreate & { is_active: boolean }>,
  token: string
): Promise<Rule> {
  return apiFetch<Rule>(`/api/v1/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteRule(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/rules/${id}`, {
    method: "DELETE",
    token,
  });
}

export async function applyRules(token: string): Promise<{ applied: number }> {
  return apiFetch<{ applied: number }>("/api/v1/rules/apply", {
    method: "POST",
    token,
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

export async function listCustomCategories(token: string): Promise<CustomCategory[]> {
  return apiFetch<CustomCategory[]>("/api/v1/categories/", { token });
}

export async function createCustomCategory(
  data: { name: string; parent_id?: string; is_income?: boolean },
  token: string
): Promise<CustomCategory> {
  return apiFetch<CustomCategory>("/api/v1/categories/", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteCustomCategory(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/categories/${id}`, {
    method: "DELETE",
    token,
  });
}

export async function seedDefaultCategories(token: string): Promise<CustomCategory[]> {
  return apiFetch<CustomCategory[]>("/api/v1/categories/seed-defaults", {
    method: "POST",
    token,
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

export async function listCapitalEvents(propertyId: string, token: string): Promise<CapitalEvent[]> {
  return apiFetch<CapitalEvent[]>(`/api/v1/properties/${propertyId}/capital-events`, { token });
}
export async function createCapitalEvent(propertyId: string, data: CapitalEventCreate, token: string): Promise<CapitalEvent> {
  return apiFetch<CapitalEvent>(`/api/v1/properties/${propertyId}/capital-events`, { method: "POST", body: JSON.stringify(data), token });
}
export async function updateCapitalEvent(id: string, data: Partial<CapitalEventCreate>, token: string): Promise<CapitalEvent> {
  return apiFetch<CapitalEvent>(`/api/v1/capital-events/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
}
export async function deleteCapitalEvent(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/capital-events/${id}`, { method: "DELETE", token });
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
  token: string,
  period?: string, // "default" | "ltd"
): Promise<PropertyReport> {
  const params = new URLSearchParams({ year: String(year), month });
  if (period) params.set("period", period);
  return apiFetch<PropertyReport>(
    `/api/v1/reports/property/${propertyId}?${params}`,
    { token }
  );
}

export async function getPortfolioReport(
  year: number,
  month: string, // YYYY-MM
  token: string
): Promise<PortfolioReport> {
  return apiFetch<PortfolioReport>(
    `/api/v1/reports/portfolio?year=${year}&month=${month}`,
    { token }
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

export async function getInvestmentSettings(token: string): Promise<InvestmentRefreshSettings> {
  return apiFetch<InvestmentRefreshSettings>("/api/v1/investments/settings", { token });
}

export async function updateInvestmentSettings(
  data: InvestmentRefreshSettings,
  token: string
): Promise<InvestmentRefreshSettings> {
  return apiFetch<InvestmentRefreshSettings>("/api/v1/investments/settings", {
    token,
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getRefreshStatus(token: string): Promise<RefreshStatus> {
  return apiFetch<RefreshStatus>("/api/v1/investments/refresh-status", { token });
}

export async function getMarketStatus(token: string): Promise<MarketStatus> {
  return apiFetch<MarketStatus>("/api/v1/investments/market-status", { token });
}

export async function refreshInvestmentPrices(token: string): Promise<RefreshResult> {
  return apiFetch<RefreshResult>("/api/v1/investments/refresh-prices", {
    token,
    method: "POST",
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

export async function registerSnapTradeUser(
  token: string
): Promise<SnapTradeRegisterResponse> {
  return apiFetch<SnapTradeRegisterResponse>("/api/v1/snaptrade/register-user", {
    token,
    method: "POST",
  });
}

export async function getSnapTradeConnectUrl(
  token: string
): Promise<{ redirect_url: string }> {
  return apiFetch<{ redirect_url: string }>("/api/v1/snaptrade/connect-url", {
    token,
    method: "POST",
  });
}

export async function listSnapTradeConnections(
  token: string
): Promise<SnapTradeConnection[]> {
  return apiFetch<SnapTradeConnection[]>("/api/v1/snaptrade/connections", { token });
}

export async function syncSnapTradeAuthorizations(
  token: string
): Promise<SnapTradeConnection[]> {
  return apiFetch<SnapTradeConnection[]>("/api/v1/snaptrade/sync-authorizations", {
    token,
    method: "POST",
  });
}

export async function syncSnapTradeConnection(
  connectionId: string,
  token: string
): Promise<SnapTradeSyncResponse> {
  return apiFetch<SnapTradeSyncResponse>(
    `/api/v1/snaptrade/connections/${connectionId}/sync`,
    { token, method: "POST" }
  );
}

export async function deleteSnapTradeConnection(
  connectionId: string,
  token: string
): Promise<void> {
  await apiFetch<void>(`/api/v1/snaptrade/connections/${connectionId}`, {
    token,
    method: "DELETE",
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
  year: number,
  token: string
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>(
    `/api/v1/budgets/?month=${month}&year=${year}`,
    { token }
  );
}

export async function listLongTermBudgets(
  year: number,
  token: string
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>(
    `/api/v1/budgets/?year=${year}&budget_type=long_term`,
    { token }
  );
}

export async function createBudget(
  data: BudgetCreate,
  token: string
): Promise<BudgetWithActual> {
  return apiFetch<BudgetWithActual>("/api/v1/budgets/", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function createBudgetsBulk(
  data: BudgetBulkCreate,
  token: string
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>("/api/v1/budgets/bulk", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function updateBudget(
  id: string,
  data: BudgetUpdate,
  token: string
): Promise<BudgetWithActual> {
  return apiFetch<BudgetWithActual>(`/api/v1/budgets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteBudget(id: string, token: string): Promise<void> {
  await apiFetch<void>(`/api/v1/budgets/${id}`, {
    method: "DELETE",
    token,
  });
}

export async function copyBudgetsFromLastMonth(
  month: number,
  year: number,
  token: string
): Promise<BudgetWithActual[]> {
  return apiFetch<BudgetWithActual[]>(
    `/api/v1/budgets/copy-from-last-month?month=${month}&year=${year}`,
    { method: "POST", token }
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
  days: number,
  token: string
): Promise<NetWorthSnapshot[]> {
  return apiFetch<NetWorthSnapshot[]>(
    `/api/v1/networth/snapshots?days=${days}`,
    { token }
  );
}

export async function takeNetWorthSnapshot(token: string): Promise<NetWorthSnapshot> {
  return apiFetch<NetWorthSnapshot>("/api/v1/networth/snapshots", {
    method: "POST",
    token,
  });
}
