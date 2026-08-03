/**
 * Commercial policy for payment method and billing cycle.
 *
 * PIX has no true automatic recurrence in Brazil: a monthly PIX plan means issuing a fresh
 * charge every month and depending on the customer to pay it again, which is the largest
 * source of involuntary churn. So PIX is sold only on long cycles, where the semester and
 * annual discounts already stored on every plan carry the deal.
 *
 * Decision locked while charting map #1376. The rule lives here, once, so no caller can
 * quietly reimplement a looser version of it.
 */

import type { BillingCycle, PaymentMethod } from "./types.ts";

const ALLOWED_CYCLES: Record<PaymentMethod, readonly BillingCycle[]> = {
  credit_card: ["monthly", "semiannual", "annual"],
  pix: ["semiannual", "annual"],
};

/** Cycles a given method may be sold on. Drives the UI without duplicating the rule. */
export function allowedCyclesFor(method: PaymentMethod): BillingCycle[] {
  return [...ALLOWED_CYCLES[method]];
}

export function isCycleAllowedForMethod(method: PaymentMethod, cycle: BillingCycle): boolean {
  return ALLOWED_CYCLES[method].includes(cycle);
}

/** Throws when the pair is not sellable. Call before any gateway request. */
export function assertCycleAllowedForMethod(method: PaymentMethod, cycle: BillingCycle): void {
  if (!isCycleAllowedForMethod(method, cycle)) {
    throw new Error(
      `[payments] method "${method}" cannot be sold on the "${cycle}" cycle — ` +
        `allowed: ${allowedCyclesFor(method).join(", ")}`,
    );
  }
}
