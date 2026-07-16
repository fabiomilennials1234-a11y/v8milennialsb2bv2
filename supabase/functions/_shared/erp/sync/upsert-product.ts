/**
 * upsertCanonicalProduct — canonical Product reconciliation (módulo E, S12,
 * ADR-0020). Pure logic over a ProductStore port. Simpler than client: no lead
 * resolution, and unmatched products are IMPORTED (created) since the ERP
 * catalog is the point. Idempotent on (org, source, external_id); adopts the
 * external id onto a SKU-matched row.
 */

import { CanonicalProduct } from "../types.ts";
import { ErpSyncMode } from "./upsert-client.ts";

export interface ExistingProduct {
  id: string;
  name: string | null;
  ticket: number | null;
  sku: string | null;
  base_unit: string | null;
  description: string | null;
}

export interface ProductStore {
  findByExternalId(
    organizationId: string,
    source: string,
    externalId: string,
  ): Promise<ExistingProduct | null>;
  findBySku(organizationId: string, sku: string): Promise<ExistingProduct | null>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  create(row: Record<string, unknown>): Promise<string>;
}

export interface UpsertProductParams {
  organizationId: string;
  source: string;
  product: CanonicalProduct;
  syncMode: ErpSyncMode;
}

export type UpsertProductResult =
  | { action: "skipped"; reason: string }
  | { action: "enriched"; productId: string }
  | { action: "created"; productId: string };

export async function upsertCanonicalProduct(
  store: ProductStore,
  params: UpsertProductParams,
): Promise<UpsertProductResult> {
  const { organizationId, source, product, syncMode } = params;
  if (syncMode === "off") return { action: "skipped", reason: "mode_off" };
  if (!product.externalId) return { action: "skipped", reason: "no_external_id" };

  const existing =
    (await store.findByExternalId(organizationId, source, product.externalId)) ??
    (product.sku ? await store.findBySku(organizationId, product.sku) : null);

  const stamp = {
    external_source: source,
    external_id: product.externalId,
    external_ref: product.externalRef,
  };

  if (existing) {
    const patch: Record<string, unknown> = { ...stamp };
    if (syncMode === "canonical") {
      patch.name = product.name;
      patch.ticket = product.ticket;
      patch.sku = product.sku;
      patch.base_unit = product.baseUnit;
      patch.description = product.description;
      patch.is_active = product.isActive;
    } else {
      // enrich_only: fill only empty fields; never clobber curated name/ticket.
      if (!existing.name) patch.name = product.name;
      if (existing.ticket == null && product.ticket != null) patch.ticket = product.ticket;
      if (!existing.sku && product.sku) patch.sku = product.sku;
      if (!existing.base_unit && product.baseUnit) patch.base_unit = product.baseUnit;
      if (!existing.description && product.description) patch.description = product.description;
    }
    await store.update(existing.id, patch);
    return { action: "enriched", productId: existing.id };
  }

  const productId = await store.create({
    organization_id: organizationId,
    name: product.name,
    type: "unitario",
    sku: product.sku,
    ticket: product.ticket,
    base_unit: product.baseUnit,
    description: product.description,
    is_active: product.isActive,
    ...stamp,
  });
  return { action: "created", productId };
}
