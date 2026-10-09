import { describe, it, expect } from "vitest";
import { applyLeadListFilters } from "./lead-list-filters";

/**
 * Duble do query builder do PostgREST: registra as chamadas encadeadas em vez de
 * ir à rede. O que importa aqui é o PREDICADO montado — é ele que decide se a
 * linha filtrada por um dono é a mesma que a coluna "Dono da conta" mostra.
 */
type QueryDuble = {
  calls: string[];
  is(col: string, val: null): QueryDuble;
  eq(col: string, val: unknown): QueryDuble;
  gte(col: string, val: unknown): QueryDuble;
  lte(col: string, val: unknown): QueryDuble;
  lt(col: string, val: unknown): QueryDuble;
  or(expr: string): QueryDuble;
};

function fakeQuery(): QueryDuble {
  const calls: string[] = [];
  const registra = (chamada: string): QueryDuble => {
    calls.push(chamada);
    return q;
  };
  const q: QueryDuble = {
    calls,
    is: (col, val) => registra(`is:${col}:${val}`),
    eq: (col, val) => registra(`eq:${col}:${val}`),
    gte: (col, val) => registra(`gte:${col}:${val}`),
    lte: (col, val) => registra(`lte:${col}:${val}`),
    lt: (col, val) => registra(`lt:${col}:${val}`),
    or: (expr) => registra(`or:${expr}`),
  };
  return q;
}

const MEMBER = "6030520a-2ca7-477d-be89-55758e2cd808";

it("recorta Todos da Café Jurerê e preserva as demais organizações", () => {
  expect(applyLeadListFilters(fakeQuery(), { usaCadastroErpCafeJurere: true, filterClassificacao: "all" }).calls)
    .toEqual(["eq:visivel_lista_cafe_jurere:true"]);
  expect(applyLeadListFilters(fakeQuery(), { usaCadastroErpCafeJurere: false, filterClassificacao: "all" }).calls)
    .toEqual([]);
});

describe("applyLeadListFilters — dono da conta", () => {
  it("sem filtro quando ausente ou 'all'", () => {
    expect(applyLeadListFilters(fakeQuery(), {}).calls).toEqual([]);
    expect(applyLeadListFilters(fakeQuery(), { filterResponsible: "all" }).calls).toEqual([]);
  });

  it("'none' exige as três colunas de dono nulas", () => {
    const q = applyLeadListFilters(fakeQuery(), { filterResponsible: "none" });
    expect(q.calls).toEqual([
      "is:sale_responsible_id:null",
      "is:pre_sale_responsible_id:null",
      "is:responsible_id:null",
    ]);
  });

  it("casa a precedência que a lista exibe — sale, senão pre_sale, senão responsible", () => {
    const q = applyLeadListFilters(fakeQuery(), { filterResponsible: MEMBER });
    expect(q.calls).toEqual([
      `or:sale_responsible_id.eq.${MEMBER},` +
        `and(sale_responsible_id.is.null,pre_sale_responsible_id.eq.${MEMBER}),` +
        `and(sale_responsible_id.is.null,pre_sale_responsible_id.is.null,responsible_id.eq.${MEMBER})`,
    ]);
  });

  it("ignora valor que não é UUID — nada de predicado cru no or()", () => {
    // O `)` fecharia o and() e o resto viraria filtro do atacante.
    const q = applyLeadListFilters(fakeQuery(), { filterResponsible: "x),or(id.not.is.null" });
    expect(q.calls).toEqual([]);
  });

  it("não colide com o recorte de atribuição — os dois são predicados distintos", () => {
    const q = applyLeadListFilters(fakeQuery(), {
      filterAssignment: "unassigned",
      filterResponsible: MEMBER,
    });
    expect(q.calls).toEqual([
      "is:pre_sale_responsible_id:null",
      "is:sale_responsible_id:null",
      "is:sdr_id:null",
      "is:closer_id:null",
      expect.stringContaining(`or:sale_responsible_id.eq.${MEMBER}`),
    ]);
  });
});

