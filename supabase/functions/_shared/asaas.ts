/**
 * Asaas Payment API shared utilities
 * Used by edge functions that handle payments, subscriptions, and billing.
 * Docs: https://docs.asaas.com/reference
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ASAAS_API_URL = Deno.env.get("ASAAS_API_URL") || "https://api.asaas.com/v3";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY")!;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AsaasPaymentStatus =
  | "PENDING"
  | "RECEIVED"
  | "CONFIRMED"
  | "OVERDUE"
  | "REFUNDED"
  | "RECEIVED_IN_CASH"
  | "REFUND_REQUESTED"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
  | "AWAITING_CHARGEBACK_REVERSAL"
  | "DUNNING_REQUESTED"
  | "DUNNING_RECEIVED"
  | "AWAITING_RISK_ANALYSIS";

export interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
  phone?: string;
  [key: string]: unknown;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  billingType: "PIX" | "CREDIT_CARD" | "BOLETO" | "UNDEFINED";
  value: number;
  dueDate: string;
  status: AsaasPaymentStatus;
  description?: string;
  [key: string]: unknown;
}

export interface AsaasSubscription {
  id: string;
  customer: string;
  billingType: "CREDIT_CARD";
  value: number;
  cycle: "MONTHLY" | "SEMIANNUALLY" | "YEARLY";
  nextDueDate: string;
  status: string;
  description?: string;
  [key: string]: unknown;
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function asaasFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${ASAAS_API_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "access_token": ASAAS_API_KEY,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[Asaas] ${options.method ?? "GET"} ${path} failed — HTTP ${res.status}: ${body}`
    );
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/**
 * Create a new customer in Asaas.
 */
export async function createCustomer(data: {
  name: string;
  email: string;
  cpfCnpj: string;
  phone?: string;
}): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Find an existing customer by email.
 * Returns the first match, or null if none found.
 */
export async function findCustomerByEmail(
  email: string
): Promise<AsaasCustomer | null> {
  const data = await asaasFetch<{ data: AsaasCustomer[]; totalCount: number }>(
    `/customers?email=${encodeURIComponent(email)}`
  );
  return data.data?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Create a one-time payment (PIX or credit card).
 */
export async function createPayment(data: {
  customer: string;
  billingType: "PIX" | "CREDIT_CARD";
  value: number;
  dueDate: string;
  description: string;
  creditCard?: unknown;
  creditCardHolderInfo?: unknown;
  creditCardToken?: string;
}): Promise<AsaasPayment> {
  return asaasFetch<AsaasPayment>("/payments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Retrieve full payment details including current status.
 */
export async function getPaymentStatus(paymentId: string): Promise<AsaasPayment> {
  return asaasFetch<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

/**
 * Retrieve PIX QR code for a payment created with billingType=PIX.
 */
export async function getPaymentPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
  return asaasFetch<AsaasPixQrCode>(
    `/payments/${encodeURIComponent(paymentId)}/pixQrCode`
  );
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Create a recurring subscription charged to a tokenized credit card.
 */
export async function createSubscription(data: {
  customer: string;
  billingType: "CREDIT_CARD";
  value: number;
  cycle: "MONTHLY" | "SEMIANNUALLY" | "YEARLY";
  nextDueDate: string;
  description: string;
  creditCardToken: string;
}): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
