/**
 * upsertCanonicalTitulo — canonical Título / conta a receber reconciliation
 * (módulo E, S8, ADR-0020). Pure logic over a TituloStore port. Money data —
 * stored even when its client/order aren't synced. Idempotent on
 * (org, source, external_id).
 */

import { CanonicalTitulo } from "../types.ts";

export interface TituloStore {
  findOrderIdByExternalId(
    organizationId: string,
    source: string,
    orderExternalId: string,
  ): Promise<string | null>;
  findClientIdByExternalId(
    organizationId: string,
    source: string,
    clientExternalId: string,
  ): Promise<string | null>;
  findTituloByExternalId(
    organizationId: string,
    source: string,
    externalId: string,
  ): Promise<{ id: string } | null>;
  updateTitulo(id: string, patch: Record<string, unknown>): Promise<void>;
  createTitulo(row: Record<string, unknown>): Promise<string>;
}

export interface UpsertTituloParams {
  organizationId: string;
  source: string;
  titulo: CanonicalTitulo;
}

export type UpsertTituloResult =
  | { action: "skipped"; reason: string }
  | { action: "updated"; tituloId: string }
  | { action: "created"; tituloId: string };

export async function upsertCanonicalTitulo(
  store: TituloStore,
  params: UpsertTituloParams,
): Promise<UpsertTituloResult> {
  const { organizationId, source, titulo } = params;
  if (!titulo.externalId) return { action: "skipped", reason: "no_external_id" };

  const orderId = titulo.orderExternalId
    ? await store.findOrderIdByExternalId(organizationId, source, titulo.orderExternalId)
    : null;
  const clientId = titulo.clientExternalId
    ? await store.findClientIdByExternalId(organizationId, source, titulo.clientExternalId)
    : null;

  const fields = {
    external_source: source,
    external_id: titulo.externalId,
    external_ref: titulo.externalRef,
    order_id: orderId,
    client_id: clientId,
    valor: titulo.valor,
    vencimento: titulo.vencimento,
    status: titulo.status,
    pago_em: titulo.pagoEm,
  };

  const existing = await store.findTituloByExternalId(organizationId, source, titulo.externalId);
  if (existing) {
    await store.updateTitulo(existing.id, fields);
    return { action: "updated", tituloId: existing.id };
  }

  const tituloId = await store.createTitulo({ organization_id: organizationId, ...fields });
  return { action: "created", tituloId };
}
