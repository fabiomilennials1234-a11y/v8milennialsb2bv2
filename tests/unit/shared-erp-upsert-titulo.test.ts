/**
 * Tests for _shared/erp/sync/upsert-titulo.ts — canonical Título upsert (módulo E,
 * S8): client/order linkage (best-effort), idempotency. Títulos are money data —
 * stored even when their order/client aren't synced.
 */
import { describe, it, expect } from "vitest";
import {
  upsertCanonicalTitulo,
  type TituloStore,
} from "../../supabase/functions/_shared/erp/sync/upsert-titulo";
import type { CanonicalTitulo } from "../../supabase/functions/_shared/erp/types";

const TITULO: CanonicalTitulo = {
  externalId: "44001",
  externalRef: "tit-ref",
  clientExternalId: "12345",
  orderExternalId: "555",
  valor: 800.5,
  vencimento: null,
  status: "aberto",
  pagoEm: null,
};

function makeStore(overrides: Partial<TituloStore> = {}) {
  const calls = {
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    creates: [] as Array<Record<string, unknown>>,
  };
  const store: TituloStore = {
    findOrderIdByExternalId: async () => "order-1",
    findClientIdByExternalId: async () => "client-1",
    findTituloByExternalId: async () => null,
    updateTitulo: async (id, patch) => {
      calls.updates.push({ id, patch });
    },
    createTitulo: async (row) => {
      calls.creates.push(row);
      return "titulo-new";
    },
    ...overrides,
  };
  return { store, calls };
}

describe("upsertCanonicalTitulo", () => {
  it("creates a título linked to its client and order", async () => {
    const { store, calls } = makeStore();
    const r = await upsertCanonicalTitulo(store, {
      organizationId: "org1",
      source: "omie",
      titulo: TITULO,
    });
    expect(r).toEqual({ action: "created", tituloId: "titulo-new" });
    const row = calls.creates[0];
    expect(row.client_id).toBe("client-1");
    expect(row.order_id).toBe("order-1");
    expect(row.status).toBe("aberto");
    expect(row.valor).toBe(800.5);
    expect(row.external_id).toBe("44001");
    expect(row.external_source).toBe("omie");
    expect(row.organization_id).toBe("org1");
  });

  it("still stores the título when client/order are not synced", async () => {
    const { store, calls } = makeStore({
      findOrderIdByExternalId: async () => null,
      findClientIdByExternalId: async () => null,
    });
    const r = await upsertCanonicalTitulo(store, {
      organizationId: "org1",
      source: "omie",
      titulo: TITULO,
    });
    expect(r.action).toBe("created");
    expect(calls.creates[0].client_id).toBeNull();
    expect(calls.creates[0].order_id).toBeNull();
  });

  it("updates an existing título instead of duplicating (idempotent)", async () => {
    const { store, calls } = makeStore({ findTituloByExternalId: async () => ({ id: "t9" }) });
    const r = await upsertCanonicalTitulo(store, {
      organizationId: "org1",
      source: "omie",
      titulo: { ...TITULO, status: "pago" },
    });
    expect(r).toEqual({ action: "updated", tituloId: "t9" });
    expect(calls.creates).toHaveLength(0);
    expect(calls.updates[0].patch.status).toBe("pago");
  });
});
