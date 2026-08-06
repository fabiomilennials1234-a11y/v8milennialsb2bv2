/**
 * `mergeDataMetrics` — a regra de precedência entre venda de funil e pedido de ERP.
 *
 * ── O DEFEITO QUE ISTO IMPEDE ─────────────────────────────────────────────
 * As duas fontes contam a MESMA compra por caminhos diferentes: `sale_events`
 * grava o negócio ganho aqui dentro; `upsell_clients` recebe o pedido pelo
 * ERP (`tinyerp-*`, `erp-order-webhook`). Nas **13 organizações que têm ERP**
 * somar as duas dobraria o número na cara do vendedor — R$ 5.000 de pedido
 * viram R$ 10.000 de "já comprou". A regra é precedência: a venda do funil
 * vence, e a carteira só responde quando não há venda no funil.
 *
 * ── POR QUE UM TESTE, E AQUI ──────────────────────────────────────────────
 * A regra nasceu num `useMemo` dentro de `Leads.tsx`. A ADR-0024 §1 tirou o
 * cluster "Dados" da lista e o levou para o drawer — dois lugares passando a
 * precisar do mesmo número. Copiar o `useMemo` teria criado duas verdades
 * livres para divergir no primeiro ajuste, então a regra virou função pura
 * (`src/modules/leads/lib/data-metrics.ts`). Função pura sem teste é só um
 * arquivo novo: o que trava a soma é a asserção abaixo, não a extração.
 *
 * Os casos que importam são de PRECEDÊNCIA e de AUSÊNCIA — quem vence, o que
 * sobrevive à derrota (`segment`), e o que acontece quando a venda deixa de
 * existir (estorno). Não é teste de formatação.
 */

import { describe, it, expect } from "vitest";

import { mergeDataMetrics } from "@/modules/leads/lib/data-metrics";
import type { LeadCarteiraMetrics } from "@/modules/leads/hooks/useLeadsCarteiraMetrics";
import {
  computeSalesMetrics,
  type LeadSalesMetrics,
  type SaleEventRow,
} from "@/modules/leads/hooks/useLeadsSalesMetrics";

function carteira(over: Partial<LeadCarteiraMetrics> = {}): LeadCarteiraMetrics {
  return {
    leadId: "lead-1",
    lifetimeValue: 5000,
    avgTicket: 1250,
    orderCount: 4,
    reorderCycleDays: 60,
    daysSinceLastOrder: 12,
    segment: "ouro",
    ...over,
  };
}

function venda(over: Partial<LeadSalesMetrics> = {}): LeadSalesMetrics {
  return {
    leadId: "lead-1",
    saleCount: 1,
    totalValue: 1200,
    avgTicket: 1200,
    lastSaleAt: "2026-08-01T12:00:00.000Z",
    daysSinceLastSale: 3,
    cycleDays: null,
    ...over,
  };
}

