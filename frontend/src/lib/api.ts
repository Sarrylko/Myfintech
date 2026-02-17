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
    throw new Error(body.detail || `API error: ${res.status}`);
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
  plaid_item_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: string | null;
  available_balance: string | null;
  currency_code: string;
  is_hidden: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  account_id: string;
  amount: string;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  plaid_category: string | null;
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

export async function listAccounts(token: string): Promise<Account[]> {
  return apiFetch("/api/v1/accounts/", { token });
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
  current_value: string | null;
  last_valuation_date: string | null;
  notes: string | null;
  mortgage_balance: string | null;
  monthly_rent: string | null;
  mortgage_monthly: string | null;
  property_tax_annual: string | null;
  insurance_annual: string | null;
  hoa_monthly: string | null;
  maintenance_monthly: string | null;
  created_at: string;
}

export interface PropertyCreate {
  address: string;
  city?: string;
  state?: string;
  zip_code?: string;
  property_type?: string;
  purchase_price?: number;
  current_value?: number;
  notes?: string;
  mortgage_balance?: number;
  monthly_rent?: number;
  mortgage_monthly?: number;
  property_tax_annual?: number;
  insurance_annual?: number;
  hoa_monthly?: number;
  maintenance_monthly?: number;
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
