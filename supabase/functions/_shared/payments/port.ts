/**
 * The payment port.
 *
 * Everything the checkout, the webhook and the billing area need from a gateway, expressed in
 * domain vocabulary. Same shape as the provider-neutral seams already used in this codebase
 * for WhatsApp and the ERP integration.
 *
 * Adding a second gateway means writing another implementation of this interface — not
 * touching a single caller.
 */

import type {
  Charge,
  CreateChargeInput,
  CreateSubscriptionInput,
  CustomerInput,
  PixPayload,
  ProviderCustomer,
  Subscription,
} from "./types.ts";

export interface PaymentProvider {
  /** Name of the concrete gateway, for logs and for the audit trail. */
  readonly name: string;

  /**
   * Find the customer by tax id, creating it only when absent.
   *
   * Idempotent by construction: paying twice, or a webhook arriving twice, must never produce
   * two customers for the same document.
   */
  ensureCustomer(input: CustomerInput): Promise<ProviderCustomer>;

  /** One-off charge — the first payment of a link. */
  createCharge(input: CreateChargeInput): Promise<Charge>;

  /** Current state of a charge, for reconciliation and for polling fallbacks. */
  getCharge(providerChargeId: string): Promise<Charge>;

  /** QR code and copy-and-paste string for a PIX charge. */
  getPixPayload(providerChargeId: string): Promise<PixPayload>;

  /** Recurring subscription. Rejects method/cycle pairs that policy forbids. */
  createSubscription(input: CreateSubscriptionInput): Promise<Subscription>;
}
