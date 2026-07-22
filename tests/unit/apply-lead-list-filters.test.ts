import { describe, it, expect } from "vitest";
import { applyLeadListFilters } from "@/modules/leads/lib/lead-list-filters";

// Recorder que finge ser um postgrest query builder encadeável, registrando
// cada operador aplicado. Puro — não precisa de mock de Supabase/React.
interface Recorder {
  eqs: Array<[string, unknown]>;
  gtes: Array<[string, unknown]>;
  lts: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
  ors: string[];
}

function makeBuilder() {
  const rec: Recorder = { eqs: [], gtes: [], lts: [], iss: [], ors: [] };
  const builder: Record<string, unknown> = {
    eq(col: string, val: unknown) { rec.eqs.push([col, val]); return builder; },
    gte(col: string, val: unknown) { rec.gtes.push([col, val]); return builder; },
    lt(col: string, val: unknown) { rec.lts.push([col, val]); return builder; },
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

  it("rating high/medium/low mapeiam para gte/lt corretos", () => {
    const high = makeBuilder();
    applyLeadListFilters(high.builder, { filterRating: "high" });
    expect(high.rec.gtes).toContainEqual(["rating", 7]);

    const medium = makeBuilder();
    applyLeadListFilters(medium.builder, { filterRating: "medium" });
    expect(medium.rec.gtes).toContainEqual(["rating", 4]);
    expect(medium.rec.lts).toContainEqual(["rating", 7]);

    const low = makeBuilder();
    applyLeadListFilters(low.builder, { filterRating: "low" });
    expect(low.rec.lts).toContainEqual(["rating", 4]);
  });

  it("busca: adiciona .or() com ilike em name/company/email", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, { searchQuery: "  acme  " });
    expect(rec.ors).toHaveLength(1);
    expect(rec.ors[0]).toContain("name.ilike.%acme%");
    expect(rec.ors[0]).toContain("company.ilike.%acme%");
    expect(rec.ors[0]).toContain("email.ilike.%acme%");
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

  it("combina múltiplos filtros (origem + qualificação + rating)", () => {
    const { builder, rec } = makeBuilder();
    applyLeadListFilters(builder, {
      filterOrigin: "meta_ads",
      filterQualification: "diamante",
      filterRating: "high",
    });
    expect(rec.eqs).toContainEqual(["origin", "meta_ads"]);
    expect(rec.eqs).toContainEqual(["qualification_tier", "diamante"]);
    expect(rec.gtes).toContainEqual(["rating", 7]);
  });
});
