import { describe, expect, it } from "vitest";

import { reais } from "./formato";
import { descreverBaixas, erroDoPagamento, parseBaixas, somaDosSaldos, titulosBaixaveis, titulosSoDoErp } from "./pagamento";
import type { TituloSaldo } from "./tipos";

const titulo = (id: string, extra: Partial<TituloSaldo> = {}): TituloSaldo => ({
  id,
  origem: "manual",
  numero: id,
  descricao: null,
  valor: 100,
  valorPago: 0,
  saldo: 100,
  vencimento: "2026-11-23",
  status: "aberto",
  pagoEm: null,
  ...extra,
});

describe("pagamento por título", () => {
  it("baixa aqui só o que está em aberto, com saldo e fora do ERP", () => {
    const lista = [
      titulo("a"),
      titulo("pago", { status: "pago", saldo: 0, pagoEm: "2026-11-20" }),
      titulo("cancelado", { status: "cancelado", saldo: 0 }),
      titulo("erp", { origem: "erp" }),
      titulo("planilha", { origem: "planilha" }),
    ];
    expect(titulosBaixaveis(lista).map((t) => t.id)).toEqual(["a", "planilha"]);
    expect(titulosSoDoErp(lista)).toBe(1);
  });

  it("soma os saldos marcados em centavos, sem erro de float", () => {
    const lista = [titulo("x", { saldo: 318.98 }), titulo("y", { saldo: 500.81 }), titulo("z", { saldo: 337.33 })];
    expect(somaDosSaldos(lista, new Set(["x", "z"]))).toBe(656.31);
    expect(somaDosSaldos(lista, new Set(["x", "y", "z"]))).toBe(1157.12);
    expect(somaDosSaldos(lista, new Set())).toBe(0);
  });

  it("recusa sem título marcado, sem valor ou acima do saldo marcado", () => {
    expect(erroDoPagamento(100, 0, 0)).toBe("Marque ao menos um título.");
    expect(erroDoPagamento(null, 1, 100)).toBe("Informe o valor recebido.");
    expect(erroDoPagamento(0, 1, 100)).toBe("Informe o valor recebido.");
    // `reais` usa o espaço inseparável do Intl (U+00A0) entre "R$" e o número.
    expect(erroDoPagamento(100.01, 1, 100)).toBe(`Passa do saldo dos títulos marcados (${reais(100)}).`);
    expect(reais(100)).toMatch(/^R\$\s100,00$/);
    expect(erroDoPagamento(100, 1, 100)).toBeUndefined();
    expect(erroDoPagamento(40, 2, 100)).toBeUndefined();
  });

  it("lê as baixas do evento e ignora evento antigo sem a lista", () => {
    expect(parseBaixas(undefined)).toEqual([]);
    expect(parseBaixas("x")).toEqual([]);
    expect(parseBaixas([{ id: "a", numero: "20311.01", valor: "318.98", quitado: true }, null, { id: "b", numero: "", valor: 10 }])).toEqual([
      { id: "a", numero: "20311.01", valor: 318.98, quitado: true },
      { id: "b", numero: null, valor: 10, quitado: false },
    ]);
  });

  it("descreve no histórico quais títulos o pagamento abateu", () => {
    const b = (numero: string | null, quitado = true) => ({ id: numero ?? "-", numero, valor: 1, quitado });
    expect(descreverBaixas([])).toBeNull();
    expect(descreverBaixas([b("20311.01")])).toBe("título 20311.01");
    expect(descreverBaixas([b("20311.01"), b("20311.03")])).toBe("títulos 20311.01 e 20311.03");
    expect(descreverBaixas([b("A"), b("B", false)])).toBe("títulos A e B (parcial)");
    expect(descreverBaixas([b(null)])).toBe("título sem número");
    expect(descreverBaixas([b("A"), b("B"), b("C"), b("D")])).toBe("títulos A, B, C e D");
    expect(descreverBaixas([b("A"), b("B"), b("C"), b("D"), b("E")])).toBe("títulos A, B, C e mais 2");
  });
});
