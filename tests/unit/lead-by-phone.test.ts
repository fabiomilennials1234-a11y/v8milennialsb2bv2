/**
 * Chamados 99067f13 / 33c5fd52 — um número pode pertencer a 2+ leads vivos
 * (o principal de um e o telefone secundário de outro). Regra do CTO (19/10):
 * a mensagem chega pelo lead com NEGÓCIO ABERTO; sem negócio aberto, por
 * nenhum lead. Nunca "o primeiro", "o mais novo" nem "o dono".
 */
import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";
import { fakeSupabaseTables, type FakeTables } from "../helpers/fake-supabase-tables";
import {
  pickLeadForNumber,
  resolveLeadByPhone,
  type NumberLeadSignals,
} from "../../supabase/functions/_shared/lead-by-phone.ts";
import {
  pickLeadForNumber as pickLeadForNumberFront,
  resolveLeadByPhone as resolveLeadByPhoneFront,
} from "../../src/modules/communication/lib/leadByPhone";

const ORG = "org-1";
const PHONE = "48999990000";

const base = {
  leads: [
    { id: "L-A", organization_id: ORG, normalized_phone: PHONE, deleted_at: null, created_at: "2026-01-01" },
    { id: "L-B", organization_id: ORG, normalized_phone: "48911110000", deleted_at: null, created_at: "2026-03-01" },
    { id: "L-DEL", organization_id: ORG, normalized_phone: null, deleted_at: "2026-02-01", created_at: "2026-02-01" },
  ],
  lead_phones: [
    { organization_id: ORG, lead_id: "L-B", normalized_phone: PHONE, deleted_at: null },
    { organization_id: ORG, lead_id: "L-DEL", normalized_phone: PHONE, deleted_at: null },
  ],
  deals: [] as Record<string, unknown>[],
  whatsapp_numero_lead_escolhido: [] as Record<string, unknown>[],
  whatsapp_messages: [] as Record<string, unknown>[],
};

const escolha = (lead_id: string, over: Record<string, unknown> = {}) => ({
  organization_id: ORG, normalized_phone: PHONE, lead_id, ...over,
});
const msg = (id: string, lead_id: string | null, timestamp: string, over: Record<string, unknown> = {}) => ({
  id, organization_id: ORG, normalized_phone: PHONE, lead_id, timestamp, created_at: timestamp, deleted_at: null, ...over,
});

const deal = (id: string, lead: string, created_at: string, over: Record<string, unknown> = {}) => ({
  id, organization_id: ORG, source_lead_id: lead, created_at, closed_at: null, deleted_at: null, ...over,
});

/** Roda o resolvedor com as linhas em ordem direta e invertida e exige UM resultado. */
async function resolveInAllOrders(tables: FakeTables, opts?: { preferredLeadId?: string | null }) {
  const results = new Set<string | null>();
  const rev = <T,>(xs: T[]) => [...xs].reverse();
  for (const leads of [tables.leads, rev(tables.leads)]) {
    for (const lead_phones of [tables.lead_phones, rev(tables.lead_phones)]) {
      for (const deals of [tables.deals, rev(tables.deals)]) {
        for (const whatsapp_messages of [tables.whatsapp_messages ?? [], rev(tables.whatsapp_messages ?? [])]) {
          const { supabase } = fakeSupabaseTables({
            leads, lead_phones, deals, whatsapp_messages,
            whatsapp_numero_lead_escolhido: tables.whatsapp_numero_lead_escolhido ?? [],
          });
          // Borda e front são espelhos: os dois têm que dar o MESMO lead.
          results.add((await resolveLeadByPhone(supabase, ORG, PHONE, opts)).leadId);
          results.add((await resolveLeadByPhoneFront(supabase, ORG, PHONE, opts)).leadId);
        }
      }
    }
  }
  expect([...results]).toHaveLength(1);
  return [...results][0];
}

