/**
 * O que a sincronização do ERP escreve no LEAD — e o que ela não pode escrever.
 *
 * 🔴 `leads.uf` tem CHECK com as 27 UFs (`leads_uf_check`). O Toth cadastra
 * cliente do exterior com UF 'EX', e o mapper aceita qualquer par de letras.
 * Enquanto `leadEnrichmentColumns` repassava o valor cru, o cliente novo do
 * exterior não era criado (INSERT do lead estourava) nem adotado (o UPDATE do
 * lead estourava e levava junto o `erp_code`). A Carteira continua com 'EX' em
 * `erp_uf`: lá é informação.
 *
 * O banco de mentira daqui recusa o que o CHECK recusa, com a lista do CHECK
 * escrita à mão — e não importada do helper que está sob teste.
 */
import { assertEquals, assertFalse } from "@std/assert";
import type { CanonicalClient } from "../types.ts";
import { clientEnrichmentColumns, leadEnrichmentColumns } from "./client-enrichment.ts";
import { adoptedLeadPatch, buildClientRows, bulkCreateClients } from "./bulk-create-clients.ts";
import { type ClientStore, upsertCanonicalClient } from "./upsert-client.ts";

const cliente = (over: Partial<CanonicalClient> = {}): CanonicalClient => ({
  externalId: "4242",
  externalRef: null,
  cnpj: null,
  name: "IMPORTADORA EXEMPLO LLC",
  company: null,
  email: null,
  phone: null,
  ...over,
});

/** `leads_uf_check`, como está no baseline (20260101000000). */
const LEADS_UF_CHECK = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO",
]);

const ERRO_DO_CHECK = 'new row for relation "leads" violates check constraint "leads_uf_check"';

function violaCheckDeUf(row: Record<string, unknown>): boolean {
  return row.uf !== undefined && row.uf !== null && !LEADS_UF_CHECK.has(String(row.uf));
}

