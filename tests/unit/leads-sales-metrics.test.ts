import { describe, it, expect } from "vitest";
import {
  computeSalesMetrics,
  type SaleEventRow,
} from "@/modules/leads/hooks/useLeadsSalesMetrics";

/**
 * Métricas de venda do lead, a partir de `sale_events`.
 *
 * O teste mora aqui porque **não dá para testar pela borda**: `sale_events` é
 * append-only com carimbo de servidor — `trg_sale_events_force_sold_at` força
 * `sold_at = now()` no INSERT e `trg_sale_events_immutable` bloqueia UPDATE e
 * DELETE. Não existe como semear uma venda de 12 dias atrás para conferir o
 * ciclo na tela; tentar isso foi o que revelou os dois triggers.
 */

const DIA = 86_400_000;
const AGORA = Date.parse("2026-07-30T12:00:00.000Z");
const emDias = (n: number) => new Date(AGORA - n * DIA).toISOString();

function venda(over: Partial<SaleEventRow> & { id: string; sold_at: string }): SaleEventRow {
  return {
    lead_id: "lead-1",
    event_type: "sale",
    sale_value: 1000,
    reversed_event_id: null,
    ...over,
  };
}

describe("computeSalesMetrics", () => {
  it("lead sem evento não aparece no mapa", () => {
    expect(computeSalesMetrics([], AGORA)).toEqual({});
  });

  it("primeira venda deixa o ciclo nulo — é o estado 'calculando' da tela", () => {
    const m = computeSalesMetrics([venda({ id: "a", sold_at: emDias(3) })], AGORA);
    expect(m["lead-1"].saleCount).toBe(1);
    expect(m["lead-1"].cycleDays).toBeNull();
    expect(m["lead-1"].daysSinceLastSale).toBe(3);
  });

  it("segunda venda passa a medir o intervalo entre as datas", () => {
    const m = computeSalesMetrics(
      [venda({ id: "a", sold_at: emDias(40) }), venda({ id: "b", sold_at: emDias(10) })],
      AGORA,
    );
    expect(m["lead-1"].saleCount).toBe(2);
    expect(m["lead-1"].cycleDays).toBe(30);
    expect(m["lead-1"].daysSinceLastSale).toBe(10);
  });

  it("ciclo zero é valor legítimo, não ausência", () => {
    // Duas vendas no mesmo dia. A tela testa `!== null` justamente por isto —
    // testar por verdade mostraria "calculando" para sempre neste caso.
    const m = computeSalesMetrics(
      [venda({ id: "a", sold_at: emDias(1) }), venda({ id: "b", sold_at: emDias(1) })],
      AGORA,
    );
    expect(m["lead-1"].cycleDays).toBe(0);
    expect(m["lead-1"].saleCount).toBe(2);
  });

  it("com 3+ vendas o ciclo é o intervalo médio", () => {
    const m = computeSalesMetrics(
      [
        venda({ id: "a", sold_at: emDias(60) }),
        venda({ id: "b", sold_at: emDias(40) }),
        venda({ id: "c", sold_at: emDias(0) }),
      ],
      AGORA,
    );
    expect(m["lead-1"].cycleDays).toBe(30); // 60 dias de span / 2 intervalos
  });

  it("ordem de chegada não importa — ordena por data antes de medir", () => {
    const fora = computeSalesMetrics(
      [venda({ id: "b", sold_at: emDias(10) }), venda({ id: "a", sold_at: emDias(40) })],
      AGORA,
    );
    expect(fora["lead-1"].cycleDays).toBe(30);
    expect(fora["lead-1"].daysSinceLastSale).toBe(10);
  });

  it("venda estornada não conta nem soma", () => {
    // `sale_events_reversal_coherence` garante que o estorno é a linha com
    // event_type='sale_reversed' E reversed_event_id apontando a venda.
    const m = computeSalesMetrics(
      [
        venda({ id: "a", sold_at: emDias(20), sale_value: 5000 }),
        venda({ id: "b", sold_at: emDias(5), sale_value: 3000 }),
        {
          id: "estorno",
          lead_id: "lead-1",
          event_type: "sale_reversed",
          sale_value: 5000,
          sold_at: emDias(1),
          reversed_event_id: "a",
        },
      ],
      AGORA,
    );
    expect(m["lead-1"].saleCount).toBe(1);
    expect(m["lead-1"].totalValue).toBe(3000);
    // Sobrando uma venda só, volta a não haver intervalo a medir.
    expect(m["lead-1"].cycleDays).toBeNull();
  });

  it("'sale_lost' não é venda", () => {
    const m = computeSalesMetrics(
      [
        venda({ id: "a", sold_at: emDias(4) }),
        { ...venda({ id: "b", sold_at: emDias(2) }), event_type: "sale_lost" },
      ],
      AGORA,
    );
    expect(m["lead-1"].saleCount).toBe(1);
  });

  it("venda sem valor conta como compra, mas não dilui o ticket médio", () => {
    // Caso real do teste do CTO: ganhar no funil de qualificação grava evento
    // sem `sale_value`. Se entrasse na média, um ganho sem valor cortaria o
    // ticket pela metade e o número na tela viraria ficção.
    const m = computeSalesMetrics(
      [
        venda({ id: "a", sold_at: emDias(2), sale_value: null }),
        venda({ id: "b", sold_at: emDias(1), sale_value: 10000 }),
      ],
      AGORA,
    );
    expect(m["lead-1"].saleCount).toBe(2);
    expect(m["lead-1"].totalValue).toBe(10000);
    expect(m["lead-1"].avgTicket).toBe(10000);
  });

  it("valor em string (numeric do Postgres) é somado como número", () => {
    const m = computeSalesMetrics(
      [venda({ id: "a", sold_at: emDias(1), sale_value: "2500.50" })],
      AGORA,
    );
    expect(m["lead-1"].totalValue).toBeCloseTo(2500.5);
  });

  it("separa leads diferentes", () => {
    const m = computeSalesMetrics(
      [
        venda({ id: "a", sold_at: emDias(5) }),
        { ...venda({ id: "b", sold_at: emDias(5) }), lead_id: "lead-2" },
      ],
      AGORA,
    );
    expect(Object.keys(m).sort()).toEqual(["lead-1", "lead-2"]);
  });

  it("linha sem lead ou sem data é ignorada, não quebra o lote", () => {
    const m = computeSalesMetrics(
      [
        { ...venda({ id: "a", sold_at: emDias(1) }), lead_id: null },
        { ...venda({ id: "b", sold_at: "" }), sold_at: null },
        venda({ id: "c", sold_at: emDias(2) }),
      ],
      AGORA,
    );
    expect(Object.keys(m)).toEqual(["lead-1"]);
    expect(m["lead-1"].saleCount).toBe(1);
  });
});