describe("resolveLeadByPhone", () => {
  it("número com UM lead vivo resolve para esse lead (não regride)", async () => {
    expect(await resolveInAllOrders({ ...base, lead_phones: [] })).toBe("L-A");
  });

  it("lead apagado não conta como candidato", async () => {
    const t = { ...base, lead_phones: base.lead_phones.filter((p) => p.lead_id === "L-DEL") };
    expect(await resolveInAllOrders(t)).toBe("L-A");
  });

  it("2 leads vivos SEM negócio aberto: nenhum lead", async () => {
    expect(await resolveInAllOrders(base)).toBeNull();
  });

  it("2 leads vivos, negócio só fechado ou apagado: nenhum lead", async () => {
    const t = {
      ...base,
      deals: [
        deal("D1", "L-A", "2026-05-01", { closed_at: "2026-05-02" }),
        deal("D2", "L-B", "2026-05-01", { deleted_at: "2026-05-03" }),
      ],
    };
    expect(await resolveInAllOrders(t)).toBeNull();
  });

  it("2 leads vivos, um com negócio aberto só em deals.source_lead_id (sem pipeline_entries): esse lead, primário ou secundário", async () => {
    const a = { ...base, deals: [deal("D1", "L-A", "2026-05-01")] };
    expect(await resolveInAllOrders(a)).toBe("L-A");
    const b = { ...base, deals: [deal("D1", "L-B", "2026-05-01")] };
    expect(await resolveInAllOrders(b)).toBe("L-B");
  });

  it("os dois com negócio aberto: o de negócio mais recente", async () => {
    const t = {
      ...base,
      deals: [deal("D1", "L-A", "2026-05-01"), deal("D2", "L-B", "2026-06-01")],
    };
    expect(await resolveInAllOrders(t)).toBe("L-B");
  });

  it("empate de created_at desempata pelo id do negócio (maior vence)", async () => {
    const t = {
      ...base,
      deals: [deal("D1", "L-A", "2026-05-01"), deal("D2", "L-B", "2026-05-01")],
    };
    expect(await resolveInAllOrders(t)).toBe("L-B");
  });

  it("leadId preferido (deep link) vence quando pertence ao número", async () => {
    expect(await resolveInAllOrders(base, { preferredLeadId: "L-B" })).toBe("L-B");
  });

  it("leadId preferido de outro número é ignorado", async () => {
    expect(await resolveInAllOrders(base, { preferredLeadId: "L-OUTRO" })).toBeNull();
  });

  it("devolve os candidatos para quem precisa saber que houve ambiguidade", async () => {
    const { supabase } = fakeSupabaseTables(base);
    const r = await resolveLeadByPhone(supabase, ORG, PHONE);
    expect([...r.candidateIds].sort()).toEqual(["L-A", "L-B"]);
  });
});

describe("resolveLeadByPhone — escolha explícita e vínculo anterior (regressão de 19/10)", () => {
  it("caso Cliente Exemplo: 2+ leads, negócio fechado, vínculo anterior ao A → A", async () => {
    const t = {
      ...base,
      deals: [deal("D1", "L-B", "2026-09-01", { closed_at: "2026-10-19" })],
      whatsapp_messages: [msg("M1", "L-A", "2026-10-18"), msg("M2", null, "2026-10-20"), msg("M3", null, "2026-11-01")],
    };
    expect(await resolveInAllOrders(t)).toBe("L-A");
  });

  it("vínculo anterior a lead fora dos candidatos é ignorado", async () => {
    const t = { ...base, whatsapp_messages: [msg("M1", "L-DEL", "2026-10-18")] };
    expect(await resolveInAllOrders(t)).toBeNull();
  });

  it("vale a mensagem vinculada MAIS RECENTE; apagada não conta; outra org não conta", async () => {
    const t = {
      ...base,
      whatsapp_messages: [
        msg("M1", "L-A", "2026-10-01"),
        msg("M2", "L-B", "2026-10-10"),
        msg("M3", "L-A", "2026-10-15", { deleted_at: "2026-10-16" }),
        msg("M4", "L-A", "2026-10-20", { organization_id: "org-2" }),
      ],
    };
    expect(await resolveInAllOrders(t)).toBe("L-B");
  });

  it("negócio aberto vence vínculo anterior", async () => {
    const t = { ...base, deals: [deal("D1", "L-B", "2026-05-01")], whatsapp_messages: [msg("M1", "L-A", "2026-10-18")] };
    expect(await resolveInAllOrders(t)).toBe("L-B");
  });

  it("escolha explícita vence negócio aberto e vínculo anterior", async () => {
    const t = {
      ...base,
      deals: [deal("D1", "L-B", "2026-05-01")],
      whatsapp_messages: [msg("M1", "L-B", "2026-10-18")],
      whatsapp_numero_lead_escolhido: [escolha("L-A")],
    };
    expect(await resolveInAllOrders(t)).toBe("L-A");
  });

  it("escolha de lead que deixou de ser candidato é ignorada (cai no negócio)", async () => {
    const t = {
      ...base,
      deals: [deal("D1", "L-B", "2026-05-01")],
      whatsapp_numero_lead_escolhido: [escolha("L-DEL")],
    };
    expect(await resolveInAllOrders(t)).toBe("L-B");
  });

  it("escolha de OUTRO número ou OUTRA org não vale", async () => {
    const t = {
      ...base,
      whatsapp_numero_lead_escolhido: [escolha("L-A", { normalized_phone: "48911110000" }), escolha("L-A", { organization_id: "org-2" })],
    };
    expect(await resolveInAllOrders(t)).toBeNull();
  });

  it("um lead: não consulta escolha nem mensagens", async () => {
    const { supabase, queried } = fakeSupabaseTables({ ...base, lead_phones: [] });
    expect((await resolveLeadByPhone(supabase, ORG, PHONE)).leadId).toBe("L-A");
    expect(queried).not.toContain("whatsapp_numero_lead_escolhido");
    expect(queried).not.toContain("whatsapp_messages");
  });

  it("escolha ou negócio decidem: não lê mensagens", async () => {
    const { supabase, queried } = fakeSupabaseTables({ ...base, whatsapp_numero_lead_escolhido: [escolha("L-B")] });
    expect((await resolveLeadByPhone(supabase, ORG, PHONE)).leadId).toBe("L-B");
    expect(queried).not.toContain("whatsapp_messages");
  });

  it("tabela de escolha ausente (front antes da migration): segue a regra sem ela", async () => {
    const { supabase: real } = fakeSupabaseTables({ ...base, whatsapp_messages: [msg("M1", "L-A", "2026-10-18")] });
    const semTabela = {
      from: (table: string) =>
        table === "whatsapp_numero_lead_escolhido"
          ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "PGRST205", message: "not found" } }) }) }) }) }
          : real.from(table),
    } as unknown as typeof real;
    expect((await resolveLeadByPhone(semTabela, ORG, PHONE)).leadId).toBe("L-A");
    expect((await resolveLeadByPhoneFront(semTabela, ORG, PHONE)).leadId).toBe("L-A");
  });

  it("outra falha ao ler a escolha vira erro (leadId null NÃO é 'sem lead')", async () => {
    const { supabase: real } = fakeSupabaseTables(base);
    const quebrado = {
      from: (table: string) =>
        table === "whatsapp_numero_lead_escolhido"
          ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "57014", message: "timeout" } }) }) }) }) }
          : real.from(table),
    } as unknown as typeof real;
    const r = await resolveLeadByPhone(quebrado, ORG, PHONE);
    expect(r).toMatchObject({ leadId: null, error: "timeout" });
    expect([...r.candidateIds].sort()).toEqual(["L-A", "L-B"]);
  });
});

