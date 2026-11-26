import { describe, expect, it } from "vitest";
import { ERP_SITUACAO_NAO_INFORMADA, erpSituacao, erpSituacaoResumo } from "./erp-situacao";

describe("erpSituacao", () => {
  it("traduz o código do Toth com a legenda da ficha", () => {
    expect(erpSituacao("0")).toEqual({ code: "0", label: "Ativo", tone: "good" });
    expect(erpSituacao("1")).toEqual({ code: "1", label: "Inativo", tone: "neutral" });
    expect(erpSituacao("2")).toEqual({ code: "2", label: "Bloqueado", tone: "bad" });
    expect(erpSituacao(" 3 ")).toEqual({ code: "3", label: "Inconsistente", tone: "warn" });
  });

  it("código sem legenda aparece como veio; vazio não vira selo", () => {
    expect(erpSituacao("7")).toEqual({ code: "7", label: "Situação 7", tone: "neutral" });
    expect(erpSituacao("")).toBeNull();
    expect(erpSituacao(null)).toBeNull();
    expect(erpSituacao(undefined)).toBeNull();
  });
});

describe("erpSituacaoResumo", () => {
  const of = (...codes: (string | null)[]) => codes.map(erpSituacao);

  it("conta por situação, na ordem da legenda, com plural", () => {
    expect(erpSituacaoResumo(of("1", "0", "1", "2", null, "0", "1"))).toBe("2 ativos · 3 inativos · 1 bloqueado");
  });

  it("singular, código desconhecido e 'sem situação' no fim", () => {
    expect(erpSituacaoResumo([...of("9", "3"), ERP_SITUACAO_NAO_INFORMADA, ERP_SITUACAO_NAO_INFORMADA])).toBe(
      "1 inconsistente · 1 situação 9 · 2 sem situação",
    );
  });

  it("sem nenhuma situação, sem resumo", () => {
    expect(erpSituacaoResumo([null, undefined])).toBeNull();
    expect(erpSituacaoResumo([])).toBeNull();
  });
});
