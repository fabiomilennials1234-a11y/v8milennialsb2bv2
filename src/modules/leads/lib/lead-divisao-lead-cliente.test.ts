/** Contrato compartilhado pela página, contagem e exportação: duas leis, um seletor. */
import { describe, expect, it } from "vitest";
import { applyLeadListFilters } from "./lead-list-filters";

/** Espião de builder PostgREST — encadeia e registra, sem ir ao banco. */
function espiao() {
  const chamadas: string[] = [];
  const q: Record<string, unknown> = {};
  const encadeia =
    (nome: string) =>
    (...args: unknown[]) => {
      chamadas.push(`${nome}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return q;
    };
  for (const m of ["eq", "is", "not", "or", "gte", "lte", "ilike", "in"]) {
    q[m] = encadeia(m);
  }
  return { q, chamadas };
}

describe("org SEM integração de ERP — vale a lei da Relação", () => {
  it.each(["lead", "cliente", "perdido"])("%s usa o campo calculado do banco", (relacao) => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterClassificacao: relacao, usaLeiDoErp: false });
    expect(chamadas).toContain('eq("relacao_negocios","' + relacao + '")');
    expect(chamadas.join()).not.toContain("primeira_venda_at");
    expect(chamadas.join()).not.toContain("primeiro_pedido_erp_at");
    expect(chamadas.join()).not.toContain('eq("classificacao"');
  });
  it("indefinido não recorta uma organização sem ERP", () => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterClassificacao: "indefinido", usaLeiDoErp: false });
    expect(chamadas.join()).not.toContain("relacao_negocios");
  });
});

describe("org COM integração de ERP — vale a gaveta do ERP", () => {
  it("filtra `classificacao`, e não as colunas de relação", () => {
    for (const gaveta of ["lead", "cliente", "indefinido"]) {
      const { q, chamadas } = espiao();
      applyLeadListFilters(q, { filterClassificacao: gaveta, usaLeiDoErp: true });
      expect(chamadas).toContain(`eq("classificacao","${gaveta}")`);
      expect(chamadas.join()).not.toContain("primeira_venda_at");
      expect(chamadas.join()).not.toContain("primeiro_pedido_erp_at");
    }
  });
});

describe("o sentinel `all` e a ausência", () => {
  it('"all" não filtra em nenhum dos dois mundos', () => {
    // O que mais dói se quebrar: virar `eq("classificacao","all")` e esvaziar a
    // lista — inclusive na exportação, que compartilha este módulo.
    for (const usaLeiDoErp of [true, false]) {
      const { q, chamadas } = espiao();
      applyLeadListFilters(q, { filterClassificacao: "all", usaLeiDoErp });
      expect(chamadas.join()).not.toContain("classificacao");
      expect(chamadas.join()).not.toContain("primeira_venda_at");
    }
  });

  it("sem a chave, não filtra — visão salva antiga continua mostrando tudo", () => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, {});
    expect(chamadas.join()).not.toContain("classificacao");
    expect(chamadas.join()).not.toContain("primeira_venda_at");
  });

  it("a fonte ausente cai na lei da Relação, não na do ERP", () => {
    // `usaLeiDoErp` ausente = false. É a queda segura: a lei da Relação deriva
    // de dado que toda org tem; a do ERP depende de `erp_code`, NULL em 100%
    // das linhas de quem não tem integração — jogaria a lista inteira em
    // "lead" sem ninguém entender por quê.
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterClassificacao: "cliente" });
    expect(chamadas.join()).toContain("relacao_negocios");
    expect(chamadas.join()).not.toContain("classificacao");
  });
});
