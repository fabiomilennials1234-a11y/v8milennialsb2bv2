import { describe, it, expect } from "vitest";
import { applyLeadListFilters } from "@/modules/leads/lib/lead-list-filters";

// Recorder que finge ser um postgrest query builder encadeável, registrando
// cada operador aplicado. Puro — não precisa de mock de Supabase/React.
interface Recorder {
  eqs: Array<[string, unknown]>;
  gtes: Array<[string, unknown]>;
  lts: Array<[string, unknown]>;
  ltes: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
  ors: string[];
}

function makeBuilder() {
  const rec: Recorder = { eqs: [], gtes: [], lts: [], ltes: [], iss: [], ors: [] };
  const builder: Record<string, unknown> = {
    eq(col: string, val: unknown) { rec.eqs.push([col, val]); return builder; },
    gte(col: string, val: unknown) { rec.gtes.push([col, val]); return builder; },
    lt(col: string, val: unknown) { rec.lts.push([col, val]); return builder; },
    lte(col: string, val: unknown) { rec.ltes.push([col, val]); return builder; },
    is(col: string, val: unknown) { rec.iss.push([col, val]); return builder; },
    or(expr: string) { rec.ors.push(expr); return builder; },
  };
  return { builder, rec };
}

describe("applyLeadListFilters — qualificação", () => {
  it("adiciona .eq('qualification_tier', X) quando um tier é selecionado", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterQualification: "ouro" });
    expect(rec.eqs).toContainEqual(["qualification_tier", "ouro"]);
  });

  it.each(["diamante", "ouro", "prata", "bronze", "desqualificado"])(
    "aceita o tier '%s'",
    (tier) => {
      const { builder, rec } = makeBuilder();
      applyLeadListFilters(builder, { filterQualification: tier });
      expect(rec.eqs).toContainEqual(["qualification_tier", tier]);
    },
  );

  it("NÃO filtra quando qualificação é 'all'", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterQualification: "all" });
    expect(rec.eqs.find(([c]) => c === "qualification_tier")).toBeUndefined();
    expect(rec.iss.find(([c]) => c === "qualification_tier")).toBeUndefined();
  });

  it("NÃO filtra quando qualificação é undefined", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, {});
    expect(rec.eqs.find(([c]) => c === "qualification_tier")).toBeUndefined();
    expect(rec.iss.find(([c]) => c === "qualification_tier")).toBeUndefined();
  });

  it("sentinel 'none' filtra por IS NULL (sem tier), não por .eq", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterQualification: "none" });
    expect(rec.iss).toContainEqual(["qualification_tier", null]);
    // não deve virar um .eq('qualification_tier', 'none')
    expect(rec.eqs.find(([c]) => c === "qualification_tier")).toBeUndefined();
  });

  it("'desqualificado' (tier real) usa .eq, não IS NULL — distinto de 'none'", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterQualification: "desqualificado" });
    expect(rec.eqs).toContainEqual(["qualification_tier", "desqualificado"]);
    expect(rec.iss.find(([c]) => c === "qualification_tier")).toBeUndefined();
  });
});

describe("applyLeadListFilters — demais filtros (guardas de regressão)", () => {
  it("origem: .eq('origin', X) quando ≠ 'all'; ignora 'all'", () => {
    const a = makeBuilder();
    applyLeadListFilters(a.builder, { filterOrigin: "meta_ads" });
    expect(a.rec.eqs).toContainEqual(["origin", "meta_ads"]);

    const b = makeBuilder();
    applyLeadListFilters(b.builder, { filterOrigin: "all" });
    expect(b.rec.eqs.find(([c]) => c === "origin")).toBeUndefined();
  });

  it("uf: .eq('uf', X) quando presente", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterUf: "SP" });
    expect(rec.eqs).toContainEqual(["uf", "SP"]);
  });

  it("busca: adiciona .or() com ilike em name/company/email/phone", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { searchQuery: "  acme  " });
    expect(rec.ors).toHaveLength(1);
    expect(rec.ors[0]).toContain("name.ilike.%acme%");
    expect(rec.ors[0]).toContain("company.ilike.%acme%");
    expect(rec.ors[0]).toContain("email.ilike.%acme%");
    expect(rec.ors[0]).toContain("phone.ilike.%acme%");
  });

  it("busca casa o código do ERP — a lista mostra \"1234 - João\" e digitar 1234 tem que achar", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { searchQuery: "1234" });
    expect(rec.ors[0]).toContain("erp_code.ilike.%1234%");
  });

  it("busca por telefone com máscara casa a coluna normalizada só com os dígitos", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { searchQuery: "(21) 99999-8888" });
    expect(rec.ors[0]).toContain("normalized_phone.ilike.%21999998888%");
    // O termo cru continua valendo pra `phone`, que guarda o número formatado.
    expect(rec.ors[0]).toContain("phone.ilike.%(21) 99999-8888%");
  });

  it("busca parcial de telefone (sem DDD) casa por substring", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { searchQuery: "999998888" });
    expect(rec.ors[0]).toContain("normalized_phone.ilike.%999998888%");
  });

  it("termo textual com poucos dígitos não vira busca de telefone", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { searchQuery: "Loja 21" });
    expect(rec.ors[0]).toContain("name.ilike.%Loja 21%");
    expect(rec.ors[0]).not.toContain("normalized_phone");
  });

  it("busca vazia/whitespace não adiciona .or()", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { searchQuery: "   " });
    expect(rec.ors).toHaveLength(0);
  });

  it("sem filtros: nenhum operador aplicado; retorna o mesmo builder", () => {
    const { builder, rec } = makeBuilder();
    const out = applyLeadListFilters(builder, {});
    expect(out).toBe(builder);
    expect(rec.eqs).toHaveLength(0);
    expect(rec.gtes).toHaveLength(0);
    expect(rec.lts).toHaveLength(0);
    expect(rec.ors).toHaveLength(0);
  });

  it("combina múltiplos filtros (origem + qualificação)", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, {
      filterOrigin: "meta_ads",
      filterQualification: "diamante",
    });
    expect(rec.eqs).toContainEqual(["origin", "meta_ads"]);
    expect(rec.eqs).toContainEqual(["qualification_tier", "diamante"]);
  });
});