/** Supabase mínimo: `leads` recusa o que o CHECK recusa; o resto entra. */
function bancoComCheck() {
  const leadsInseridos: Record<string, unknown>[] = [];
  const leadsAtualizados: Record<string, unknown>[] = [];
  const carteira: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      return {
        insert(rows: Record<string, unknown>[]) {
          if (table === "leads" && rows.some(violaCheckDeUf)) {
            return Promise.resolve({ error: { message: ERRO_DO_CHECK } });
          }
          (table === "leads" ? leadsInseridos : carteira).push(...rows);
          return Promise.resolve({ error: null });
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_coluna: string, _id: unknown) {
              if (table === "leads" && violaCheckDeUf(patch)) {
                return Promise.resolve({ error: { message: ERRO_DO_CHECK } });
              }
              leadsAtualizados.push(patch);
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return { in: (_coluna: string, _ids: unknown) => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  return { admin, leadsInseridos, leadsAtualizados, carteira };
}

// ── leadEnrichmentColumns ────────────────────────────────────────────────────

Deno.test("🔴 'EX' (exterior) não vai para o lead: nem uf, nem uf_source", () => {
  assertEquals(leadEnrichmentColumns(cliente({ uf: "EX", segment: "EXPORTACAO" }), "toth"), {
    segment: "EXPORTACAO",
    erp_code: "4242",
  });
});

Deno.test("' sc ' vira 'SC', com a procedência do ERP", () => {
  assertEquals(leadEnrichmentColumns(cliente({ uf: " sc " }), "toth"), {
    uf: "SC",
    uf_source: "erp",
    erp_code: "4242",
  });
});

Deno.test("'XX' não é UF: o lead fica sem", () => {
  assertEquals(leadEnrichmentColumns(cliente({ uf: "XX" }), "toth"), { erp_code: "4242" });
});

Deno.test("null e undefined: sem UF e sem procedência", () => {
  assertEquals(leadEnrichmentColumns(cliente({ uf: null }), "toth"), { erp_code: "4242" });
  assertEquals(leadEnrichmentColumns(cliente({ uf: undefined }), "toth"), { erp_code: "4242" });
  // Adapter que nem produz o campo (Omie).
  assertEquals(leadEnrichmentColumns(cliente(), "omie"), { erp_code: "4242" });
});

Deno.test("'SP' segue como sempre: 'SP' + 'erp'", () => {
  assertEquals(leadEnrichmentColumns(cliente({ uf: "SP" }), "toth"), {
    uf: "SP",
    uf_source: "erp",
    erp_code: "4242",
  });
});

// ── A Carteira não muda ──────────────────────────────────────────────────────

Deno.test("a Carteira continua guardando 'EX' em erp_uf — lá é informação", () => {
  assertEquals(clientEnrichmentColumns(cliente({ uf: "EX" })).erp_uf, "EX");
});

// ── Os caminhos que gravam no lead ───────────────────────────────────────────

Deno.test("criação em lote: o lead novo nasce sem 'EX'; a Carteira leva 'EX'", () => {
  const { lead, carteira } = buildClientRows("org-1", "toth", cliente({ uf: "EX" }), "lead-1");
  assertFalse("uf" in lead);
  assertFalse("uf_source" in lead);
  assertEquals(carteira.erp_uf, "EX");
});

Deno.test("🔴 criação em lote: o cliente do exterior é criado, e não derruba o lote", async () => {
  const banco = bancoComCheck();
  let n = 0;
  const r = await bulkCreateClients(banco.admin as never, {
    organizationId: "org-1",
    source: "toth",
    clients: [cliente({ externalId: "1", uf: "EX" }), cliente({ externalId: "2", uf: "SP" })],
    newId: () => `lead-${++n}`,
  });

  assertEquals({ created: r.created, failed: r.failed, errors: r.errors }, {
    created: 2,
    failed: 0,
    errors: [],
  });
  assertEquals(banco.leadsInseridos.map((l) => l.uf ?? null), [null, "SP"]);
  assertEquals(banco.carteira.map((c) => c.erp_uf), ["EX", "SP"]);
});

Deno.test("adoção: lead vazio recebe erp_code e segmento, e não recebe 'EX'", () => {
  const patch = adoptedLeadPatch(
    cliente({ uf: "EX", segment: "EXPORTACAO" }),
    { id: "lead-existente", hasSegment: false, hasUf: false },
    "toth",
  );
  assertEquals(patch, { erp_code: "4242", segment: "EXPORTACAO" });
});

Deno.test("🔴 adoção: o UPDATE do lead passa, e o erp_code não se perde", async () => {
  const banco = bancoComCheck();
  const r = await bulkCreateClients(banco.admin as never, {
    organizationId: "org-1",
    source: "toth",
    clients: [cliente({ uf: "EX" })],
    adopt: new Map([["4242", { id: "lead-existente", hasSegment: false, hasUf: false }]]),
  });

  assertEquals({ created: r.created, adopted: r.adopted, errors: r.errors }, {
    created: 1,
    adopted: 1,
    errors: [],
  });
  assertEquals(banco.leadsAtualizados, [{ erp_code: "4242" }]);
  assertEquals(banco.carteira.map((c) => c.erp_uf), ["EX"]);
});

Deno.test("🔴 reconciliação (canonical, sem par): o lead nasce, sem 'EX'", async () => {
  const leads: Record<string, unknown>[] = [];
  const carteira: Record<string, unknown>[] = [];
  const store: ClientStore = {
    findByExternalId: () => Promise.resolve(null),
    findByCnpj: () => Promise.resolve(null),
    enrich: () => Promise.reject(new Error("cliente sem par não é enriquecido")),
    createLead: (_org, lead) => {
      const row = { ...lead.extra };
      if (violaCheckDeUf(row)) return Promise.reject(new Error(`createLead: ${ERRO_DO_CHECK}`));
      leads.push(row);
      return Promise.resolve("lead-1");
    },
    createClient: (row) => {
      carteira.push(row);
      return Promise.resolve("cliente-1");
    },
  };

  const r = await upsertCanonicalClient(store, {
    organizationId: "org-1",
    source: "toth",
    client: cliente({ uf: "EX" }),
    syncMode: "canonical",
  });

  assertEquals(r, { action: "created", clientId: "cliente-1" });
  assertEquals(leads, [{ erp_code: "4242" }]);
  assertEquals(carteira[0].erp_uf, "EX");
});
