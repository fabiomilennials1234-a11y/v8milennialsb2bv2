/**
 * Tests for _shared/erp/sync/upsert-nfe.ts — canonical NF-e upsert (módulo E, S7):
 * order/client linkage (best-effort), idempotency. NF is money data — stored
 * even when its order is not synced yet.
 */
import { describe, it, expect } from "vitest";
import {
  upsertCanonicalNfe,
  type NfeStore,
} from "../../supabase/functions/_shared/erp/sync/upsert-nfe";
import type { CanonicalNfe } from "../../supabase/functions/_shared/erp/types";

const NFE: CanonicalNfe = {
  externalId: "987",
  externalRef: null,
  chaveNfe: "35200714200166000187550010000004451234567890",
  numero: "445",
  valor: 2500,
  dataEmissao: null,
  status: "Autorizada",
  orderExternalId: "555",
};

function makeStore(overrides: Partial<NfeStore> = {}) {
  const calls = {
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    creates: [] as Array<Record<string, unknown>>,
  };
  const store: NfeStore = {
    findOrderIdByExternalId: async () => "order-1",
    findClientIdForOrder: async () => "client-1",
    findNfeByExternalId: async () => null,
    updateNfe: async (id, patch) => {
      calls.updates.push({ id, patch });
    },
    createNfe: async (row) => {
      calls.creates.push(row);
      return "nfe-new";
    },
    ...overrides,
  };
  return { store, calls };
}

describe("upsertCanonicalNfe", () => {
  it("creates an NF linked to its order and client", async () => {
    const { store, calls } = makeStore();
    const r = await upsertCanonicalNfe(store, { organizationId: "org1", source: "omie", nfe: NFE });
    expect(r).toEqual({ action: "created", nfeId: "nfe-new" });
    const row = calls.creates[0];
    expect(row.order_id).toBe("order-1");
    expect(row.client_id).toBe("client-1");
    expect(row.external_id).toBe("987");
    expect(row.external_source).toBe("omie");
    expect(row.chave_nfe).toBe(NFE.chaveNfe);
    expect(row.valor).toBe(2500);
    expect(row.status).toBe("Autorizada");
    expect(row.organization_id).toBe("org1");
  });

  it("still stores the NF when its order is not synced (order/client null)", async () => {
    const { store, calls } = makeStore({ findOrderIdByExternalId: async () => null });
    const r = await upsertCanonicalNfe(store, { organizationId: "org1", source: "omie", nfe: NFE });
    expect(r.action).toBe("created");
    expect(calls.creates[0].order_id).toBeNull();
    expect(calls.creates[0].client_id).toBeNull();
  });

  it("updates an existing NF instead of duplicating (idempotent)", async () => {
    const { store, calls } = makeStore({ findNfeByExternalId: async () => ({ id: "n9" }) });
    const r = await upsertCanonicalNfe(store, { organizationId: "org1", source: "omie", nfe: NFE });
    expect(r).toEqual({ action: "updated", nfeId: "n9" });
    expect(calls.creates).toHaveLength(0);
    expect(calls.updates[0].patch.valor).toBe(2500);
    expect(calls.updates[0].patch.status).toBe("Autorizada");
  });
});
