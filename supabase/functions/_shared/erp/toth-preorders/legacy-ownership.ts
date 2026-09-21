import type { UpsertOrderResult } from "../sync/upsert-order.ts";
import { TOTH_PREORDER_PILOT_ID, type TothPreorderRpcClient } from "./rpc-client.ts";

export interface TothPreorderOwnershipGuard {
  isOwned(externalId: string, fresh?: boolean): Promise<boolean>;
}

/**
 * Per-sync cache only. A missing migration leaves the old reader operational;
 * deployed-schema errors fail closed. SQL independently serializes binding and
 * legacy inserts, so a cached negative cannot bypass ownership in a race.
 */
export function createTothPreorderOwnershipGuard(
  client: TothPreorderRpcClient,
  organizationId: string,
): TothPreorderOwnershipGuard {
  let schemaUnavailable = false;
  const cache = new Map<string, boolean>();
  return {
    async isOwned(externalId, fresh = false) {
      if (organizationId !== TOTH_PREORDER_PILOT_ID || !externalId) return false;
      if (schemaUnavailable && !fresh) return false;
      if (!fresh && cache.has(externalId)) return cache.get(externalId)!;
      let reply: Awaited<ReturnType<TothPreorderRpcClient["rpc"]>>;
      try {
        reply = await client.rpc("toth_find_owned_preorder", {
          p_organization_id: organizationId,
          p_external_id: externalId,
        });
      } catch {
        throw new Error("toth_preorder_ownership_unverified");
      }
      const { data, error } = reply;
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") {
          schemaUnavailable = true;
          return false;
        }
        throw new Error("toth_preorder_ownership_unverified");
      }
      schemaUnavailable = false;
      if (data === null) {
        cache.set(externalId, false);
        return false;
      }
      if (typeof data !== "object" || Array.isArray(data)) {
        throw new Error("toth_preorder_ownership_unverified");
      }
      const owner = data as Record<string, unknown>;
      if (typeof owner.id !== "string" || !owner.id || typeof owner.deal_id !== "string"
        || !owner.deal_id || owner.organization_id !== organizationId || owner.external_id !== externalId) {
        throw new Error("toth_preorder_ownership_unverified");
      }
      cache.set(externalId, true);
      return true;
    },
  };
}

/** Owned records use authoritative preorder lookup, never the permissive legacy status mapper. */
export async function importTothOrderUnlessOwned(
  guard: TothPreorderOwnershipGuard,
  externalId: string,
  importOrder: () => Promise<UpsertOrderResult>,
): Promise<UpsertOrderResult> {
  const skipped = { action: "skipped", reason: "owned_preorder" } as const;
  if (await guard.isOwned(externalId)) return skipped;
  try {
    return await importOrder();
  } catch (error) {
    // Binding may have happened after the preflight. Only suppress the exact
    // new SQL guard refusal AND a fresh matching ownership confirmation.
    if (error instanceof Error && /\btoth_preorder_owned_external_id\b/.test(error.message)
      && await guard.isOwned(externalId, true)) return skipped;
    throw error;
  }
}
