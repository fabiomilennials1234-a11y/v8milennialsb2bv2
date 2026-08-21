/**
 * Payment domain types — provider-neutral.
 *
 * Nothing in here names a gateway. The vocabulary is the Torque billing domain, so a second
 * provider can be added later without rewriting callers. See map #1376 and PRD #1393.
 *
 * Money is ALWAYS integer cents in this layer. Decimal reais exist only inside a provider
 * adapter, at the boundary where the gateway demands them.
 */

/** How the customer pays. */
export type PaymentMethod = "pix" | "credit_card";

/**
 * Billing cycle sold to the customer.
 *
 * PIX is restricted to the long cycles — see `policy.ts` for the rule and why it exists.
 */
export type BillingCycle = "monthly" | "semiannual" | "annual";

/**
 * Canonical charge status.
 *
 * `unknown` is deliberate: a gateway can introduce a status at any time, and a webhook that
 * throws on an unrecognised value retries forever. Unknown must be representable.
 */
export type ChargeStatus =
  | "pending"
  | "paid"
  | "overdue"
  | "refunded"
  | "chargeback"
  | "in_analysis"
  | "cancelled"
  | "unknown";

/** Canonical subscription status. */
export type SubscriptionStatus = "active" | "inactive" | "expired" | "unknown";

export interface CustomerInput {
  name: string;
  email: string;
  /** CPF or CNPJ. Punctuation is stripped by the adapter. */
  taxId: string;
  phone?: string;
}

export interface ProviderCustomer {
  providerCustomerId: string;
  name: string;
  email: string;
  taxId: string;
}

export interface CreateChargeInput {
  providerCustomerId: string;
  method: PaymentMethod;
  amountCents: number;
  /** ISO date, `YYYY-MM-DD`. */
  dueDate: string;
  description: string;
  /**
   * Tokenised card reference. Required for `credit_card`.
   *
   * This layer accepts a token and nothing else: raw card data must never reach it. That is a
   * real constraint on the port, but it is NOT by itself a PCI-DSS scope reduction — with
   * Asaas, tokenisation is a server-to-server call authenticated with the account key, so
   * whichever component collects the card is in scope. Where collection happens is an open
   * decision on map #1376.
   */
  cardToken?: string;
  /** Opaque value echoed back by the gateway, used to correlate webhooks. */
  externalReference?: string;
}

export interface Charge {
  providerChargeId: string;
  providerCustomerId: string;
  method: PaymentMethod;
  amountCents: number;
  status: ChargeStatus;
  dueDate?: string;
  externalReference?: string;
}

export interface CreateSubscriptionInput {
  providerCustomerId: string;
  method: PaymentMethod;
  cycle: BillingCycle;
  amountCents: number;
  /** ISO date, `YYYY-MM-DD`. */
  nextDueDate: string;
  description: string;
  /** Required for `credit_card`. */
  cardToken?: string;
  externalReference?: string;
}

export interface Subscription {
  providerSubscriptionId: string;
  providerCustomerId: string;
  method: PaymentMethod;
  cycle: BillingCycle;
  amountCents: number;
  status: SubscriptionStatus;
  nextDueDate?: string;
  externalReference?: string;
}

/** PIX payload the checkout page renders as QR code plus copy-and-paste string. */
export interface PixPayload {
  /** Base64 PNG. */
  encodedImage: string;
  /** Copy-and-paste string. */
  payload: string;
  expiresAt?: string;
}
