/**
 * Chamado 82c50502 — o lead tem vários telefones (`lead_phones`), e
 * `leads.normalized_phone` é só o principal. Mensagem ou formulário vindos do
 * telefone SECUNDÁRIO não podem criar um lead novo: seria a duplicata do cliente.
 */
import { describe, it, expect } from "vitest";
import "../../tests/helpers/deno-mock";
import { fakeSupabaseTables } from "../helpers/fake-supabase-tables";
import {
  getOrCreateLead,
  findLeadByPhoneOrEmail,
} from "../../supabase/functions/_shared/lead-service";

const ORG = "org-1";
const LEAD = {
  id: "lead-cliente",
  name: "Padaria Um",
  phone: "48999750303",
  email: null,
  organization_id: ORG,
  normalized_phone: "48999750303",
  ai_disabled: false,
};

/**
 * Supabase mínimo: `leads` por normalized_phone não acha nada (o número é
 * secundário); `lead_phones` acha; `leads` por id devolve o cliente.
 */
function fakeSupabase(opts: { secondaryRows: Array<{ lead_id: string }>; leadsById: unknown[] }) {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const filters: Array<{ table: string; op: string; col: string; val: unknown }> = [];

  const sb = {
    from(table: string) {
      let byIds = false;
      const chain: Record<string, unknown> = {};
      const result = () => {
        if (table === "lead_phones") return { data: opts.secondaryRows, error: null };
        if (table === "leads" && byIds) return { data: opts.leadsById, error: null };
        return { data: [], error: null };
      };
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push({ table, op: "eq", col, val });
          if (table === "leads" && col === "id") byIds = true;
          return chain;
        },
        is: (col: string, val: unknown) => {
          filters.push({ table, op: "is", col, val });
          return chain;
        },
        in: (col: string, val: unknown) => {
          filters.push({ table, op: "in", col, val });
          byIds = true;
          return chain;
        },
        not: () => chain,
        ilike: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return chain;
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve, reject),
      });
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { sb, inserts, filters };
}

describe("lead-service — telefone secundário (lead_phones)", () => {
  it("getOrCreateLead acha o lead pelo telefone secundário e NÃO cria outro", async () => {
    const { sb, inserts, filters } = fakeSupabase({
      secondaryRows: [{ lead_id: "lead-cliente" }],
      leadsById: [LEAD],
    });
    const r = await getOrCreateLead(sb as never, {
      organizationId: ORG,
      phone: "+55 48 3263-1404",
      name: "José Luiz",
    });
    expect(r?.created).toBe(false);
    expect(r?.lead.id).toBe("lead-cliente");
    expect(inserts.filter((i) => i.table === "leads")).toHaveLength(0);
    // A busca é recortada pela org e ignora telefone apagado.
    expect(filters).toContainEqual({ table: "lead_phones", op: "eq", col: "organization_id", val: ORG });
    expect(filters).toContainEqual({ table: "lead_phones", op: "eq", col: "normalized_phone", val: "48932631404" });
    expect(filters).toContainEqual({ table: "lead_phones", op: "is", col: "deleted_at", val: null });
  });

  it("findLeadByPhoneOrEmail também enxerga o telefone secundário", async () => {
    const { sb } = fakeSupabase({ secondaryRows: [{ lead_id: "lead-cliente" }], leadsById: [LEAD] });
    const lead = await findLeadByPhoneOrEmail(sb as never, ORG, "4832631404");
    expect(lead?.id).toBe("lead-cliente");
  });

  it("telefone secundário de lead na lixeira não conta — segue para criar", async () => {
    const { sb, inserts } = fakeSupabase({ secondaryRows: [{ lead_id: "lead-apagado" }], leadsById: [] });
    const lead = await findLeadByPhoneOrEmail(sb as never, ORG, "4832631404");
    expect(lead).toBeNull();
    expect(inserts).toHaveLength(0);
  });
});

describe("lead-service — número em 2 leads vivos (Chamados 99067f13, 33c5fd52)", () => {
  const P = "48932631404";
  const row = (id: string, created_at: string, normalized_phone: string | null) => ({
    id, name: id, phone: null, email: null, organization_id: ORG, normalized_phone,
    ai_disabled: false, deleted_at: null, created_at,
  });
  const tables = (withOpenDeal: boolean) => ({
    // L-VELHO: principal do número. L-NOVO: mesmo número como secundário, criado depois.
    leads: [row("L-VELHO", "2026-01-01", P), row("L-NOVO", "2026-09-01", null)],
    lead_phones: [{ organization_id: ORG, lead_id: "L-VELHO", normalized_phone: P, deleted_at: null },
                  { organization_id: ORG, lead_id: "L-NOVO", normalized_phone: P, deleted_at: null }],
    deals: withOpenDeal
      ? [{ id: "D1", organization_id: ORG, source_lead_id: "L-VELHO", created_at: "2026-02-01", closed_at: null, deleted_at: null }]
      : [],
  });

  it("devolve o lead com negócio aberto, mesmo sendo o mais antigo (antes: o mais novo)", async () => {
    for (const flip of [false, true]) {
      const t = tables(true);
      if (flip) t.leads.reverse();
      const { supabase } = fakeSupabaseTables(t);
      expect((await findLeadByPhoneOrEmail(supabase, ORG, P))?.id).toBe("L-VELHO");
    }
  });

  it("sem negócio aberto em nenhum: nenhum lead, independente da ordem", async () => {
    for (const flip of [false, true]) {
      const t = tables(false);
      if (flip) t.leads.reverse();
      const { supabase } = fakeSupabaseTables(t);
      expect(await findLeadByPhoneOrEmail(supabase, ORG, P)).toBeNull();
    }
  });

  it("getOrCreateLead: ambíguo sem negócio aberto devolve null e NÃO cria lead", async () => {
    // O fake não tem `insert`: se tentasse criar, quebraria com TypeError.
    const { supabase } = fakeSupabaseTables(tables(false));
    expect(await getOrCreateLead(supabase, { organizationId: ORG, phone: P, name: "X" })).toBeNull();
  });

  it("getOrCreateLead: ambíguo COM negócio aberto devolve o lead do negócio, sem criar", async () => {
    const { supabase } = fakeSupabaseTables(tables(true));
    const r = await getOrCreateLead(supabase, { organizationId: ORG, phone: P, name: "X" });
    expect(r).toMatchObject({ created: false, source: "phone", lead: { id: "L-VELHO" } });
  });
});
