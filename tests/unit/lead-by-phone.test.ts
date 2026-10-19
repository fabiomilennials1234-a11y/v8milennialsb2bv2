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
  pickLeadByOpenDeal,
  resolveLeadByPhone,
} from "../../supabase/functions/_shared/lead-by-phone.ts";

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
  pipeline_entries: [] as Record<string, unknown>[],
  deals: [] as Record<string, unknown>[],
};

const entry = (lead_id: string, deal_id: string) => ({ organization_id: ORG, lead_id, deal_id });
const deal = (id: string, created_at: string, over: Record<string, unknown> = {}) => ({
  id, organization_id: ORG, created_at, closed_at: null, deleted_at: null, ...over,
});

/** Roda o resolvedor com as linhas em ordem direta e invertida e exige UM resultado. */
async function resolveInAllOrders(tables: FakeTables, opts?: { preferredLeadId?: string | null }) {
  const results = new Set<string | null>();
  const rev = <T,>(xs: T[]) => [...xs].reverse();
  for (const leads of [tables.leads, rev(tables.leads)]) {
    for (const lead_phones of [tables.lead_phones, rev(tables.lead_phones)]) {
      for (const pipeline_entries of [tables.pipeline_entries, rev(tables.pipeline_entries)]) {
        for (const deals of [tables.deals, rev(tables.deals)]) {
          const { supabase } = fakeSupabaseTables({ leads, lead_phones, pipeline_entries, deals });
          results.add((await resolveLeadByPhone(supabase, ORG, PHONE, opts)).leadId);
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
      pipeline_entries: [entry("L-A", "D1"), entry("L-B", "D2")],
      deals: [
        deal("D1", "2026-05-01", { closed_at: "2026-05-02" }),
        deal("D2", "2026-05-01", { deleted_at: "2026-05-03" }),
      ],
    };
    expect(await resolveInAllOrders(t)).toBeNull();
  });

  it("2 leads vivos, um com negócio aberto: o do negócio aberto, seja o primário ou o secundário", async () => {
    const a = { ...base, pipeline_entries: [entry("L-A", "D1")], deals: [deal("D1", "2026-05-01")] };
    expect(await resolveInAllOrders(a)).toBe("L-A");
    const b = { ...base, pipeline_entries: [entry("L-B", "D1")], deals: [deal("D1", "2026-05-01")] };
    expect(await resolveInAllOrders(b)).toBe("L-B");
  });

  it("os dois com negócio aberto: o de negócio mais recente", async () => {
    const t = {
      ...base,
      pipeline_entries: [entry("L-A", "D1"), entry("L-B", "D2")],
      deals: [deal("D1", "2026-05-01"), deal("D2", "2026-06-01")],
    };
    expect(await resolveInAllOrders(t)).toBe("L-B");
  });

  it("empate de created_at desempata pelo id do negócio (maior vence)", async () => {
    const t = {
      ...base,
      pipeline_entries: [entry("L-A", "D1"), entry("L-B", "D2")],
      deals: [deal("D1", "2026-05-01"), deal("D2", "2026-05-01")],
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

describe("pickLeadByOpenDeal", () => {
  it("1 candidato: ele, sem olhar negócio", () => {
    expect(pickLeadByOpenDeal(["L-A"], [])).toBe("L-A");
  });
  it("0 candidatos: null", () => {
    expect(pickLeadByOpenDeal([], [])).toBeNull();
  });
  it("ignora negócio de lead que não é candidato", () => {
    expect(pickLeadByOpenDeal(["L-A", "L-B"], [{ lead_id: "L-X", deal_id: "D", created_at: "2026-01-01" }])).toBeNull();
  });
});
