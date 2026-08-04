import { describe, expect, it } from "vitest";

import {
  applyLeadListSort,
  DEFAULT_LEAD_SORT,
  isLeadSortKey,
  LEAD_SORT_COLUMNS,
  normalizeLeadSort,
  toggleLeadSort,
  type LeadListSort,
  type LeadSortKey,
} from "./lead-list-sort";

/** Builder de mentira que só grava os `.order()` que recebeu. */
function fakeQuery() {
  const orders: Array<{ column: string; ascending: boolean }> = [];
  const builder = {
    orders,
    order(column: string, opts: { ascending: boolean }) {
      orders.push({ column, ascending: opts.ascending });
      return builder;
    },
  };
  return builder;
}

const TODAS: LeadSortKey[] = Object.keys(LEAD_SORT_COLUMNS) as LeadSortKey[];

describe("lead-list-sort — padrão", () => {
  it("mantém a ordem que a lista sempre teve", () => {
    expect(DEFAULT_LEAD_SORT).toEqual({ key: "created_at", direction: "desc" });
  });
});

describe("lead-list-sort — desempate", () => {
  it.each(TODAS)("ordena por %s e desempata por id ASC", (key) => {
    const q = fakeQuery();
    applyLeadListSort(q, { key, direction: "asc" });

    expect(q.orders).toEqual([
      { column: key, ascending: true },
      { column: "id", ascending: true },
    ]);
  });

  it("mantém o desempate ASC mesmo com a coluna em DESC", () => {
    // Sem isto, dois leads com o mesmo created_at podem trocar de lugar entre
    // uma página e outra — 643 linhas empatadas em prod, 13 páginas.
    const q = fakeQuery();
    applyLeadListSort(q, { key: "created_at", direction: "desc" });

    expect(q.orders).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: true },
    ]);
  });

  it("não passa nullsFirst — passar trocaria o índice por um sort completo", () => {
    const recebidas: Array<Record<string, unknown>> = [];
    const builder = {
      order(_column: string, opts: Record<string, unknown>) {
        recebidas.push(opts);
        return builder;
      },
    };
    applyLeadListSort(builder, DEFAULT_LEAD_SORT);

    for (const opts of recebidas) {
      expect(opts).not.toHaveProperty("nullsFirst");
    }
  });
});

describe("lead-list-sort — catálogo fechado", () => {
  it("só reconhece as colunas do catálogo", () => {
    expect(isLeadSortKey("name")).toBe(true);
    expect(isLeadSortKey("created_at")).toBe(true);
    expect(isLeadSortKey("rating")).toBe(false);
    expect(isLeadSortKey("id")).toBe(false);
  });

  it("não deixa passar propriedade herdada do prototype", () => {
    expect(isLeadSortKey("constructor")).toBe(false);
    expect(isLeadSortKey("toString")).toBe(false);
  });

  it.each([
    ["nulo", null],
    ["indefinido", undefined],
    ["string", "name"],
    ["número", 7],
    ["array", ["name"]],
    ["objeto vazio", {}],
    ["chave fora do catálogo", { key: "organization_id", direction: "asc" }],
    // Sintaxe de order do postgrest vinda de localStorage adulterado.
    ["injeção de sintaxe", { key: "name.desc,organization_id.asc", direction: "asc" }],
  ])("devolve o padrão para %s", (_rotulo, entrada) => {
    expect(normalizeLeadSort(entrada)).toEqual(DEFAULT_LEAD_SORT);
  });

  it("preserva uma ordenação válida", () => {
    const valida: LeadListSort = { key: "name", direction: "desc" };
    expect(normalizeLeadSort(valida)).toEqual(valida);
  });

  it("completa direção ausente ou inválida com a direção natural da coluna", () => {
    expect(normalizeLeadSort({ key: "name" })).toEqual({ key: "name", direction: "asc" });
    expect(normalizeLeadSort({ key: "created_at", direction: "ASC" })).toEqual({
      key: "created_at",
      direction: "desc",
    });
  });

  it("nunca produz chave fora do catálogo, seja qual for a entrada", () => {
    const entradas: unknown[] = [null, {}, { key: "x" }, { key: 1, direction: "asc" }, "lixo"];
    for (const entrada of entradas) {
      expect(isLeadSortKey(normalizeLeadSort(entrada).key)).toBe(true);
    }
  });
});

describe("lead-list-sort — clique no cabeçalho", () => {
  it("inverte a direção quando a coluna já é a ativa", () => {
    expect(toggleLeadSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
    expect(toggleLeadSort({ key: "name", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });

  it("adota a direção natural ao trocar de coluna", () => {
    // Data começa da mais recente; nome começa de A.
    expect(toggleLeadSort({ key: "name", direction: "desc" }, "created_at")).toEqual({
      key: "created_at",
      direction: "desc",
    });
    expect(toggleLeadSort({ key: "created_at", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });

  it("volta ao estado inicial em dois cliques na mesma coluna", () => {
    const inicio: LeadListSort = { key: "created_at", direction: "desc" };
    const doisCliques = toggleLeadSort(toggleLeadSort(inicio, "created_at"), "created_at");
    expect(doisCliques).toEqual(inicio);
  });
});
