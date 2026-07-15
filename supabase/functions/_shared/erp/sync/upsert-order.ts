/**
 * upsertCanonicalOrder — canonical order reconciliation (módulo E, ADR-0020).
 *
 * Pure logic over an OrderStore port. An ERP order attaches to an already-synced
 * Carteira Client (resolved by the order's client external id); if the client is
 * not synced yet it is skipped (clientes sync runs first). Orders land as
 * source='erp' and approval_status='approved' so they count in Carteira metrics
 * (see the carteira "venda manual auto-aprovada" gotcha). Idempotent on
 * (org, source, external_id).
 */

import { CanonicalOrder } from "../types.ts";

export interface OrderStore {
  findClientIdByExternalId(
    organizationId: string,
    source: string,
    clientExternalId: string,
  ): Promise<string | null>;
  findOrderByExternalId(
    organizationId: string,
    source: string,
    externalId: string,
  ): Promise<{ id: string } | null>;
  updateOrder(id: string, patch: Record<string, unknown>): Promise<void>;
  createOrder(row: Record<string, unknown>): Promise<string>;
}

export interface UpsertOrderParams {
  organizationId: string;
  source: string;
  order: CanonicalOrder;
}

export type UpsertOrderResult =
  | { action: "skipped"; reason: string }
  | { action: "updated"; orderId: string }
  | { action: "created"; orderId: string };

export async function upsertCanonicalOrder(
  store: OrderStore,
  params: UpsertOrderParams,
): Promise<UpsertOrderResult> {
  const { organizationId, source, order } = params;

  if (!order.externalId) return { action: "skipped", reason: "no_external_id" };
  // sale_value has a CHECK (> 0); a zero/negative order is a quote, not a sale.
  if (!(order.saleValue > 0)) return { action: "skipped", reason: "zero_value" };

  const clientId = await store.findClientIdByExternalId(
    organizationId,
    source,
    order.clientExternalId,
  );
  if (!clientId) return { action: "skipped", reason: "client_not_synced" };

  const stamp = {
    external_source: source,
    external_id: order.externalId,
    external_ref: order.externalRef,
  };

  const existing = await store.findOrderByExternalId(organizationId, source, order.externalId);
  if (existing) {
    await store.updateOrder(existing.id, {
      ...stamp,
      sale_value: order.saleValue,
      product_name: order.productName,
    });
    return { action: "updated", orderId: existing.id };
  }

  const row: Record<string, unknown> = {
    organization_id: organizationId,
    client_id: clientId,
    product_name: order.productName,
    product_type: "unitario",
    sale_value: order.saleValue,
    origin: "upsell",
    source: "erp",
    approval_status: "approved",
    ...stamp,
  };
  if (order.soldAt) row.sold_at = order.soldAt;

  const orderId = await store.createOrder(row);
  return { action: "created", orderId };
}
