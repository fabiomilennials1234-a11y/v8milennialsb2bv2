import { describe, expect, it } from "vitest";
import { CAFE_JURERE_ORGANIZATION_ID, normalizarAbaCafeJurere, usaClassificacaoCafeJurere } from "./cafe-jurere-classificacao";
import { leadClassificacaoOptions } from "./lead-classificacao";
import { applyLeadListFilters } from "./lead-list-filters";

describe("piloto de abas da Café Jurerê", () => {
  it("exige a flag booleana e a organização exata", () => {
    expect(usaClassificacaoCafeJurere(CAFE_JURERE_ORGANIZATION_ID, true)).toBe(true);
    for (const flag of [false, undefined, null, "true", 1]) {
      expect(usaClassificacaoCafeJurere(CAFE_JURERE_ORGANIZATION_ID, flag)).toBe(false);
    }
    for (const org of ["outra-org", undefined, null]) {
      expect(usaClassificacaoCafeJurere(org, true)).toBe(false);
    }
  });

  it("oferece Perdido no piloto, preservando Indefinido em outras orgs com ERP", () => {
    expect(leadClassificacaoOptions(true, true).map(o => o.label)).toEqual(["Todos", "Lead", "Cliente", "Perdido"]);
    expect(leadClassificacaoOptions(true)[3].value).toBe("indefinido");
    expect(leadClassificacaoOptions(false)[3].value).toBe("perdido");
  });

  it("visão salva com aba antiga volta para Todos, nunca esvazia a lista", () => {
    expect(normalizarAbaCafeJurere("indefinido")).toBe("all");
    expect(normalizarAbaCafeJurere("invalido")).toBe("all");
    expect(normalizarAbaCafeJurere("perdido")).toBe("perdido");
  });

  it.each(["lead", "cliente", "perdido", "all", "indefinido"])("%s usa o mesmo filtro para lista, contagem e exportação", aba => {
    const calls: unknown[][] = [];
    const q = {
      eq: (...args: unknown[]) => { calls.push(args); return q; },
      is: () => q,
    };
    applyLeadListFilters(q, { filterClassificacao: aba, usaLeiDoErp: true, usaCadastroErpCafeJurere: true });
    expect(calls).toEqual([["visivel_lista_cafe_jurere", true], ...(["lead", "cliente", "perdido"].includes(aba) ? [["classificacao_cafe_jurere", aba]] : [])]);
  });
});
