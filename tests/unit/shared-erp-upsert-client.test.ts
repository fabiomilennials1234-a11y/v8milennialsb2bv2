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
import {
  planLeadPhoneOps,
  type ExistingLeadPhone,
} from "../../supabase/functions/_shared/erp/sync/lead-phones-sync";

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

  it("🔴 enriquecimento idêntico também não gera UPDATE, JSONB incluído", async () => {
    // `erp_metadata` é objeto: `a !== b` entre dois objetos é SEMPRE verdadeiro.
    // Sem comparação por valor, cada cliente voltaria a ser reescrito em toda
    // execução — o mesmo 504, agora por um campo novo.
    const enriquecido: ExistingClient = {
      ...identico,
      erp_company: "CAFE JURERE",
      erp_owner_name: "MARIA SOUZA",
      erp_owner_external_id: "77",
      erp_status: "1",
      erp_segment: "TELEVENDAS-VAREJO",
      erp_registered_at: "2024-03-15",
      erp_city: "Florianópolis",
      erp_uf: "SC",
      // Chaves em ordem DIFERENTE da que gravamos: é assim que o Postgres
      // devolve JSONB, e a comparação precisa sobreviver a isso.
      erp_metadata: { tipoPessoa: "J", bairro: "Centro" },
    };
    const escritas: Array<Record<string, unknown>> = [];
    const store: ClientStore = {
      findByExternalId: () => Promise.resolve(enriquecido),
      findByCnpj: () => Promise.resolve(enriquecido),
      enrich: (_id, patch) => {
        escritas.push(patch);
        return Promise.resolve();
      },
      createLead: () => Promise.resolve("l-1"),
      createClient: () => Promise.resolve("c-1"),
    };

    const r = await upsertCanonicalClient(store, {
      organizationId: "org-1",
      source: "toth",
      client: {
        ...CLIENT,
        erpCompany: "CAFE JURERE",
        ownerName: "MARIA SOUZA",
        ownerExternalId: "77",
        erpStatus: "1",
        segment: "TELEVENDAS-VAREJO",
        registeredAt: "2024-03-15",
        city: "Florianópolis",
        uf: "SC",
        metadata: { bairro: "Centro", tipoPessoa: "J" },
      },
      syncMode: "canonical",
    });

    expect(r).toEqual({ action: "skipped", reason: "no_changes" });
    expect(escritas).toHaveLength(0);
  });

  it("troca de representante é escrita mesmo em enrich_only", async () => {
    // Os campos `erp_*` espelham o ERP e não têm curadoria humana. Tratá-los
    // como campo curado congelaria o vendedor na primeira sincronização.
    const comDono: ExistingClient = { ...identico, erp_owner_name: "JOAO LIMA" };
    const escritas: Array<Record<string, unknown>> = [];
    const store: ClientStore = {
      findByExternalId: () => Promise.resolve(comDono),
      findByCnpj: () => Promise.resolve(comDono),
      enrich: (_id, patch) => {
        escritas.push(patch);
        return Promise.resolve();
      },
      createLead: () => Promise.resolve("l-1"),
      createClient: () => Promise.resolve("c-1"),
    };

    const r = await upsertCanonicalClient(store, {
      organizationId: "org-1",
      source: "toth",
      client: { ...CLIENT, ownerName: "MARIA SOUZA" },
      syncMode: "enrich_only",
    });

    expect(r.action).toBe("enriched");
    expect(escritas).toEqual([{ erp_owner_name: "MARIA SOUZA" }]);
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

/**
 * Chamado 93027ffb — CPF/CNPJ editado no Torque mora em `lead_documents`, e
 * NÃO em `upsell_clients.cnpj`. O motivo está aqui: em `canonical` o sync
 * escreve o documento do ERP por cima da coluna a cada volta, e a coluna é a
 * chave que casa pedidos e cobranças. Estes casos travam as duas metades do
 * contrato: o sync continua dono do espelho, e não conhece o override.
 */
describe("upsertCanonicalClient — o override de documento do lead fica fora do sync", () => {
  const espelhoDivergente: ExistingClient = {
    id: "c-1",
    // Alguém mexeu na coluna à mão: em canonical o ERP volta a valer.
    cnpj: "10203040506070",
    phone: CLIENT.phone,
    email: CLIENT.email,
    company: CLIENT.company,
    name: CLIENT.name,
    external_source: "toth",
    external_id: CLIENT.externalId,
    external_ref: CLIENT.externalRef,
  };

  function storeQueRegistra() {
    const escritas: Array<{ metodo: string; args: unknown[] }> = [];
    const store: ClientStore = {
      findByExternalId: () => Promise.resolve(espelhoDivergente),
      findByCnpj: () => Promise.resolve(espelhoDivergente),
      enrich: (...args) => {
        escritas.push({ metodo: "enrich", args });
        return Promise.resolve();
      },
      createLead: (...args) => {
        escritas.push({ metodo: "createLead", args });
        return Promise.resolve("l-1");
      },
      createClient: (...args) => {
        escritas.push({ metodo: "createClient", args });
        return Promise.resolve("c-1");
      },
    };
    return { store, escritas };
  }

  it("em canonical o documento do ERP reescreve upsell_clients.cnpj — por isso o override não pode morar ali", async () => {
    const { store, escritas } = storeQueRegistra();
    const r = await upsertCanonicalClient(store, {
      organizationId: "org-1",
      source: "toth",
      client: CLIENT,
      syncMode: "canonical",
    });

    expect(r.action).toBe("enriched");
    expect(escritas).toEqual([{ metodo: "enrich", args: ["c-1", { cnpj: CLIENT.cnpj }] }]);
  });

  it("a única escrita do sync é a linha de upsell_clients: nenhum lead e nenhum override são tocados", async () => {
    const { store, escritas } = storeQueRegistra();
    await upsertCanonicalClient(store, {
      organizationId: "org-1",
      source: "toth",
      client: { ...CLIENT, email: "novo@acme.com" },
      syncMode: "canonical",
    });

    expect(escritas.map((e) => e.metodo)).toEqual(["enrich"]);
    const patch = escritas[0].args[1] as Record<string, unknown>;
    expect(Object.keys(patch).some((k) => /document|override|lead_/.test(k))).toBe(false);
  });

  it("o porto do sync não tem caminho para lead_documents", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("supabase/functions/_shared/erp/sync/upsert-client.ts", "utf8");
    expect(fonte).not.toMatch(/lead_documents|set_lead_document/);
    const { store } = storeQueRegistra();
    expect(Object.keys(store).sort()).toEqual(["createClient", "createLead", "enrich", "findByCnpj", "findByExternalId"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Chamado 82c50502 — "o ERP sugere, o CRM manda"
// ─────────────────────────────────────────────────────────────────────────────

describe("upsertCanonicalClient — canonical NÃO sobrescreve o telefone (82c50502)", () => {
  it("mantém o telefone curado no CRM mesmo em canonical", async () => {
    const existing: ExistingClient = {
      id: "c1", cnpj: "old", phone: "48911112222", email: "old", company: "old", name: "Old",
    };
    const { store, calls } = makeStore({ findByExternalId: async () => existing });
    await upsertCanonicalClient(store, {
      organizationId: "org1", source: "toth", client: CLIENT, syncMode: "canonical",
    });
    const patch = calls.enrich[0].patch;
    expect(patch.name).toBe("Acme");
    expect("phone" in patch).toBe(false);
  });

  it("preenche o telefone quando está vazio", async () => {
    const existing: ExistingClient = {
      id: "c1", cnpj: "old", phone: null, email: "old", company: "old", name: "Old",
    };
    const { store, calls } = makeStore({ findByExternalId: async () => existing });
    await upsertCanonicalClient(store, {
      organizationId: "org1", source: "toth", client: CLIENT, syncMode: "canonical",
    });
    expect(calls.enrich[0].patch.phone).toBe("4799990000");
  });
});

describe("planLeadPhoneOps — telefones do ERP em lead_phones (82c50502)", () => {
  const row = (over: Partial<ExistingLeadPhone>): ExistingLeadPhone => ({
    lead_id: "L1", normalized_phone: null, label: null, label_locked: false,
    source: "crm", erp_phone_id: null, deleted_at: null, ...over,
  });
  const erp = (phone: string, label: string | null, erpPhoneId: string | null = null) =>
    ({ phone, label, isWhatsApp: null, erpPhoneId });

  it("insere o telefone que o lead ainda não tem, com nome e id da linha", () => {
    const ops = planLeadPhoneOps("L1", [row({ normalized_phone: "48999750303" })], [
      erp("48999750303", null, "1"),
      erp("4832631404", "José Luiz - Compras", "2"),
    ]);
    expect(ops).toContainEqual({
      op: "insert", lead_id: "L1", phone: "4832631404", label: "José Luiz - Compras",
      erp_phone_id: "2", is_whatsapp: null,
    });
  });

  it("linha do ERP não travada acompanha o nome do ERP", () => {
    const ops = planLeadPhoneOps("L1", [
      row({ normalized_phone: "48955556666", source: "erp", label: "José", erp_phone_id: "7" }),
    ], [erp("48955556666", "José Luiz - Compras", "7")]);
    expect(ops).toEqual([
      { op: "update", lead_id: "L1", normalized_phone: "48955556666", label: "José Luiz - Compras" },
    ]);
  });

  it("não toca nome travado", () => {
    const ops = planLeadPhoneOps("L1", [
      row({ normalized_phone: "48955556666", source: "erp", label: "Zé do CRM", label_locked: true, erp_phone_id: "7" }),
    ], [erp("48955556666", "José Luiz - Compras", "7")]);
    expect(ops).toEqual([]);
  });

  it("linha do CRM só ganha o que está vazio (id da linha e nome sem nome)", () => {
    const ops = planLeadPhoneOps("L1", [
      row({ normalized_phone: "48999750303", source: "crm", label: null }),
      row({ normalized_phone: "48955556666", source: "crm", label: "Recepção" }),
    ], [erp("48999750303", "Maria", "1"), erp("48955556666", "Outro nome", "2")]);
    expect(ops).toEqual([
      { op: "update", lead_id: "L1", normalized_phone: "48999750303", erp_phone_id: "1", label: "Maria" },
      { op: "update", lead_id: "L1", normalized_phone: "48955556666", erp_phone_id: "2" },
    ]);
  });

  it("não ressuscita telefone apagado no CRM — nem pelo id, nem pelo número", () => {
    const ops = planLeadPhoneOps("L1", [
      row({ normalized_phone: "48955556666", erp_phone_id: "7", deleted_at: "2026-10-08T00:00:00Z" }),
      row({ normalized_phone: "48977778888", deleted_at: "2026-10-08T00:00:00Z" }),
    ], [erp("48955556666", "José", "7"), erp("48977778888", "Maria", "8")]);
    expect(ops).toEqual([]);
  });

  it("nada muda → nenhuma operação (re-sincronizar é de graça)", () => {
    const ops = planLeadPhoneOps("L1", [
      row({ normalized_phone: "48955556666", source: "erp", label: "José", erp_phone_id: "7" }),
    ], [erp("48955556666", "José", "7")]);
    expect(ops).toEqual([]);
  });

  it("nome que sumiu no ERP não apaga o nome que já existe", () => {
    const ops = planLeadPhoneOps("L1", [
      row({ normalized_phone: "48955556666", source: "erp", label: "José", erp_phone_id: "7" }),
    ], [erp("48955556666", null, "7")]);
    expect(ops).toEqual([]);
  });

  it("número com 55 e sem o 9 casa com a linha gravada (mesma normalização do banco)", () => {
    const ops = planLeadPhoneOps("L1", [
      row({ normalized_phone: "48999750303", source: "erp", label: "José", erp_phone_id: "7" }),
    ], [erp("554899750303", "José", "7")]);
    expect(ops).toEqual([]);
  });
});
