/**
 * Asaas implementation of the payment port.
 *
 * This is the only file in the payments layer that knows Asaas exists. Everything Asaas-shaped
 * — decimal reais, SCREAMING_CASE statuses, `cpfCnpj`, `access_token` — stops here.
 *
 * Docs: https://docs.asaas.com/reference
 */

import { fromProviderAmount, toProviderAmount } from "./money.ts";
import { assertCycleAllowedForMethod } from "./policy.ts";
import type { PaymentProvider } from "./port.ts";
import type {
  BillingCycle,
  Charge,
  ChargeStatus,
  CreateChargeInput,
  CreateSubscriptionInput,
  CustomerInput,
  PaymentMethod,
  PixPayload,
  ProviderCustomer,
  Subscription,
  SubscriptionStatus,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Vocabulary mapping
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, ChargeStatus> = {
  PENDING: "pending",
  RECEIVED: "paid",
  CONFIRMED: "paid",
  RECEIVED_IN_CASH: "paid",
  OVERDUE: "overdue",
  DUNNING_REQUESTED: "overdue",
  DUNNING_RECEIVED: "overdue",
  REFUNDED: "refunded",
  REFUND_REQUESTED: "refunded",
  CHARGEBACK_REQUESTED: "chargeback",
  CHARGEBACK_DISPUTE: "chargeback",
  AWAITING_CHARGEBACK_REVERSAL: "chargeback",
  AWAITING_RISK_ANALYSIS: "in_analysis",
};

/**
 * Total by construction: an unrecognised status becomes `unknown` rather than throwing.
 * A webhook that throws on a status the gateway introduced tomorrow retries forever.
 */
export function mapAsaasStatus(status: string): ChargeStatus {
  return STATUS_MAP[status] ?? "unknown";
}

const SUBSCRIPTION_STATUS_MAP: Record<string, SubscriptionStatus> = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  EXPIRED: "expired",
};

const CYCLE_TO_ASAAS: Record<BillingCycle, string> = {
  monthly: "MONTHLY",
  semiannual: "SEMIANNUALLY",
  annual: "YEARLY",
};

const CYCLE_FROM_ASAAS: Record<string, BillingCycle> = {
  MONTHLY: "monthly",
  SEMIANNUALLY: "semiannual",
  YEARLY: "annual",
};

const METHOD_TO_ASAAS: Record<PaymentMethod, string> = {
  pix: "PIX",
  credit_card: "CREDIT_CARD",
};

const METHOD_FROM_ASAAS: Record<string, PaymentMethod> = {
  PIX: "pix",
  CREDIT_CARD: "credit_card",
};

