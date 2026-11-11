/**
 * O único arquivo que importa o SDK da Stripe. Tudo acima dele recebe a interface
 * `StripeGateway`, que é o seam de teste.
 *
 * Segredos: a chave nunca sai daqui; erro para log passa por `stripeErrorInfo`, que
 * devolve só type, code e requestId. `message` da Stripe pode ecoar dado do comprador.
 */

import Stripe from "npm:stripe@23.1.0";
import { projectSubscription, type StripeEventLike, type SubscriptionView } from "./events.ts";
import type { StripeItem } from "./items.ts";

/** A versão que o SDK 23.1.0 fixa (cjs/apiVersion.js). Confirmada em modo teste na F0. */
export const STRIPE_API_VERSION = "2026-10-28.endive";

/** Tolerância da assinatura do webhook, em segundos. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface PriceView {
  id: string;
  lookup_key: string | null;
  unit_amount: number | null;
}

export interface CreateCustomerParams {
  name: string;
  email: string;
  taxId: { type: "br_cnpj" | "br_cpf"; value: string };
  metadata: Record<string, string>;
}

export interface CreateSubscriptionParams {
  customer: string;
  items: StripeItem[];
  metadata: Record<string, string>;
}

export interface StripeGateway {
  listPricesByLookupKeys(keys: string[]): Promise<PriceView[]>;
  createCustomer(params: CreateCustomerParams, idempotencyKey: string): Promise<string>;
  updateCustomer(id: string, params: { name: string; email: string }): Promise<void>;
  listCustomerTaxIds(id: string): Promise<{ id: string; value: string }[]>;
  createCustomerTaxId(id: string, taxId: { type: "br_cnpj" | "br_cpf"; value: string }): Promise<string>;
  deleteCustomerTaxId(customerId: string, taxIdId: string): Promise<void>;
  createSubscription(params: CreateSubscriptionParams, idempotencyKey: string): Promise<SubscriptionView>;
  retrieveSubscription(id: string): Promise<SubscriptionView>;
  updateSubscriptionMetadata(id: string, metadata: Record<string, string>): Promise<void>;
  cancelSubscription(id: string): Promise<void>;
  /**
   * Anula a fatura aberta. É a trava contra cobrança dupla: a Stripe só anula o que não foi
   * pago, de forma atômica, e o PaymentIntent dela deixa de aceitar confirmação. "paid" diz
   * que a corrida foi perdida para quem pagou.
   */
  voidInvoice(id: string): Promise<"voided" | "paid">;
  deleteCustomer(id: string): Promise<void>;
}

export function createStripeSdk(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
}

const EXPAND_SECRET = ["latest_invoice.confirmation_secret"];

export function createStripeGateway(secretKey: string): StripeGateway {
  const sdk = createStripeSdk(secretKey);

  return {
    async listPricesByLookupKeys(keys) {
      const page = await sdk.prices.list({ lookup_keys: keys, active: true, limit: 10 });
      return page.data.map((p) => ({ id: p.id, lookup_key: p.lookup_key, unit_amount: p.unit_amount }));
    },

    async createCustomer(params, idempotencyKey) {
      const c = await sdk.customers.create(
        {
          name: params.name,
          email: params.email,
          tax_id_data: [params.taxId],
          metadata: params.metadata,
        },
        { idempotencyKey },
      );
      return c.id;
    },

    async updateCustomer(id, params) {
      await sdk.customers.update(id, params);
    },

    async listCustomerTaxIds(id) {
      const page = await sdk.customers.listTaxIds(id, { limit: 10 });
      return page.data.map((t) => ({ id: t.id, value: t.value }));
    },

    async createCustomerTaxId(id, taxId) {
      return (await sdk.customers.createTaxId(id, taxId)).id;
    },

    async deleteCustomerTaxId(customerId, taxIdId) {
      await sdk.customers.deleteTaxId(customerId, taxIdId);
    },

    async createSubscription(params, idempotencyKey) {
      const sub = await sdk.subscriptions.create(
        {
          customer: params.customer,
          items: params.items as Stripe.SubscriptionCreateParams.Item[],
          metadata: params.metadata,
          billing_mode: { type: "flexible" },
          payment_behavior: "default_incomplete",
          payment_settings: {
            save_default_payment_method: "on_subscription",
            payment_method_types: ["card"],
          },
          expand: EXPAND_SECRET,
        },
        { idempotencyKey },
      );
      return projectSubscription(sub);
    },

    async retrieveSubscription(id) {
      return projectSubscription(await sdk.subscriptions.retrieve(id, { expand: EXPAND_SECRET }));
    },

    async updateSubscriptionMetadata(id, metadata) {
      await sdk.subscriptions.update(id, { metadata });
    },

    async cancelSubscription(id) {
      try {
        await sdk.subscriptions.cancel(id);
      } catch (err) {
        // Outra aba acabou de cancelar a mesma assinatura: o estado desejado já vale.
        if ((err as { code?: string }).code !== "resource_missing") throw err;
      }
    },

    async voidInvoice(id) {
      try {
        await sdk.invoices.voidInvoice(id);
        return "voided";
      } catch (err) {
        const invoice = await sdk.invoices.retrieve(id);
        if (invoice.status === "paid") return "paid";
        if (invoice.status === "void") return "voided";
        throw err;
      }
    },

    async deleteCustomer(id) {
      await sdk.customers.del(id);
    },
  };
}

/** Lança em assinatura inválida ou fora da tolerância. Exige o corpo CRU. */
export async function verifyStripeWebhook(
  sdk: Stripe,
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<StripeEventLike> {
  const event = await sdk.webhooks.constructEventAsync(
    rawBody,
    signature,
    webhookSecret,
    WEBHOOK_TOLERANCE_SECONDS,
    Stripe.createSubtleCryptoProvider(),
  );
  return event as unknown as StripeEventLike;
}

/** O que pode ir para log de um erro da Stripe. `message` fica de fora de propósito. */
export function stripeErrorInfo(err: unknown): { type: string; code: string | null; requestId: string | null; status: number | null } {
  const e = (err ?? {}) as Record<string, unknown>;
  return {
    type: typeof e.type === "string" ? e.type : "unknown",
    code: typeof e.code === "string" ? e.code : null,
    requestId: typeof e.requestId === "string" ? e.requestId : null,
    status: typeof e.statusCode === "number" ? e.statusCode : null,
  };
}
