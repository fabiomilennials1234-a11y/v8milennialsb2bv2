/**
 * Tests for _shared/erp/sync/adopt-existing-leads.ts e a adoção em
 * bulk-create-clients.ts.
 *
 * Caso: lead importado por planilha, depois cadastrado no ERP; a sincronização
 * criava um segundo lead sem telefone em vez de ligar a carteira ao que já existia.
 */
import { describe, it, expect } from "vitest";
import {
  findAdoptableLeads,
  normalizeName,
  sameCompanyName,
} from "../../supabase/functions/_shared/erp/sync/adopt-existing-leads";
import {
  adoptedLeadPatch,
  bulkCreateClients,
} from "../../supabase/functions/_shared/erp/sync/bulk-create-clients";
import type { CanonicalClient } from "../../supabase/functions/_shared/erp/types";

const cliente = (over: Partial<CanonicalClient> = {}): CanonicalClient => ({
  externalId: "17095",
  externalRef: null,
  cnpj: null,
  name: "ALFA ENGENHARIA LTDA",
  company: null,
  email: "sem@sem",
  phone: "4799635609",
  ...over,
});

const norm = (p: string | null) => (p === "4799635609" ? "47999635609" : p);

describe("sameCompanyName", () => {
  it("ignora caixa, acento e pontuação", () => {
    expect(sameCompanyName({ name: "Delta Cafes Ltda." }, { name: "DELTA CAFES LTDA" })).toBe(true);
  });

  it("aceita código de cliente e INAPTA como prefixo do nome", () => {
    expect(
      sameCompanyName({ name: "3759- Pedro- EPSILON REFEICOES LTDA" }, { name: "EPSILON REFEICOES LTDA" }),
    ).toBe(true); // código tirado; "Pedro" sobra, mas o nome da empresa está contido
    expect(sameCompanyName({ name: "INAPTA - ZETA ALIMENTOS EPP" }, { name: "ZETA ALIMENTOS EPP" })).toBe(true);
    expect(sameCompanyName({ name: "8154 DELTA CAFES LTDA" }, { name: "DELTA CAFES LTDA" })).toBe(true);
  });

  it("um nome contido no outro vale quando o menor é longo o bastante", () => {
    expect(sameCompanyName({ name: "MARIA SOUZA LIMA 12345678900" }, { name: "MARIA SOUZA LIMA" })).toBe(true);
  });

  it("nome curto não absorve outro: 'rafael' não é 'rafael distribuidora'", () => {
    expect(sameCompanyName({ name: "Rafael" }, { name: "Rafael Distribuidora de Bebidas" })).toBe(false);
  });

  it("empresas diferentes que dividem telefone não casam", () => {
    expect(
      sameCompanyName({ name: "BETA REVESTIMENTOS LTDA" }, { name: "GAMA ALIMENTACAO LTDA" }),
    ).toBe(false);
  });

  it("compara também pela empresa", () => {
    expect(sameCompanyName({ name: "João", company: "Alfa Engenharia" }, { name: "ALFA ENGENHARIA" })).toBe(true);
  });

  it("normalizeName tolera vazio", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("  ")).toBe("");
  });
});

/** Supabase mínimo para as duas consultas de findAdoptableLeads. */
function fakeAdmin(leads: unknown[], owned: string[] = [], sharedPhones: string[] = []) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      let cols = "";
      const self = () => chain;
      for (const m of ["eq", "is", "in"]) chain[m] = self;
      chain.select = (c: string) => {
        cols = c;
        return chain;
      };
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        let data: unknown[];
        if (table === "leads") data = leads;
        else if (cols === "phone") data = sharedPhones.map((phone) => ({ phone }));
        else data = owned.map((lead_id) => ({ lead_id }));
        resolve({ data, error: null });
      };
      return chain;
    },
  } as never;
}

const lead = (over: Record<string, unknown> = {}) => ({
  id: "lead-planilha",
  name: "ALFA ENGENHARIA LTDA",
  company: "ALFA ENGENHARIA LTDA",
  normalized_phone: "47999635609",
  segment: null,
  uf: null,
  erp_code: null,
  origin: "outro",
  ...over,
});

describe("findAdoptableLeads", () => {
  const run = (
    leads: unknown[],
    owned: string[] = [],
    clients = [cliente()],
    sharedPhones: string[] = [],
  ) =>
    findAdoptableLeads(fakeAdmin(leads, owned, sharedPhones), {
      organizationId: "org",
      clients,
      normalizePhone: norm,
    });

  it("🔑 mesmo telefone + nome compatível + lead sem dono → adota", async () => {
    const found = await run([lead()]);
    expect(found.get("17095")).toEqual({ id: "lead-planilha", hasSegment: false, hasUf: false });
  });

  describe("nome diferente (planilha com o nome do contato)", () => {
    const contato = lead({ name: "Sidnei", company: null });

    it("🔑 número que ninguém mais usa → adota (Natural Beer / Sidnei)", async () => {
      const found = await run([contato]);
      expect(found.get("17095")).toMatchObject({ id: "lead-planilha" });
    });

    it("número já na carteira de outro cliente → não adota (compartilhado)", async () => {
      expect((await run([contato], [], [cliente()], ["4799635609"])).size).toBe(0);
    });

    it("dois clientes do ERP com o mesmo número no lote → não adota", async () => {
      const found = await run([contato], [], [cliente({ externalId: "1" }), cliente({ externalId: "2", name: "OUTRA LTDA" })]);
      expect(found.size).toBe(0);
    });

    it("lead com cliente na carteira continua fora, mesmo com número único", async () => {
      expect((await run([contato], ["lead-planilha"])).size).toBe(0);
    });

    it("lead criado pelo ERP continua fora, mesmo com número único", async () => {
      expect((await run([lead({ name: "Sidnei", origin: "erp_toth" })])).size).toBe(0);
    });
  });

  it("mesmo telefone, empresa diferente e número compartilhado → não adota (telefone N:N)", async () => {
    const outraEmpresa = lead({ name: "GAMA ALIMENTACAO LTDA", company: null });
    expect((await run([outraEmpresa], [], [cliente()], ["4799635609"])).size).toBe(0);
  });

  it("lead que já tem cliente na carteira → não adota", async () => {
    expect((await run([lead()], ["lead-planilha"])).size).toBe(0);
  });

  it("lead criado pelo ERP → não adota", async () => {
    expect((await run([lead({ origin: "erp_toth" })])).size).toBe(0);
  });

  it("cliente sem telefone → não consulta nem adota", async () => {
    expect((await run([lead()], [], [cliente({ phone: null })])).size).toBe(0);
  });

  it("um lead é adotado por UM cliente só", async () => {
    const found = await run([lead()], [], [cliente({ externalId: "1" }), cliente({ externalId: "2" })]);
    expect([...found.keys()]).toEqual(["1"]);
  });
});

