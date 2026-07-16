/**
 * Tests for _shared/erp/sync/upsert-product.ts — canonical Product upsert (módulo
 * E, S12): external-id/SKU match, sync modes, import-on-unmatched, idempotency.
 * Simpler than client — no lead resolution.
 */
import { describe, it, expect } from "vitest";
import {
  upsertCanonicalProduct,
  type ProductStore,
  type ExistingProduct,
} from "../../supabase/functions/_shared/erp/sync/upsert-product";
import type { CanonicalProduct } from "../../supabase/functions/_shared/erp/types";

const PRODUCT: CanonicalProduct = {
  externalId: "700",
  externalRef: "prod-ref",
  sku: "SKU-9",
  name: "Parafuso Sextavado",
  ticket: 3.5,
  baseUnit: "UN",
  description: "Aço inox",
  isActive: true,
};

function makeStore(overrides: Partial<ProductStore> = {}) {
  const calls = {
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    creates: [] as Array<Record<string, unknown>>,
  };
  const store: ProductStore = {
    findByExternalId: async () => null,
    findBySku: async () => null,
    update: async (id, patch) => {
      calls.updates.push({ id, patch });
    },
    create: async (row) => {
      calls.creates.push(row);
      return "prod-new";
    },
    ...overrides,
  };
  return { store, calls };
}

describe("upsertCanonicalProduct", () => {
  it("skips entirely in mode off", async () => {
    const { store, calls } = makeStore();
    const r = await upsertCanonicalProduct(store, {
      organizationId: "org1",
      source: "omie",
      product: PRODUCT,
      syncMode: "off",
    });
    expect(r.action).toBe("skipped");
    expect(calls.creates).toHaveLength(0);
  });

  it("enrich_only fills only empty fields, never the curated name/ticket", async () => {
    const existing: ExistingProduct = {
      id: "p1",
      name: "Nome Curado",
      ticket: 99,
      sku: "SKU-9",
      base_unit: null,
      description: null,
    };
    const { store, calls } = makeStore({ findByExternalId: async () => existing });
    const r = await upsertCanonicalProduct(store, {
      organizationId: "org1",
      source: "omie",
      product: PRODUCT,
      syncMode: "enrich_only",
    });
    expect(r).toEqual({ action: "enriched", productId: "p1" });
    const patch = calls.updates[0].patch;
    expect(patch.name).toBeUndefined(); // curated — untouched
    expect(patch.ticket).toBeUndefined();
    expect(patch.base_unit).toBe("UN"); // was null → filled
    expect(patch.external_id).toBe("700");
    expect(patch.external_source).toBe("omie");
  });

  it("canonical overwrites name and ticket on a matched product", async () => {
    const existing: ExistingProduct = {
      id: "p1",
      name: "Old",
      ticket: 1,
      sku: "SKU-9",
      base_unit: "x",
      description: "x",
    };
    const { store, calls } = makeStore({ findByExternalId: async () => existing });
    const r = await upsertCanonicalProduct(store, {
      organizationId: "org1",
      source: "omie",
      product: PRODUCT,
      syncMode: "canonical",
    });
    expect(r.action).toBe("enriched");
    expect(calls.updates[0].patch.name).toBe("Parafuso Sextavado");
    expect(calls.updates[0].patch.ticket).toBe(3.5);
  });

  it("imports (creates) an unmatched product", async () => {
    const { store, calls } = makeStore(); // finds nothing
    const r = await upsertCanonicalProduct(store, {
      organizationId: "org1",
      source: "omie",
      product: PRODUCT,
      syncMode: "enrich_only",
    });
    expect(r).toEqual({ action: "created", productId: "prod-new" });
    const row = calls.creates[0];
    expect(row.organization_id).toBe("org1");
    expect(row.name).toBe("Parafuso Sextavado");
    expect(row.type).toBe("unitario");
    expect(row.external_id).toBe("700");
    expect(row.external_source).toBe("omie");
    expect(row.is_active).toBe(true);
  });

  it("adopts the external id onto a SKU-matched product", async () => {
    const bySku: ExistingProduct = {
      id: "p9",
      name: "x",
      ticket: 1,
      sku: "SKU-9",
      base_unit: "x",
      description: "x",
    };
    const { store, calls } = makeStore({
      findByExternalId: async () => null,
      findBySku: async () => bySku,
    });
    const r = await upsertCanonicalProduct(store, {
      organizationId: "org1",
      source: "omie",
      product: PRODUCT,
      syncMode: "enrich_only",
    });
    expect(r).toEqual({ action: "enriched", productId: "p9" });
    expect(calls.updates[0].patch.external_id).toBe("700");
  });
});
