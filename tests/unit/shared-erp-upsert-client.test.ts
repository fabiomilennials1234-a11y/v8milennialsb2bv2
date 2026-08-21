/**
 * Tests for _shared/erp/sync/upsert-client.ts — canonical client upsert logic
 * (módulo E): sync modes, CNPJ match, lead resolution, idempotency.
 *
 * Uses a fake ClientStore port so the logic is tested without a database. The
 * supabase-backed store is a thin adapter exercised end-to-end by the edge fn.
 */
import { describe, it, expect } from "vitest";
import {
  upsertCanonicalClient,
  type ClientStore,
  type ExistingClient,
} from "../../supabase/functions/_shared/erp/sync/upsert-client";
import type { CanonicalClient } from "../../supabase/functions/_shared/erp/types";

const CLIENT: CanonicalClient = {
  externalId: "12345",
  externalRef: "ref-1",
  cnpj: "12345678000199",
  name: "Acme",
  company: "Acme Distribuidora LTDA",
  email: "compras@acme.com",
  phone: "4799990000",
};

function makeStore(overrides: Partial<ClientStore> = {}) {
  const calls = {
    enrich: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    createdLeads: [] as Array<Record<string, unknown>>,
    createdClients: [] as Array<Record<string, unknown>>,
  };
  const store: ClientStore = {
    findByExternalId: async () => null,
    findByCnpj: async () => null,
    enrich: async (id, patch) => {
      calls.enrich.push({ id, patch });
    },
    createLead: async (_org, lead) => {
      calls.createdLeads.push(lead);
      return "lead-new";
    },
    createClient: async (row) => {
      calls.createdClients.push(row);
      return "client-new";
    },
    ...overrides,
  };
  return { store, calls };
}

describe("upsertCanonicalClient — não escreve quando nada muda", () => {
  /** Cliente já gravado exatamente como o ERP o devolveria. */
  const identico: ExistingClient = {
    id: "c-1",
    cnpj: CLIENT.cnpj,
    phone: CLIENT.phone,
    email: CLIENT.email,
    company: CLIENT.company,
    name: CLIENT.name,
    external_source: "toth",
    external_id: CLIENT.externalId,
    external_ref: CLIENT.externalRef,
  };

  function storeIdentico() {
    const escritas: Array<Record<string, unknown>> = [];
    const store: ClientStore = {
      findByExternalId: () => Promise.resolve(identico),
      findByCnpj: () => Promise.resolve(identico),
      enrich: (_id, patch) => {
        escritas.push(patch);
        return Promise.resolve();
      },
      createLead: () => Promise.resolve("l-1"),
      createClient: () => Promise.resolve("c-1"),
    };
    return { store, escritas };
  }

  it("🔴 re-sincronizar não gera UPDATE — foi o que estourou os 150s", async () => {
    // Na 2ª execução da carga, 12.608 clientes já existentes viraram 12.608
    // updates idênticos e a função morreu com HTTP 504. Cada update ainda
    // dispara auditoria e evento de Realtime.
    const { store, escritas } = storeIdentico();
    const r = await upsertCanonicalClient(store, {
      organizationId: "org-1",
      source: "toth",
      client: CLIENT,
      syncMode: "canonical",
    });

    expect(r).toEqual({ action: "skipped", reason: "no_changes" });
    expect(escritas).toHaveLength(0);
  });

  it("escreve só o campo que mudou", async () => {
    const { store, escritas } = storeIdentico();
    const r = await upsertCanonicalClient(store, {
      organizationId: "org-1",
      source: "toth",
      client: { ...CLIENT, email: "novo@acme.com" },
      syncMode: "canonical",
    });

    expect(r.action).toBe("enriched");
    expect(escritas).toEqual([{ email: "novo@acme.com" }]);
  });

  it("sem external_* no existente, o comportamento antigo continua: escreve", async () => {
    // Chamador que não informa a identidade externa não pode ser penalizado
    // com um "pulo" incorreto.
    const { store, escritas } = storeIdentico();
    const semStamp: ClientStore = {
      ...store,
      findByExternalId: () =>
        Promise.resolve({ ...identico, external_source: undefined, external_id: undefined, external_ref: undefined }),
    };
    const r = await upsertCanonicalClient(semStamp, {
      organizationId: "org-1",
      source: "toth",
      client: CLIENT,
      syncMode: "canonical",
    });

    expect(r.action).toBe("enriched");
    expect(escritas).toHaveLength(1);
  });
});

