/**
 * Money conversion at the provider boundary.
 *
 * The domain carries integer cents. Gateways speak decimal reais. Every float that survives
 * into a charge is a rounding bug that bills the wrong value, so the conversion lives in one
 * place and is tested against IEEE 754 drift.
 */

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`[money] ${label} must be a finite number, got ${value}`);
  }
}

/** Integer cents to the decimal reais a gateway expects. */
export function toProviderAmount(cents: number): number {
  assertFinite(cents, "amount in cents");
  if (!Number.isInteger(cents)) {
    throw new Error(`[money] amount must be an integer number of cents, got ${cents}`);
  }
  if (cents < 0) {
    throw new Error(`[money] amount must not be negative, got ${cents}`);
  }
  return cents / 100;
}

/**
 * Decimal reais from a gateway back to integer cents.
 *
 * Rounds rather than truncates: `3 * 0.29` is `0.8699999999999999` in IEEE 754, and truncation
 * would turn 87 cents into 86.
 */
export function fromProviderAmount(amount: number): number {
  assertFinite(amount, "amount in reais");
  return Math.round(amount * 100);
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Human-facing rendering, for descriptions and logs. Never for arithmetic. */
export function formatCentsBRL(cents: number): string {
  return BRL.format(toProviderAmount(cents));
}
