/**
 * A DIVISÃO LEAD × CLIENTE — uma decisão, duas fontes.
 *
 * Decisão do CTO em 2026-09-04: a lei do ERP é mandatória para quem TEM a
 * integração; quem não tem segue a lei da RELAÇÃO, que é a que a coluna
 * "Relação" da lista já imprime (`lead-relacao-situacao.ts`):
 *
 *     cliente ⟺ saleCount > 0 OU orderCount > 0
 *
 * Medido em prod no mesmo dia, sobre 56.859 leads vivos: 1.558 são cliente só
 * pelo funil, **178 só pelo ERP** e 1.935 pela união. Cobrir só a venda — como
 * a primeira versão desta feature fazia — deixava esses 178 na gaveta "lead"
 * com a coluna da mesma linha imprimindo "Cliente".
 */
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
  it("Cliente = venda OU pedido, num único `or`", () => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterClassificacao: "cliente", usaLeiDoErp: false });
    expect(chamadas).toContain(
      'or("primeira_venda_at.not.is.null,primeiro_pedido_erp_at.not.is.null")',
    );
    // E NÃO pode filtrar pela gaveta do ERP: numa org sem integração,
    // `classificacao` é 'lead' em 100% das linhas.
    expect(chamadas.join()).not.toContain("classificacao");
  });

  it("Lead = nenhuma das duas provas", () => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterClassificacao: "lead", usaLeiDoErp: false });
    expect(chamadas).toContain('is("primeira_venda_at",null)');
    expect(chamadas).toContain('is("primeiro_pedido_erp_at",null)');
  });

  it("os 178 clientes-só-pelo-ERP NÃO caem em Lead", () => {
    // O defeito que esta correção fecha: filtrar Lead só por `primeira_venda_at`
    // (a versão anterior) devolveria quem tem pedido no ERP e nenhuma venda.
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterClassificacao: "lead", usaLeiDoErp: false });
    const filtraPedido = chamadas.some((c) =>
      c.includes("primeiro_pedido_erp_at"),
    );
    expect(filtraPedido).toBe(true);
  });

  it("`indefinido` não recorta nada — a gaveta não existe neste mundo", () => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterClassificacao: "indefinido", usaLeiDoErp: false });
    expect(chamadas.join()).not.toContain("primeira_venda_at");
    expect(chamadas.join()).not.toContain("classificacao");
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
    expect(chamadas.join()).toContain("primeira_venda_at");
    expect(chamadas.join()).not.toContain("classificacao");
  });
});
