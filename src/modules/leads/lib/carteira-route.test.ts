import { describe, expect, it } from "vitest";
import {
  CARTEIRA_ROUTE,
  DEFAULT_CARTEIRA_FILTERS,
  carteiraFiltersFromLeads,
  carteiraRedirectTarget,
} from "./carteira-route";

describe("carteiraRedirectTarget", () => {
  it("sem query vai para /carteira puro", () => {
    expect(carteiraRedirectTarget(new URLSearchParams())).toBe(CARTEIRA_ROUTE);
  });

  it("preserva o deep-link ?lead= (e o ?comment= que o acompanha)", () => {
    expect(carteiraRedirectTarget(new URLSearchParams("lead=L1&comment=C9"))).toBe(
      "/carteira?lead=L1&comment=C9",
    );
  });

  it("descarta o recorte da LISTA de leads — a Carteira não aplica view/uf/from/to/atribuicao", () => {
    const search = new URLSearchParams(
      "view=V1&uf=SC&from=2026-10-01T03:00:00.000Z&to=x&atribuicao=sem-responsavel&lead=L1",
    );
    expect(carteiraRedirectTarget(search)).toBe("/carteira?lead=L1");
  });
});

describe("carteiraFiltersFromLeads", () => {
  it("leva busca e os três recortes que a aba Clientes mostrava", () => {
    expect(
      carteiraFiltersFromLeads({
        searchQuery: "ana",
        filterOrigin: "site",
        filterQualification: "ouro",
        filterResponsible: "tm-1",
      }),
    ).toEqual({ searchQuery: "ana", filterOrigin: "site", filterQualification: "ouro", filterResponsible: "tm-1" });
  });

  it("visão salva antiga sem a chave cai no padrão (Select nunca fica não-controlado)", () => {
    expect(carteiraFiltersFromLeads({ searchQuery: "x" })).toEqual({
      ...DEFAULT_CARTEIRA_FILTERS,
      searchQuery: "x",
    });
  });

  it("lixo vindo do storage não vira filtro", () => {
    expect(carteiraFiltersFromLeads({ filterOrigin: 42, filterResponsible: null })).toEqual(
      DEFAULT_CARTEIRA_FILTERS,
    );
  });
});