/** Asaas stores documents unpunctuated; humans type them punctuated. */
function normaliseTaxId(taxId: string): string {
  return taxId.replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface AsaasProviderOptions {
  apiUrl: string;
  apiKey: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function createAsaasProvider(options: AsaasProviderOptions): PaymentProvider {
  const { apiUrl, apiKey } = options;
  const doFetch = options.fetchImpl ?? fetch;

  // Fail at construction, not on the first charge. A provider built without a key would
  // otherwise send `access_token: undefined` and fail at the worst possible moment.
  if (!apiKey) {
    throw new Error("[asaas] ASAAS_API_KEY is missing — cannot build the payment provider");
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        // Header, never the query string — query strings land in access logs.
        "access_token": apiKey,
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      // The message reaches runtime_logs. It carries the status and the gateway's own error
      // text, and deliberately never the credential.
      throw new Error(
        `[asaas] ${init.method ?? "GET"} ${path} failed — HTTP ${res.status}: ${body}`,
      );
    }

    return await res.json() as T;
  }

  function toCharge(raw: Record<string, unknown>): Charge {
    return {
      providerChargeId: String(raw.id),
      providerCustomerId: String(raw.customer),
      method: METHOD_FROM_ASAAS[String(raw.billingType)] ?? "pix",
      amountCents: fromProviderAmount(Number(raw.value)),
      status: mapAsaasStatus(String(raw.status ?? "")),
      dueDate: raw.dueDate ? String(raw.dueDate) : undefined,
      externalReference: raw.externalReference ? String(raw.externalReference) : undefined,
    };
  }

  return {
    name: "asaas",

    async ensureCustomer(input: CustomerInput): Promise<ProviderCustomer> {
      const taxId = normaliseTaxId(input.taxId);

      // Identity is the document, not the email — two organizations can share a billing
      // address, and matching on email would merge two customers into one.
      const found = await request<{ data?: Array<Record<string, unknown>> }>(
        `/customers?cpfCnpj=${encodeURIComponent(taxId)}`,
      );
      const existing = found.data?.[0];
      if (existing) {
        return {
          providerCustomerId: String(existing.id),
          name: String(existing.name ?? input.name),
          email: String(existing.email ?? input.email),
          taxId,
        };
      }

      const created = await request<Record<string, unknown>>("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          email: input.email,
          cpfCnpj: taxId,
          ...(input.phone ? { phone: input.phone } : {}),
        }),
      });

      return {
        providerCustomerId: String(created.id),
        name: input.name,
        email: input.email,
        taxId,
      };
    },

    async createCharge(input: CreateChargeInput): Promise<Charge> {
      if (input.method === "credit_card" && !input.cardToken) {
        throw new Error("[asaas] a credit_card charge requires a card token");
      }

      const raw = await request<Record<string, unknown>>("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: input.providerCustomerId,
          billingType: METHOD_TO_ASAAS[input.method],
          value: toProviderAmount(input.amountCents),
          dueDate: input.dueDate,
          description: input.description,
          ...(input.cardToken ? { creditCardToken: input.cardToken } : {}),
          ...(input.externalReference ? { externalReference: input.externalReference } : {}),
        }),
      });

      return toCharge(raw);
    },

    async getCharge(providerChargeId: string): Promise<Charge> {
      const raw = await request<Record<string, unknown>>(
        `/payments/${encodeURIComponent(providerChargeId)}`,
      );
      return toCharge(raw);
    },

    async getPixPayload(providerChargeId: string): Promise<PixPayload> {
      const raw = await request<Record<string, unknown>>(
        `/payments/${encodeURIComponent(providerChargeId)}/pixQrCode`,
      );
      return {
        encodedImage: String(raw.encodedImage ?? ""),
        payload: String(raw.payload ?? ""),
        expiresAt: raw.expirationDate ? String(raw.expirationDate) : undefined,
      };
    },

    async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
      // Policy first: refuse before spending a network call, and before the gateway can
      // create something we would then have to undo.
      assertCycleAllowedForMethod(input.method, input.cycle);

      if (input.method === "credit_card" && !input.cardToken) {
        throw new Error("[asaas] a credit_card subscription requires a card token");
      }

      const raw = await request<Record<string, unknown>>("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          customer: input.providerCustomerId,
          billingType: METHOD_TO_ASAAS[input.method],
          value: toProviderAmount(input.amountCents),
          cycle: CYCLE_TO_ASAAS[input.cycle],
          nextDueDate: input.nextDueDate,
          description: input.description,
          ...(input.cardToken ? { creditCardToken: input.cardToken } : {}),
          ...(input.externalReference ? { externalReference: input.externalReference } : {}),
        }),
      });

      return {
        providerSubscriptionId: String(raw.id),
        providerCustomerId: String(raw.customer),
        method: METHOD_FROM_ASAAS[String(raw.billingType)] ?? input.method,
        cycle: CYCLE_FROM_ASAAS[String(raw.cycle)] ?? input.cycle,
        amountCents: fromProviderAmount(Number(raw.value)),
        status: SUBSCRIPTION_STATUS_MAP[String(raw.status ?? "")] ?? "unknown",
        nextDueDate: raw.nextDueDate ? String(raw.nextDueDate) : undefined,
        externalReference: raw.externalReference ? String(raw.externalReference) : undefined,
      };
    },
  };
}