/**
 * Janela de criação — deep-link "Ver leads do período" do card Leads do Comando.
 * Os limites são instantes ABSOLUTOS (ISO com Z), já cortados na fronteira de dia
 * do fuso da org por `computePeriodRange`/`zoned-day`. O filtro precisa aplicá-los
 * verbatim, com a mesma semântica inclusiva da RPC `get_dashboard_metrics`
 * (`>= p_start_date` / `<= p_end_date`) — senão a lista não bate com o card.
 */
describe("applyLeadListFilters — janela de criação (created_at)", () => {
  const FROM = "2026-07-27T03:00:00.000Z"; // 27/07 00:00 BRT
  const TO = "2026-07-28T02:59:59.999Z"; // 27/07 23:59 BRT

  it("createdFrom vira .gte('created_at', …) com o instante verbatim", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { createdFrom: FROM });
    expect(rec.gtes).toContainEqual(["created_at", FROM]);
  });

  it("createdTo vira .lte('created_at', …) — inclusivo, igual à RPC", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { createdTo: TO });
    expect(rec.ltes).toContainEqual(["created_at", TO]);
  });

  it("os dois juntos formam a janela fechada do dia org-local", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { createdFrom: FROM, createdTo: TO });
    expect(rec.gtes).toContainEqual(["created_at", FROM]);
    expect(rec.ltes).toContainEqual(["created_at", TO]);
  });

  it("ausentes: nenhum filtro de created_at (lista completa, como antes)", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterOrigin: "meta_ads" });
    expect(rec.gtes.find(([c]) => c === "created_at")).toBeUndefined();
    expect(rec.ltes.find(([c]) => c === "created_at")).toBeUndefined();
  });

  it("combina com os demais filtros da lista sem se anular", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, {
      createdFrom: FROM,
      createdTo: TO,
      filterOrigin: "meta_ads",
      filterQualification: "diamante",
      searchQuery: "acme",
    });
    expect(rec.gtes).toContainEqual(["created_at", FROM]);
    expect(rec.ltes).toContainEqual(["created_at", TO]);
    expect(rec.eqs).toContainEqual(["origin", "meta_ads"]);
    expect(rec.eqs).toContainEqual(["qualification_tier", "diamante"]);
    expect(rec.ors[0]).toContain("name.ilike.%acme%");
  });
});

describe("applyLeadListFilters — atribuição", () => {
  // O atalho da política de isolamento (#1636) leva o admin daqui para a
  // atribuição em massa. Sem este recorte, o diálogo diz "M leads sem
  // responsável" e joga o admin numa lista de tudo.
  const COLUNAS = [
    "pre_sale_responsible_id",
    "sale_responsible_id",
    "sdr_id",
    "closer_id",
  ];

  it("'unassigned' exige as QUATRO colunas de responsável nulas", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterAssignment: "unassigned" });
    for (const col of COLUNAS) {
      expect(rec.iss).toContainEqual([col, null]);
    }
  });

  it("NÃO filtra quando a atribuição é 'all'", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { filterAssignment: "all" });
    for (const col of COLUNAS) {
      expect(rec.iss).not.toContainEqual([col, null]);
    }
  });

  it("NÃO filtra quando a atribuição é omitida — controle positivo", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, {});
    expect(rec.iss.filter(([c]) => COLUNAS.includes(c as string))).toHaveLength(0);
  });
});