describe("applyLeadListFilters — N donos por lead (Chamado 793f4b05)", () => {
  const CO_LEAD = "0d7f5a3e-1b2c-4d5e-8f90-123456789abc";

  it("org com a flag: casa QUALQUER dono — principais, legado sem principal e co-dono", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), {
      filterResponsible: MEMBER,
      donosMultiplos: true,
      coOwnedLeadIds: [CO_LEAD],
    });
    expect(calls).toEqual([
      `or:sale_responsible_id.eq.${MEMBER},` +
        `pre_sale_responsible_id.eq.${MEMBER},` +
        `and(sale_responsible_id.is.null,pre_sale_responsible_id.is.null,responsible_id.eq.${MEMBER}),` +
        `id.in.(${CO_LEAD})`,
    ]);
  });

  it("org com a flag: pré-venda casa mesmo quando há outra pessoa na venda", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), { filterResponsible: MEMBER, donosMultiplos: true });
    expect(calls[0]).toContain(`pre_sale_responsible_id.eq.${MEMBER}`);
    expect(calls[0]).not.toContain(`and(sale_responsible_id.is.null,pre_sale_responsible_id.eq.`);
  });

  it("sem co-donos: nenhum id.in vazio (PostgREST recusa `in.()`)", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), { filterResponsible: MEMBER, donosMultiplos: true, coOwnedLeadIds: [] });
    expect(calls[0]).not.toContain("id.in.");
  });

  it("id de co-dono fora do formato uuid não entra no or()", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), {
      filterResponsible: MEMBER,
      donosMultiplos: true,
      coOwnedLeadIds: ["x),name.eq.y", CO_LEAD],
    });
    expect(calls[0]).toContain(`id.in.(${CO_LEAD})`);
    expect(calls[0]).not.toContain("name.eq.y");
  });

  it("'none' não regride: as três colunas nulas, com ou sem a flag", () => {
    for (const donosMultiplos of [true, false]) {
      expect(applyLeadListFilters(fakeQuery(), { filterResponsible: "none", donosMultiplos }).calls).toEqual([
        "is:sale_responsible_id:null",
        "is:pre_sale_responsible_id:null",
        "is:responsible_id:null",
      ]);
    }
  });

  it("org sem a flag: ids de co-dono são ignorados e o predicado é o de sempre", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), { filterResponsible: MEMBER, coOwnedLeadIds: [CO_LEAD] });
    expect(calls[0]).not.toContain("id.in.");
    expect(calls[0]).toContain(`and(sale_responsible_id.is.null,pre_sale_responsible_id.eq.${MEMBER})`);
  });
});

describe("applyLeadListFilters — telefone secundário (Chamado 82c50502)", () => {
  const LEAD = "0d7f5a3e-1b2c-4d5e-8f90-123456789abc";

  it("a busca acha o lead pelo telefone secundário: id entra no MESMO or()", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), {
      searchQuery: "(17) 98125-7650",
      secondaryPhoneLeadIds: [LEAD],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^or:/);
    expect(calls[0]).toContain("normalized_phone.ilike.%17981257650%");
    expect(calls[0]).toContain(`id.in.(${LEAD})`);
  });

  it("sem ids do secundário, a busca é a de sempre", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), { searchQuery: "Padaria", secondaryPhoneLeadIds: [] });
    expect(calls[0]).not.toContain("id.in.");
  });

  it("id fora do formato uuid não entra no or() (quebraria a busca inteira)", () => {
    const { calls } = applyLeadListFilters(fakeQuery(), {
      searchQuery: "98125",
      secondaryPhoneLeadIds: ["x),name.eq.y", LEAD],
    });
    expect(calls[0]).toContain(`id.in.(${LEAD})`);
    expect(calls[0]).not.toContain("name.eq.y");
  });

  it("sem busca, ids soltos não filtram nada", () => {
    expect(applyLeadListFilters(fakeQuery(), { secondaryPhoneLeadIds: [LEAD] }).calls).toEqual([]);
  });
});
