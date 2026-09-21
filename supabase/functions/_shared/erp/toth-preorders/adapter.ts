import type { TothPreorderAdapter } from "./contracts.ts";

/**
 * Production has no verified supplier contract. This factory deliberately has
 * no URL, token, fetch, raw-status mapping or environment-based escape hatch.
 * A future verified adapter requires a separate implementation and homologation.
 */
export function createUnavailableTothPreorderAdapter(): TothPreorderAdapter {
  return {
    can_create: false,
    can_lookup: false,
    async create() {
      return { unavailable: true, reason_code: "supplier_contract_unverified" };
    },
    async lookup() {
      return { unavailable: true, reason_code: "supplier_contract_unverified" };
    },
  };
}
