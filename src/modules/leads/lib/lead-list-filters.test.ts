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
