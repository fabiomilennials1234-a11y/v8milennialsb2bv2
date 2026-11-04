import { describe, expect, it } from "vitest";
import { mapearResumo, rotuloDoPeriodo } from "./boas-vindas-semana";

/** O que `boas_vindas_semana_reivindicar` devolve quando entrega. */
const entrega = {
  elegivel: true,
  semana: "2027-11-01",
  inicio: "2027-10-25",
  fim: "2027-10-31",
  leads: 5,
  vendas: 3,
  receita: 1800,
  por_dia: {
    leads: [2, 0, 1, 1, 0, 0, 1],
    vendas: [0, 1, 0, 1, 0, 0, 1],
    receita: [0, 1000, 0, 500, 0, 0, 300],
  },
  anterior: { leads: 2, vendas: 1, receita: 400 },
};

describe("mapearResumo", () => {
  it("traduz uma entrega válida", () => {
    expect(mapearResumo(entrega)).toEqual({
      periodo: "25 de out. a 31 de out.",
      leads: 5,
      vendas: 3,
      receita: 1800,
      porDia: {
        leads: [2, 0, 1, 1, 0, 0, 1],
        vendas: [0, 1, 0, 1, 0, 0, 1],
        receita: [0, 1000, 0, 500, 0, 0, 300],
      },
      anterior: { leads: 2, vendas: 1, receita: 400 },
    });
  });

  it.each([
    ["já viu", { elegivel: false, motivo: "ja_vista" }],
    ["não é segunda", { elegivel: false, motivo: "nao_e_segunda" }],
    ["sem dados", { elegivel: false, motivo: "sem_dados" }],
  ])("não elegível (%s) não vira animação", (_nome, resposta) => {
    expect(mapearResumo(resposta)).toBeNull();
  });

  it("sem a semana anterior, entrega sem comparação em vez de inventar uma", () => {
    const { anterior: _anterior, ...semAnterior } = entrega;
    expect(mapearResumo(semAnterior)?.anterior).toBeUndefined();
  });

  it("semana anterior incompleta também vira sem comparação", () => {
    expect(mapearResumo({ ...entrega, anterior: { leads: 2, vendas: 1 } })?.anterior).toBeUndefined();
  });

  it.each([
    ["resposta nula", null],
    ["texto", "ok"],
    ["lista", []],
    ["leads como texto", { ...entrega, leads: "5" }],
    ["valor negativo", { ...entrega, receita: -1 }],
    ["valor infinito", { ...entrega, vendas: Infinity }],
    ["data inválida", { ...entrega, inicio: "25/10/2027" }],
    ["data inexistente", { ...entrega, fim: "2027-13-45" }],
    ["por dia sem domingo", { ...entrega, por_dia: { ...entrega.por_dia, leads: [1, 2, 3, 4, 5, 6] } }],
    ["por dia com texto", { ...entrega, por_dia: { ...entrega.por_dia, vendas: [0, 1, 0, 1, 0, 0, "1"] } }],
    ["sem por_dia", { ...entrega, por_dia: undefined }],
  ])("resposta malformada (%s) vira null, nunca exceção", (_nome, resposta) => {
    expect(() => mapearResumo(resposta)).not.toThrow();
    expect(mapearResumo(resposta)).toBeNull();
  });
});

describe("rotuloDoPeriodo", () => {
  it("atravessa a virada de mês", () => {
    expect(rotuloDoPeriodo("2027-10-27", "2027-11-02")).toBe("27 de out. a 2 de nov.");
  });

  it("lê a data como dia do calendário: o fuso do aparelho não a empurra para o dia anterior", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(rotuloDoPeriodo("2027-11-01", "2027-11-07")).toBe("1 de nov. a 7 de nov.");
    } finally {
      process.env.TZ = original;
    }
  });

  it("data inválida não vira rótulo", () => {
    expect(rotuloDoPeriodo("amanhã", "2027-11-07")).toBeNull();
    expect(rotuloDoPeriodo(undefined, undefined)).toBeNull();
  });
});
