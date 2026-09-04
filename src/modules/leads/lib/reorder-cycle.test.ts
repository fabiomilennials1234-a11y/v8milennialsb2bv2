/**
 * O ciclo de recompra decide duas coisas visíveis: o que vai escrito no anel e
 * se a linha inteira esverdeia. As duas erram silenciosamente — uma média torta
 * não quebra a tela, só manda o vendedor ligar na semana errada. Daí os testes
 * ficarem na função pura, com `agora` injetado: `sold_at` é carimbado pelo
 * servidor e imutável por trigger, então não há como forjar a borda em prod.
 */
import { describe, it, expect } from "vitest";

import { calcularCicloDeRecompra, JANELA_DE_RECOMPRA_DIAS } from "./reorder-cycle";

const DIA = 86_400_000;
const HOJE = Date.parse("2026-09-04T12:00:00Z");

/** Data de N dias atrás, em ISO. */
const diasAtras = (n: number) => new Date(HOJE - n * DIA).toISOString();

describe("calcularCicloDeRecompra — os três estados", () => {
  it("sem nenhuma compra diz 'Sem compra' e não pinta nada", () => {
    const c = calcularCicloDeRecompra([], HOJE);
    expect(c.estado).toBe("sem-compra");
    expect(c.rotulo).toBe("Sem compra");
    expect(c.emEpoca).toBe(false);
    expect(c.mediaDias).toBeNull();
  });

  it("com UMA compra diz 'Sem informações' — não há intervalo a medir", () => {
    const c = calcularCicloDeRecompra([diasAtras(30)], HOJE);
    expect(c.estado).toBe("uma-compra");
    expect(c.rotulo).toBe("Sem informações");
    expect(c.mediaDias).toBeNull();
    expect(c.diasDesdeUltima).toBe(30);
    expect(c.emEpoca).toBe(false);
  });

  it("com duas compras devolve a média em dias, no formato do anel", () => {
    const c = calcularCicloDeRecompra([diasAtras(90), diasAtras(45)], HOJE);
    expect(c.estado).toBe("com-ciclo");
    expect(c.mediaDias).toBe(45);
    expect(c.rotulo).toBe("45D");
  });

  it("média é o vão total dividido pelos intervalos, não a última distância", () => {
    // 120 → 60 → 0 dias atrás: intervalos de 60 e 60.
    const c = calcularCicloDeRecompra([diasAtras(120), diasAtras(60), diasAtras(0)], HOJE);
    expect(c.compras).toBe(3);
    expect(c.mediaDias).toBe(60);
  });
});

describe("mesma compra nas duas fontes", () => {
  it("colapsa por dia — senão a média despenca pela metade", () => {
    // Fechou no funil e virou pedido no MESMO dia, duas vezes.
    const c = calcularCicloDeRecompra(
      [
        "2026-05-04T09:00:00Z",
        "2026-05-04T18:30:00Z",
        "2026-07-03T10:00:00Z",
        "2026-07-03T21:00:00Z",
      ],
      HOJE,
    );
    expect(c.compras).toBe(2);
    expect(c.mediaDias).toBe(60);
  });
});

describe("época de recompra — o verde da linha", () => {
  it("acende quando faltam exatamente 7 dias", () => {
    // Ciclo de 60 dias, última compra há 53 → faltam 7.
    const c = calcularCicloDeRecompra([diasAtras(113), diasAtras(53)], HOJE);
    expect(c.mediaDias).toBe(60);
    expect(c.diasRestantes).toBe(JANELA_DE_RECOMPRA_DIAS);
    expect(c.emEpoca).toBe(true);
  });

  it("continua apagado com 8 dias pela frente", () => {
    const c = calcularCicloDeRecompra([diasAtras(112), diasAtras(52)], HOJE);
    expect(c.diasRestantes).toBe(8);
    expect(c.emEpoca).toBe(false);
  });

  it("SEGUE aceso depois de vencer — atrasado é quem mais precisa de contato", () => {
    // Ciclo de 30 dias, última compra há 200 → atrasado em 170.
    const c = calcularCicloDeRecompra([diasAtras(230), diasAtras(200)], HOJE);
    expect(c.diasRestantes).toBeLessThan(0);
    expect(c.emEpoca).toBe(true);
    expect(c.progresso).toBe(1);
  });
});

describe("progresso do anel", () => {
  it("vai de 0 a 1 conforme os dias passam e satura no vencimento", () => {
    const recem = calcularCicloDeRecompra([diasAtras(60), diasAtras(0)], HOJE);
    expect(recem.progresso).toBe(0);

    const meio = calcularCicloDeRecompra([diasAtras(90), diasAtras(30)], HOJE);
    expect(meio.progresso).toBeCloseTo(0.5, 2);

    const vencido = calcularCicloDeRecompra([diasAtras(90), diasAtras(61)], HOJE);
    expect(vencido.progresso).toBe(1);
  });
});

describe("entrada suja não derruba a lista", () => {
  it("ignora nulo, vazio e data impossível", () => {
    const c = calcularCicloDeRecompra(
      [null, undefined, "", "não é data", diasAtras(40), diasAtras(20)],
      HOJE,
    );
    expect(c.estado).toBe("com-ciclo");
    expect(c.compras).toBe(2);
    expect(c.mediaDias).toBe(20);
  });

  it("duas compras no mesmo dia não viram ciclo de zero dia", () => {
    const c = calcularCicloDeRecompra(["2026-09-01T08:00:00Z", "2026-09-01T20:00:00Z"], HOJE);
    expect(c.estado).toBe("uma-compra");
  });

  it("compras em dias seguidos dão média de 1 dia, nunca 0", () => {
    const c = calcularCicloDeRecompra([diasAtras(2), diasAtras(1)], HOJE);
    expect(c.mediaDias).toBe(1);
  });
});