describe("precedência venda-vs-carteira", () => {
  it("venda no funil vence a carteira — e o número NÃO é a soma dos dois", () => {
    const out = mergeDataMetrics({ "lead-1": carteira() }, { "lead-1": venda() });

    expect(out["lead-1"].lifetimeValue).toBe(1200); // não 6200
    expect(out["lead-1"].orderCount).toBe(1); // não 5
    expect(out["lead-1"].avgTicket).toBe(1200); // não 2450
  });

  it("lead sem venda no funil continua mostrando o histórico do ERP", () => {
    // O caso majoritário nas 13 orgs com ERP: 129 leads em prod provam compra
    // só pelo pedido. Se a precedência apagasse a carteira, esses clientes
    // apareceriam zerados.
    const out = mergeDataMetrics({ "lead-1": carteira() }, {});

    expect(out["lead-1"].lifetimeValue).toBe(5000);
    expect(out["lead-1"].orderCount).toBe(4);
  });

  it("o segmento sobrevive à precedência — é rótulo, não número", () => {
    // `segment` (ouro/prata/novo/resgate) só existe na carteira e não tem
    // equivalente em `sale_events`. Perdê-lo junto com os números faria o
    // cliente ouro do ERP virar sem-segmento assim que fechasse uma venda
    // aqui dentro — regressão invisível, porque o dinheiro continuaria certo.
    const out = mergeDataMetrics(
      { "lead-1": carteira({ segment: "ouro" }) },
      { "lead-1": venda() },
    );

    expect(out["lead-1"].segment).toBe("ouro");
    expect(out["lead-1"].lifetimeValue).toBe(1200);
  });

  it("lead com venda e sem linha de carteira não inventa segmento", () => {
    const out = mergeDataMetrics({}, { "lead-1": venda() });

    expect(out["lead-1"].segment).toBeNull();
    expect(out["lead-1"].leadId).toBe("lead-1");
  });

  it("ciclo e recência passam a ser os da VENDA quando ela vence", () => {
    // O drawer usa esses dois para dizer "compra a cada N dias" e "última
    // compra há N dias". Manter os da carteira debaixo do valor da venda
    // produziria uma frase coerente e falsa.
    const out = mergeDataMetrics(
      { "lead-1": carteira({ reorderCycleDays: 60, daysSinceLastOrder: 12 }) },
      { "lead-1": venda({ cycleDays: 21, daysSinceLastSale: 3 }) },
    );

    expect(out["lead-1"].reorderCycleDays).toBe(21);
    expect(out["lead-1"].daysSinceLastOrder).toBe(3);
  });

  it("cada lead decide sozinho — a precedência de um não contamina o vizinho", () => {
    const out = mergeDataMetrics(
      { "lead-1": carteira(), "lead-2": carteira({ leadId: "lead-2", lifetimeValue: 900, orderCount: 2 }) },
      { "lead-1": venda() },
    );

    expect(out["lead-1"].lifetimeValue).toBe(1200);
    expect(out["lead-2"].lifetimeValue).toBe(900);
    expect(out["lead-2"].orderCount).toBe(2);
  });

  it("lead que só existe em vendas entra no resultado", () => {
    const out = mergeDataMetrics({ "lead-1": carteira() }, { "lead-9": venda({ leadId: "lead-9" }) });

    expect(Object.keys(out).sort()).toEqual(["lead-1", "lead-9"]);
  });

  it("nenhuma das duas fontes carregada não vira erro nem mapa fantasma", () => {
    // Estado real do primeiro render: as duas queries ainda em voo.
    expect(mergeDataMetrics(undefined, undefined)).toEqual({});
    expect(mergeDataMetrics(undefined, { "lead-1": venda() })["lead-1"].lifetimeValue).toBe(1200);
    expect(mergeDataMetrics({ "lead-1": carteira() }, undefined)["lead-1"].lifetimeValue).toBe(5000);
  });

  it("o mapa da carteira que entrou não é mutado", () => {
    // Os dois mapas vêm direto do cache do TanStack Query. Escrever neles
    // corromperia o cache para todo mundo que lê a mesma queryKey — e o
    // sintoma apareceria noutra tela, não aqui.
    const origem = { "lead-1": carteira() };
    mergeDataMetrics(origem, { "lead-1": venda() });

    expect(origem["lead-1"].lifetimeValue).toBe(5000);
    expect(origem["lead-1"].orderCount).toBe(4);
  });
});

describe("precedência ponta a ponta com o ledger de vendas", () => {
  const AGORA = Date.parse("2026-08-05T12:00:00.000Z");
  const DIA = 86_400_000;
  const emDias = (n: number) => new Date(AGORA - n * DIA).toISOString();

  function evento(over: Partial<SaleEventRow> & { id: string; sold_at: string }): SaleEventRow {
    return {
      lead_id: "lead-1",
      event_type: "sale",
      sale_value: 1200,
      reversed_event_id: null,
      ...over,
    };
  }

  it("venda estornada devolve o lead para a carteira em vez de zerá-lo", () => {
    // A composição é o ponto: `computeSalesMetrics` não emite lead sem venda
    // líquida, e é isso que impede `mergeDataMetrics` de sobrescrever a
    // carteira com zeros. Se um dia o cálculo passasse a emitir saleCount 0,
    // o cliente de ERP apareceria zerado e ninguém veria — a precedência
    // continuaria "funcionando".
    const vendas = computeSalesMetrics(
      [
        evento({ id: "v1", sold_at: emDias(20) }),
        {
          id: "estorno",
          lead_id: "lead-1",
          event_type: "sale_reversed",
          sale_value: 1200,
          sold_at: emDias(2),
          reversed_event_id: "v1",
        },
      ],
      AGORA,
    );

    expect(vendas["lead-1"]).toBeUndefined();

    const out = mergeDataMetrics({ "lead-1": carteira() }, vendas);
    expect(out["lead-1"].lifetimeValue).toBe(5000);
    expect(out["lead-1"].orderCount).toBe(4);
  });

  it("venda viva no funil cobre a carteira, com o valor líquido do ledger", () => {
    const vendas = computeSalesMetrics(
      [
        evento({ id: "v1", sold_at: emDias(30), sale_value: 4000 }),
        evento({ id: "v2", sold_at: emDias(10), sale_value: 2000 }),
        {
          id: "estorno",
          lead_id: "lead-1",
          event_type: "sale_reversed",
          sale_value: 4000,
          sold_at: emDias(1),
          reversed_event_id: "v1",
        },
      ],
      AGORA,
    );

    const out = mergeDataMetrics({ "lead-1": carteira() }, vendas);
    expect(out["lead-1"].orderCount).toBe(1);
    expect(out["lead-1"].lifetimeValue).toBe(2000); // não 6000, não 7000
    expect(out["lead-1"].segment).toBe("ouro");
  });
});
