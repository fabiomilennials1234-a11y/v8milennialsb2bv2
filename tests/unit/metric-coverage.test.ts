import { describe, it, expect } from "vitest";
import { coberturaDaMedida } from "@/modules/analytics/hooks/useMetricWindowData";
import type { MetricMeasureResult } from "@/modules/analytics/hooks/useMetricMeasure";

/**
 * SCRUM-545 fatia 2 — a cobertura das medidas de dinheiro do funil.
 *
 * POR QUE ISTO É TESTADO E NÃO SÓ ESCRITO
 *
 * `deals.value` está preenchido em 0,88% dos negócios em prod. Uma janela
 * "Valor parado na etapa" que mostre R$ 15.924,21 numa org com 4.093 negócios
 * está dizendo o valor de treze cards, e vai ser lida como o funil inteiro.
 *
 * O aviso de cobertura é o que separa as duas leituras. Ele só funciona se o
 * caso de borda certo cair do lado certo — e o caso de borda aqui é ZERO, que
 * em JavaScript é falsy e por isso some de qualquer checagem escrita com `!`
 * ou `||`. Zero negócios com valor é exatamente quando o aviso mais importa.
 */

function medida(over: Partial<MetricMeasureResult>): MetricMeasureResult {
  return {
    kind: "leaf",
    unit: "currency",
    currency: "BRL",
    anchor: "hoje",
    value: 0,
    series: null,
    empty_reason: null,
    ...over,
  };
}

describe("coberturaDaMedida", () => {
  it("é null quando a medida não devolve cobertura", () => {
    // A maioria das medidas. Ausência é "não se aplica", nunca "100%".
    expect(coberturaDaMedida(medida({}))).toBeNull();
    expect(coberturaDaMedida(null)).toBeNull();
  });

  it("é null quando só UMA das duas chaves veio", () => {
    // Meia cobertura não é cobertura: sem o par, o denominador é invenção.
    expect(coberturaDaMedida(medida({ coverage_total: 100 }))).toBeNull();
    expect(coberturaDaMedida(medida({ coverage_com_valor: 3 }))).toBeNull();
  });

  it("🔴 ZERO com valor é cobertura de 0%, não ausência de cobertura", () => {
    // O caso que uma checagem por truthiness perderia — e é o pior de todos:
    // nenhum negócio com valor, número R$ 0,00, e sem aviso o usuário conclui
    // que o funil está vazio em vez de que ninguém lançou valor.
    const c = coberturaDaMedida(medida({ coverage_total: 4093, coverage_com_valor: 0 }));
    expect(c).not.toBeNull();
    expect(c!.percentual).toBe(0);
    expect(c!.parcial).toBe(true);
  });

  it("marca parcial abaixo de 80%", () => {
    const c = coberturaDaMedida(medida({ coverage_total: 4093, coverage_com_valor: 13 }))!;
    expect(c.comValor).toBe(13);
    expect(c.total).toBe(4093);
    expect(c.percentual).toBeCloseTo(0.318, 2);
    expect(c.parcial).toBe(true);
  });

  it("não marca parcial em cobertura cheia", () => {
    const c = coberturaDaMedida(medida({ coverage_total: 50, coverage_com_valor: 50 }))!;
    expect(c.percentual).toBe(100);
    expect(c.parcial).toBe(false);
  });

  it("a fronteira dos 80% não é parcial", () => {
    const c = coberturaDaMedida(medida({ coverage_total: 10, coverage_com_valor: 8 }))!;
    expect(c.percentual).toBe(80);
    expect(c.parcial).toBe(false);
  });

  it("org sem negócio nenhum não vira divisão por zero", () => {
    const c = coberturaDaMedida(medida({ coverage_total: 0, coverage_com_valor: 0 }))!;
    expect(c.percentual).toBe(0);
    // Sem negócio, a janela já está vazia por outro caminho — avisar
    // "valor em 0 de 0" seria ruído sobre uma tela que não afirma nada.
    expect(c.parcial).toBe(false);
  });
});
