/**
 * Classificação Lead · Cliente · Indefinido — vocabulário e recorte.
 *
 * O que estes testes protegem é a fronteira entre "sem recorte" e "recorte por
 * gaveta". O sentinel `"all"` precisa NÃO virar `eq("classificacao", "all")`:
 * se virar, a lista fica vazia para todo mundo e o sintoma ("sumiram os leads")
 * não aponta para o filtro.
 */
import { describe, it, expect } from "vitest";
import {
  CLASSIFICACAO_TODAS,
  LEAD_CLASSIFICACOES,
  LEAD_CLASSIFICACAO_CONFIG,
  isLeadClassificacao,
  labelDaClassificacao,
} from "../../src/modules/leads/lib/lead-classificacao";
import { applyLeadListFilters } from "../../src/modules/leads/lib/lead-list-filters";

/** Espião mínimo do builder do PostgREST — registra as chamadas encadeadas. */
function queryEspia() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const q: Record<string, unknown> = {};
  for (const fn of ["eq", "is", "or", "gte", "lte", "in", "not", "ilike"]) {
    q[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return q;
    };
  }
  return { q, calls };
}

describe("vocabulário da classificação", () => {
  it("são exatamente três gavetas", () => {
    expect(LEAD_CLASSIFICACOES).toEqual(["lead", "cliente", "indefinido"]);
  });

  it("toda gaveta tem rótulo e descrição — o submenu mostra as duas", () => {
    for (const c of LEAD_CLASSIFICACOES) {
      expect(LEAD_CLASSIFICACAO_CONFIG[c].label).toBeTruthy();
      expect(LEAD_CLASSIFICACAO_CONFIG[c].descricao).toBeTruthy();
    }
  });

  it("`all` NÃO é uma gaveta — é o sentinel de 'sem recorte'", () => {
    expect(isLeadClassificacao(CLASSIFICACAO_TODAS)).toBe(false);
  });

  it("valor fora do enum não quebra o rótulo, devolve o cru", () => {
    expect(labelDaClassificacao("lixo")).toBe("lixo");
    expect(labelDaClassificacao(null)).toBe("Lead");
    expect(labelDaClassificacao(undefined)).toBe("Lead");
  });
});

describe("applyLeadListFilters — recorte por gaveta", () => {
  /**
   * ⚠️ `usaLeiDoErp` é obrigatório para a gaveta virar `eq("classificacao")`.
   *
   * Desde 2026-09-04 a mesma escolha do seletor tem DUAS fontes possíveis
   * (decisão do CTO): a gaveta do ERP, para org com a integração feita, e a lei
   * da RELAÇÃO — venda no funil OU pedido no ERP — para todo o resto. Sem a
   * flag, o filtro cai na Relação, que é a queda segura: numa org sem
   * integração, `classificacao` é 'lead' em 100% das linhas.
   */
  it("gaveta escolhida vira eq no banco — em org COM integração de ERP", () => {
    const { q, calls } = queryEspia();
    applyLeadListFilters(q, { filterClassificacao: "cliente", usaLeiDoErp: true });
    expect(calls).toContainEqual({ fn: "eq", args: ["classificacao", "cliente"] });
  });

  it("sem integração, a MESMA gaveta recorta pela relação, não pelo ERP", () => {
    const { q, calls } = queryEspia();
    applyLeadListFilters(q, { filterClassificacao: "cliente", usaLeiDoErp: false });
    expect(calls.some((c) => c.args[0] === "classificacao")).toBe(false);
    expect(calls.some((c) => String(c.args[0]).includes("primeira_venda_at"))).toBe(true);
  });

  /**
   * O caso que mais dói se quebrar: `"all"` virando `eq("classificacao","all")`
   * esvazia a lista inteira, e o usuário lê isso como "meus leads sumiram".
   */
  it("`all` não gera filtro nenhum", () => {
    const { q, calls } = queryEspia();
    applyLeadListFilters(q, { filterClassificacao: CLASSIFICACAO_TODAS });
    expect(calls.some((c) => c.args[0] === "classificacao")).toBe(false);
  });

  it("ausente também não gera filtro — visão salva antiga não traz a chave", () => {
    const { q, calls } = queryEspia();
    applyLeadListFilters(q, {});
    expect(calls.some((c) => c.args[0] === "classificacao")).toBe(false);
  });

  it("as três gavetas passam pelo filtro — no mundo do ERP", () => {
    for (const c of LEAD_CLASSIFICACOES) {
      const { q, calls } = queryEspia();
      applyLeadListFilters(q, { filterClassificacao: c, usaLeiDoErp: true });
      expect(calls).toContainEqual({ fn: "eq", args: ["classificacao", c] });
    }
  });
});
