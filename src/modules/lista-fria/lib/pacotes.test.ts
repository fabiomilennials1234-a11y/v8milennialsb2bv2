import { describe, expect, it } from "vitest";

import {
  CHAMADO_OUTRO,
  PACOTES,
  PACOTES_GOOGLE,
  PACOTES_META,
  centavosPorCredito,
  chamadoDePagamento,
  chamadoDePedido,
  formatarReais,
  formatarReaisPorCredito,
  precoDoPacote,
} from "./pacotes";

// O Intl do pt-BR separa "R$" do número com espaço sem quebra (U+00A0).
const normaliza = (s: string) => s.replace(/\u00a0/g, " ");

describe("pacotes", () => {
  it("são seis: três Google (Maps, CNPJ) e três Meta (Instagram), com 100, 500 e 1.000 créditos", () => {
    expect(PACOTES).toHaveLength(6);
    expect(PACOTES_GOOGLE.map((p) => [p.nome, p.creditos, p.tipo])).toEqual([
      ["Google", 100, "normal"],
      ["Google +", 500, "normal"],
      ["Google Max", 1000, "normal"],
    ]);
    expect(PACOTES_META.map((p) => [p.nome, p.creditos, p.tipo])).toEqual([
      ["Meta", 100, "meta"],
      ["Meta +", 500, "meta"],
      ["Meta Max", 1000, "meta"],
    ]);
    expect(new Set(PACOTES.map((p) => p.id)).size).toBe(6);
  });

  it("os preços batem com o preço de lista (R$ 0,15 nos dois créditos, ADR-0046) e os descontos de 5% e 10%, em centavos inteiros", () => {
    const preco = Object.fromEntries(PACOTES.map((p) => [p.id, precoDoPacote(p)]));
    expect(preco).toEqual({
      google: 1500, //   100 × 0,15
      google_plus: 7125, // 500 × 0,15 × 0,95
      google_max: 13500, // 1000 × 0,15 × 0,90
      meta: 1500, //     100 × 0,15
      meta_plus: 7125, // 500 × 0,15 × 0,95
      meta_max: 13500, // 1000 × 0,15 × 0,90
    });
    expect(Object.values(preco).every(Number.isInteger)).toBe(true);
  });

  it("o desconto é só 5% no + e 10% no Max, e só o + é o mais comprado (nos dois tipos)", () => {
    expect(PACOTES.map((p) => [p.id, p.descontoPct, p.maisComprado])).toEqual([
      ["google", 0, false],
      ["google_plus", 5, true],
      ["google_max", 10, false],
      ["meta", 0, false],
      ["meta_plus", 5, true],
      ["meta_max", 10, false],
    ]);
  });

  it("o preço por crédito cai com o desconto", () => {
    const [g, gPlus, gMax] = PACOTES_GOOGLE.map(centavosPorCredito);
    expect([g, gPlus, gMax]).toEqual([15, 14.25, 13.5]);
    expect(PACOTES_META.map(centavosPorCredito)).toEqual([15, 14.25, 13.5]);
  });

  it("formata em reais", () => {
    expect(normaliza(formatarReais(7125))).toBe("R$ 71,25");
    expect(normaliza(formatarReais(13500))).toBe("R$ 135,00");
    expect(normaliza(formatarReaisPorCredito(14.25))).toBe("R$ 0,1425");
    expect(normaliza(formatarReaisPorCredito(15))).toBe("R$ 0,15");
  });
});

describe("textos dos chamados", () => {
  it('"Outro": pedido pronto, como solicitação e sem urgência', () => {
    expect(CHAMADO_OUTRO).toEqual({
      title: "Quero adquirir créditos",
      description: "Quero adquirir créditos.",
      tipo: "solicitacao",
      impacto: "incomodo",
    });
  });

  it('"Já paguei": leva pacote, créditos, valor e referência para o time conferir', () => {
    const p = PACOTES.find((x) => x.id === "meta_plus")!;
    const c = chamadoDePagamento(p, "LF123ABCD");
    expect(c.title).toBe("Paguei o pacote Meta + (500 créditos)");
    expect(c.tipo).toBe("solicitacao");
    expect(normaliza(c.description)).toContain("Valor pago: R$ 71,25");
    expect(c.description).toContain("Créditos: 500 Meta");
    expect(c.description).toContain("Referência do PIX: LF123ABCD");
  });

  it("sem PIX configurado, o pedido não afirma que houve pagamento", () => {
    const c = chamadoDePedido(PACOTES[0]);
    expect(c.title).toBe("Quero adquirir o pacote Google (100 créditos)");
    expect(c.description).not.toMatch(/paguei|pagamento/i);
    expect(c.tipo).toBe("solicitacao");
  });

  it("o título cabe no limite do chamado (200)", () => {
    for (const p of PACOTES) {
      expect(chamadoDePagamento(p, "X").title.length).toBeLessThanOrEqual(200);
      expect(chamadoDePedido(p).title.length).toBeLessThanOrEqual(200);
    }
  });
});