describe("adoptedLeadPatch — o ERP só completa o que está vazio", () => {
  const c = cliente({ segment: "Café", uf: "SC" });

  it("lead vazio recebe erp_code, segmento e UF (com procedência)", () => {
    expect(adoptedLeadPatch(c, { id: "l", hasSegment: false, hasUf: false }, "toth")).toEqual({
      erp_code: "17095",
      segment: "Café",
      uf: "SC",
      uf_source: "erp",
    });
  });

  it("🔑 segmento e UF curados não são sobrescritos; erp_code entra sempre", () => {
    expect(adoptedLeadPatch(c, { id: "l", hasSegment: true, hasUf: true }, "toth")).toEqual({
      erp_code: "17095",
    });
  });

  it("nunca toca em nome, telefone ou e-mail", () => {
    const patch = adoptedLeadPatch(c, { id: "l", hasSegment: false, hasUf: false }, "toth");
    for (const k of ["name", "phone", "email", "company", "responsible_id"]) expect(patch).not.toHaveProperty(k);
  });
});

describe("bulkCreateClients com adoção", () => {
  function recorder(errors: Record<string, { message: string } | null> = {}) {
    const calls: Array<{ table: string; op: string; payload: unknown; id?: unknown }> = [];
    const admin = {
      from(table: string) {
        return {
          insert(rows: unknown) {
            calls.push({ table, op: "insert", payload: rows });
            return Promise.resolve({ error: errors[`${table}:insert`] ?? null });
          },
          update(patch: unknown) {
            return {
              eq(_c: string, id: unknown) {
                calls.push({ table, op: "update", payload: patch, id });
                return Promise.resolve({ error: null });
              },
            };
          },
          delete() {
            return { in: () => Promise.resolve({ error: null }) };
          },
        };
      },
    } as never;
    return { admin, calls };
  }

  it("🔑 adotado: NÃO cria lead; carteira aponta para o lead existente", async () => {
    const { admin, calls } = recorder();
    const adopt = new Map([["17095", { id: "lead-planilha", hasSegment: false, hasUf: false }]]);
    const r = await bulkCreateClients(admin, {
      organizationId: "org",
      source: "toth",
      clients: [cliente()],
      adopt,
    });

    expect(r).toMatchObject({ created: 1, adopted: 1, failed: 0 });
    expect(calls.some((c) => c.table === "leads" && c.op === "insert")).toBe(false);
    const carteira = calls.find((c) => c.table === "upsell_clients")!.payload as Array<Record<string, unknown>>;
    expect(carteira[0]).toMatchObject({ lead_id: "lead-planilha", external_id: "17095" });
    expect(calls.find((c) => c.table === "leads" && c.op === "update")).toMatchObject({
      id: "lead-planilha",
      payload: { erp_code: "17095" },
    });
  });

  it("lote misto: adotado e novo convivem; só o novo cria lead", async () => {
    const { admin, calls } = recorder();
    const adopt = new Map([["17095", { id: "lead-planilha", hasSegment: false, hasUf: false }]]);
    const r = await bulkCreateClients(admin, {
      organizationId: "org",
      source: "toth",
      clients: [cliente(), cliente({ externalId: "9", name: "OUTRA LTDA", phone: null })],
      adopt,
    });
    expect(r).toMatchObject({ created: 2, adopted: 1 });
    const inserts = calls.filter((c) => c.table === "leads" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as unknown[]).length).toBe(1);
  });

  it("carteira falhou na adoção → o lead NÃO é alterado", async () => {
    const { admin, calls } = recorder({ "upsell_clients:insert": { message: "boom" } });
    const adopt = new Map([["17095", { id: "lead-planilha", hasSegment: false, hasUf: false }]]);
    const r = await bulkCreateClients(admin, {
      organizationId: "org",
      source: "toth",
      clients: [cliente()],
      adopt,
    });
    expect(r).toMatchObject({ created: 0, adopted: 0, failed: 1 });
    expect(calls.some((c) => c.table === "leads" && c.op === "update")).toBe(false);
  });

  it("sem `adopt` o comportamento é o de sempre", async () => {
    const { admin, calls } = recorder();
    const r = await bulkCreateClients(admin, { organizationId: "org", source: "toth", clients: [cliente()] });
    expect(r).toMatchObject({ created: 1, adopted: 0 });
    expect(calls.filter((c) => c.table === "leads" && c.op === "insert")).toHaveLength(1);
  });
});
