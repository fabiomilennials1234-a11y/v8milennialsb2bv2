/**
 * upsertCanonicalNfe — canonical NF-e reconciliation (módulo E, S7, ADR-0020).
 *
 * Pure logic over an NfeStore port. NF is money data sourced from the ERP, so it
 * is stored even when its order isn't synced yet (order_id/client_id best-effort).
 * Idempotent on (org, source, external_id).
 */

import { CanonicalNfe } from "../types.ts";

export interface NfeStore {
  findOrderIdByExternalId(
    organizationId: string,
    source: string,
    orderExternalId: string,
  ): Promise<string | null>;
  findClientIdForOrder(orderId: string): Promise<string | null>;
  findNfeByExternalId(
    organizationId: string,
    source: string,
    externalId: string,
  ): Promise<{ id: string } | null>;
  updateNfe(id: string, patch: Record<string, unknown>): Promise<void>;
  createNfe(row: Record<string, unknown>): Promise<string>;
}

export interface UpsertNfeParams {
  organizationId: string;
  source: string;
  nfe: CanonicalNfe;
}

export type UpsertNfeResult =
  | { action: "skipped"; reason: string }
  | { action: "updated"; nfeId: string }
  | { action: "created"; nfeId: string };

export async function upsertCanonicalNfe(
  store: NfeStore,
  params: UpsertNfeParams,
): Promise<UpsertNfeResult> {
  const { organizationId, source, nfe } = params;
  if (!nfe.externalId) return { action: "skipped", reason: "no_external_id" };

  const orderId = nfe.orderExternalId
    ? await store.findOrderIdByExternalId(organizationId, source, nfe.orderExternalId)
    : null;
  const clientId = orderId ? await store.findClientIdForOrder(orderId) : null;

  const fields = {
    external_source: source,
    external_id: nfe.externalId,
    external_ref: nfe.externalRef,
    order_id: orderId,
    client_id: clientId,
    chave_nfe: nfe.chaveNfe,
    numero: nfe.numero,
    valor: nfe.valor,
    data_emissao: nfe.dataEmissao,
    status: nfe.status,
  };

  const existing = await store.findNfeByExternalId(organizationId, source, nfe.externalId);
  if (existing) {
    await store.updateNfe(existing.id, fields);
    return { action: "updated", nfeId: existing.id };
  }

  const nfeId = await store.createNfe({ organization_id: organizationId, ...fields });
  return { action: "created", nfeId };
}
