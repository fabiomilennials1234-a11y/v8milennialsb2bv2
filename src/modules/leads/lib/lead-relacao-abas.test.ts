import { describe, expect, it } from "vitest";
import {
  abaEfetiva,
  isRelacaoAba,
  RELACAO_ABAS,
  RELACAO_ABA_CONFIG,
} from "./lead-relacao-abas";
import { applyLeadListFilters } from "./lead-list-filters";

/** Espião de builder PostgREST — registra a chamada em vez de ir ao banco. */
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

describe("vocabulário das abas", () => {
  it("são exatamente Leads, Clientes e Todos", () => {
    expect(RELACAO_ABAS).toEqual(["leads", "clientes", "todos"]);
  });

  it("toda aba tem rótulo, descrição e frase de vazio", () => {
    for (const aba of RELACAO_ABAS) {
      expect(RELACAO_ABA_CONFIG[aba].label.length).toBeGreaterThan(0);
      expect(RELACAO_ABA_CONFIG[aba].descricao.length).toBeGreaterThan(0);
      expect(RELACAO_ABA_CONFIG[aba].vazio.length).toBeGreaterThan(0);
    }
  });

  it("isRelacaoAba recusa lixo", () => {
    expect(isRelacaoAba("leads")).toBe(true);
    expect(isRelacaoAba("cliente")).toBe(false); // singular é da OUTRA lei
    expect(isRelacaoAba(null)).toBe(false);
  });
});

describe("abaEfetiva — visão salva antiga", () => {
  it("sem a chave, a lista NÃO esconde ninguém", () => {
    // Quem salvou uma visão antes desta lei salvou uma lista sem recorte.
    // Abri-la já filtrada mudaria o que ela guardou.
    expect(abaEfetiva(undefined)).toBe("todos");
    expect(abaEfetiva(null)).toBe("todos");
    expect(abaEfetiva("qualquer-lixo")).toBe("todos");
  });

  it("com a chave, respeita o que foi escolhido", () => {
    expect(abaEfetiva("leads")).toBe("leads");
    expect(abaEfetiva("clientes")).toBe("clientes");
  });
});

describe("a lei no banco — applyLeadListFilters", () => {
  it("aba Leads pede quem NÃO tem primeira venda", () => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterRelacao: "leads" });
    expect(chamadas).toContain('is("primeira_venda_at",null)');
  });

  it("aba Clientes pede quem TEM primeira venda", () => {
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, { filterRelacao: "clientes" });
    expect(chamadas).toContain('not("primeira_venda_at","is",null)');
  });

  it('"todos" e ausente NÃO filtram — é o que preserva a exportação', () => {
    // O que mais dói se quebrar: virar `eq("primeira_venda_at","todos")` e
    // esvaziar a lista, ou esconder gente numa exportação que ninguém recortou.
    const a = espiao();
    applyLeadListFilters(a.q, { filterRelacao: "todos" });
    expect(a.chamadas.join()).not.toContain("primeira_venda_at");

    const b = espiao();
    applyLeadListFilters(b.q, {});
    expect(b.chamadas.join()).not.toContain("primeira_venda_at");
  });

  it("a lei da venda e o cadastro no ERP são filtros INDEPENDENTES", () => {
    // As duas colunas convivem: uma responde "comprou?", a outra "está no ERP?".
    // Se um dia colapsarem numa só, este teste cai.
    const { q, chamadas } = espiao();
    applyLeadListFilters(q, {
      filterRelacao: "clientes",
      filterClassificacao: "indefinido",
    });
    expect(chamadas).toContain('not("primeira_venda_at","is",null)');
    expect(chamadas).toContain('eq("classificacao","indefinido")');
  });
});
