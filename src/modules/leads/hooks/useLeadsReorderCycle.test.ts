/**
 * A união das duas fontes de compra.
 *
 * `calcularCicloDeRecompra` já é testado com datas prontas; o que se prende
 * aqui é o passo anterior — quais linhas viram data. É onde mora o risco real:
 * contar um `sale_lost` como compra, ou deixar passar uma venda estornada,
 * produz uma média plausível e errada, que ninguém percebe olhando a tela.
 */
import { describe, it, expect } from "vitest";

import { computeReorderCycles } from "./useLeadsReorderCycle";

const DIA = 86_400_000;
const HOJE = Date.parse("2026-09-04T12:00:00Z");
const diasAtras = (n: number) => new Date(HOJE - n * DIA).toISOString();

const LEAD = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

describe("computeReorderCycles — o que conta como compra", () => {
  it("une venda do funil e pedido da carteira no MESMO histórico", () => {
    const r = computeReorderCycles(
      [{ id: "s1", lead_id: LEAD, event_type: "sale", sold_at: diasAtras(120), reversed_event_id: null }],
      [{ leadId: LEAD, sold_at: diasAtras(60) }],
      [LEAD],
      HOJE,
    );
    expect(r[LEAD].estado).toBe("com-ciclo");
    expect(r[LEAD].compras).toBe(2);
    expect(r[LEAD].mediaDias).toBe(60);
  });

  it("ignora venda estornada — a média não pode contar o que foi desfeito", () => {
    const r = computeReorderCycles(
      [
        { id: "s1", lead_id: LEAD, event_type: "sale", sold_at: diasAtras(120), reversed_event_id: null },
        { id: "s2", lead_id: LEAD, event_type: "sale", sold_at: diasAtras(60), reversed_event_id: null },
        // o estorno de s2
        { id: "s3", lead_id: LEAD, event_type: "sale_reversed", sold_at: diasAtras(59), reversed_event_id: "s2" },
      ],
      [],
      [LEAD],
      HOJE,
    );
    expect(r[LEAD].estado).toBe("uma-compra");
  });

  it("`sale_lost` não é compra", () => {
    const r = computeReorderCycles(
      [
        { id: "s1", lead_id: LEAD, event_type: "sale", sold_at: diasAtras(30), reversed_event_id: null },
        { id: "s2", lead_id: LEAD, event_type: "sale_lost", sold_at: diasAtras(10), reversed_event_id: null },
      ],
      [],
      [LEAD],
      HOJE,
    );
    expect(r[LEAD].estado).toBe("uma-compra");
  });

  it("não vaza compra de um lead para outro", () => {
    const r = computeReorderCycles(
      [{ id: "s1", lead_id: OUTRO, event_type: "sale", sold_at: diasAtras(30), reversed_event_id: null }],
      [{ leadId: OUTRO, sold_at: diasAtras(10) }],
      [LEAD, OUTRO],
      HOJE,
    );
    expect(r[LEAD].estado).toBe("sem-compra");
    expect(r[OUTRO].estado).toBe("com-ciclo");
  });

  it("devolve entrada para TODO lead pedido, inclusive quem nunca comprou", () => {
    const r = computeReorderCycles([], [], [LEAD, OUTRO], HOJE);
    // A coluna precisa desenhar alguma coisa em toda linha — sem isto o anel
    // some justamente nas 97% das linhas que nunca compraram.
    expect(Object.keys(r)).toEqual([LEAD, OUTRO]);
    expect(r[LEAD].rotulo).toBe("Sem compra");
  });

  it("pedido sem lead vinculado é descartado sem derrubar o resto", () => {
    const r = computeReorderCycles(
      [{ id: "s1", lead_id: LEAD, event_type: "sale", sold_at: diasAtras(40), reversed_event_id: null }],
      [
        { leadId: null, sold_at: diasAtras(20) },
        { leadId: LEAD, sold_at: diasAtras(20) },
      ],
      [LEAD],
      HOJE,
    );
    expect(r[LEAD].compras).toBe(2);
    expect(r[LEAD].mediaDias).toBe(20);
  });
});
