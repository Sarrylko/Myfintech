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
