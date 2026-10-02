import { describe, expect, it } from "vitest";
import {
  RIOFIX_ORG_ID,
  mostraNegocioNoChat,
  ordenarNegociosDoChat,
  valorDoResumo,
} from "./negocioNoChat";

describe("mostraNegocioNoChat", () => {
  it("libera só para a Riofix", () => {
    expect(mostraNegocioNoChat(RIOFIX_ORG_ID)).toBe(true);
    expect(mostraNegocioNoChat("6030520a-2ca7-477d-be89-55758e2cd808")).toBe(false);
  });
  it("org ausente não libera", () => {
    expect(mostraNegocioNoChat(null)).toBe(false);
    expect(mostraNegocioNoChat(undefined)).toBe(false);
    expect(mostraNegocioNoChat("")).toBe(false);
  });
});

describe("valorDoResumo — mesma ordem do Card do Negócio", () => {
  it("itens mandam, mesmo quando deals.value discorda", () => {
    expect(valorDoResumo({ totalDosItens: 84739, valorDoNegocio: 1000, valorDoFunil: 50 })).toBe(84739);
  });
  it("sem itens, vale deals.value — inclusive zero definido", () => {
    expect(valorDoResumo({ totalDosItens: null, valorDoNegocio: 1200, valorDoFunil: 50 })).toBe(1200);
    expect(valorDoResumo({ totalDosItens: null, valorDoNegocio: 0, valorDoFunil: 50 })).toBe(0);
  });
  it("sem negócio, cai no sale_value do funil; sem nada, null", () => {
    expect(valorDoResumo({ totalDosItens: null, valorDoNegocio: null, valorDoFunil: 300 })).toBe(300);
    expect(valorDoResumo({ totalDosItens: null, valorDoNegocio: null, valorDoFunil: 0 })).toBeNull();
  });
});

describe("ordenarNegociosDoChat", () => {
  it("abertos primeiro, mais recente no topo", () => {
    const lista = [
      { id: "ganho-novo", estado: "ganho" as const, criadoEm: "2026-09-29T00:00:00Z" },
      { id: "aberto-velho", estado: "aberto" as const, criadoEm: "2026-01-01T00:00:00Z" },
      { id: "aberto-novo", estado: "aberto" as const, criadoEm: "2026-09-23T00:00:00Z" },
      { id: "sem-data", estado: "aberto" as const, criadoEm: null },
    ];
    expect(ordenarNegociosDoChat(lista).map((n) => n.id)).toEqual([
      "aberto-novo",
      "aberto-velho",
      "sem-data",
      "ganho-novo",
    ]);
  });
});