describe("upsertCanonicalClient — mode off", () => {
  it("skips entirely, writing nothing", async () => {
    const { store, calls } = makeStore();
    const r = await upsertCanonicalClient(store, {
      organizationId: "org1",
      source: "omie",
      client: CLIENT,
      syncMode: "off",
    });
    expect(r.action).toBe("skipped");
    expect(calls.enrich).toHaveLength(0);
    expect(calls.createdClients).toHaveLength(0);
    expect(calls.createdLeads).toHaveLength(0);
  });
});

describe("upsertCanonicalClient — enrich_only", () => {
  it("fills only empty fields and never touches the curated name", async () => {
    const existing: ExistingClient = {
      id: "c1",
      cnpj: null,
      phone: null,
      email: "old@acme.com",
      company: null,
      name: "Nome Curado",
    };
    const { store, calls } = makeStore({ findByExternalId: async () => existing });

    const r = await upsertCanonicalClient(store, {
      organizationId: "org1",
      source: "omie",
      client: CLIENT,
      syncMode: "enrich_only",
    });

    expect(r).toEqual({ action: "enriched", clientId: "c1" });
    const patch = calls.enrich[0].patch;
    expect(patch.cnpj).toBe("12345678000199"); // was null → filled
    expect(patch.phone).toBe("4799990000"); // was null → filled
    expect(patch.email).toBeUndefined(); // had value → left alone
    expect(patch.name).toBeUndefined(); // curated name never touched
    expect(patch.external_source).toBe("omie");
    expect(patch.external_id).toBe("12345");
    expect(patch.external_ref).toBe("ref-1");
    expect(calls.createdClients).toHaveLength(0);
  });

  it("skips an unmatched client without creating anything", async () => {
    const { store, calls } = makeStore(); // finds nothing
    const r = await upsertCanonicalClient(store, {
      organizationId: "org1",
      source: "omie",
      client: CLIENT,
      syncMode: "enrich_only",
    });
    expect(r).toEqual({ action: "skipped", reason: "unmatched" });
    expect(calls.createdClients).toHaveLength(0);
    expect(calls.createdLeads).toHaveLength(0);
  });

  it("adopts the external id onto a CNPJ-matched row (idempotent identity)", async () => {
    const byCnpj: ExistingClient = {
      id: "c9",
      cnpj: "12345678000199",
      phone: "x",
      email: "x",
      company: "x",
      name: "x",
    };
    const { store, calls } = makeStore({
      findByExternalId: async () => null,
      findByCnpj: async () => byCnpj,
    });
    const r = await upsertCanonicalClient(store, {
      organizationId: "org1",
      source: "omie",
      client: CLIENT,
      syncMode: "enrich_only",
    });
    expect(r).toEqual({ action: "enriched", clientId: "c9" });
    expect(calls.enrich[0].patch.external_id).toBe("12345");
  });
});

describe("upsertCanonicalClient — canonical", () => {
  it("overwrites client fields on a matched row", async () => {
    const existing: ExistingClient = {
      id: "c1",
      cnpj: "old",
      phone: "old",
      email: "old",
      company: "old",
      name: "Old",
    };
    const { store, calls } = makeStore({ findByExternalId: async () => existing });
    const r = await upsertCanonicalClient(store, {
      organizationId: "org1",
      source: "omie",
      client: CLIENT,
      syncMode: "canonical",
    });
    expect(r.action).toBe("enriched");
    const patch = calls.enrich[0].patch;
    expect(patch.name).toBe("Acme");
    expect(patch.company).toBe("Acme Distribuidora LTDA");
    expect(patch.email).toBe("compras@acme.com");
  });

  it("creates a stub lead then the client when unmatched", async () => {
    const { store, calls } = makeStore(); // finds nothing
    const r = await upsertCanonicalClient(store, {
      organizationId: "org1",
      source: "omie",
      client: CLIENT,
      syncMode: "canonical",
    });
    expect(r).toEqual({ action: "created", clientId: "client-new" });
    expect(calls.createdLeads).toHaveLength(1);
    expect(calls.createdLeads[0].name).toBe("Acme");
    expect(calls.createdClients).toHaveLength(1);
    const row = calls.createdClients[0];
    expect(row.lead_id).toBe("lead-new"); // never null
    expect(row.external_source).toBe("omie");
    expect(row.external_id).toBe("12345");
    expect(row.organization_id).toBe("org1");
  });
});