describe("pickLeadForNumber — paridade borda × front", () => {
  const d = (lead_id: string, deal_id: string, created_at: string) => ({ lead_id, deal_id, created_at });
  const casos: Array<[string, string[], NumberLeadSignals, string | null]> = [
    ["1 candidato", ["a"], { chosenLeadId: "x", lastLinkedLeadId: "y" }, "a"],
    ["2+ com escolha", ["a", "b"], { chosenLeadId: "b" }, "b"],
    ["escolha de ex-candidato ignorada", ["a", "b"], { chosenLeadId: "x" }, null],
    ["deal vence vínculo anterior", ["a", "b"], { openDeals: [d("b", "D", "2026-01-01")], lastLinkedLeadId: "a" }, "b"],
    ["escolha vence deal", ["a", "b"], { chosenLeadId: "a", openDeals: [d("b", "D", "2026-01-01")] }, "a"],
    ["vínculo anterior fora dos candidatos ignorado", ["a", "b"], { lastLinkedLeadId: "z" }, null],
    ["vínculo anterior candidato", ["a", "b"], { lastLinkedLeadId: "a" }, "a"],
    ["nada → null", ["a", "b"], {}, null],
    ["0 candidatos", [], { chosenLeadId: "a" }, null],
  ];
  for (const [nome, cands, sinais, esperado] of casos) {
    it(nome, () => {
      expect(pickLeadForNumber(cands, sinais)).toBe(esperado);
      expect(pickLeadForNumberFront(cands, sinais)).toBe(esperado);
      expect(pickLeadForNumber([...cands].reverse(), sinais)).toBe(esperado);
    });
  }
});

describe("pickLeadForNumber — só negócio aberto", () => {
  it("1 candidato: ele, sem olhar negócio", () => {
    expect(pickLeadForNumber(["L-A"], { openDeals: [] })).toBe("L-A");
  });
  it("0 candidatos: null", () => {
    expect(pickLeadForNumber([], { openDeals: [] })).toBeNull();
  });
  it("ignora negócio de lead que não é candidato", () => {
    expect(pickLeadForNumber(["L-A", "L-B"], { openDeals: [{ lead_id: "L-X", deal_id: "D", created_at: "2026-01-01" }] })).toBeNull();
  });
});
