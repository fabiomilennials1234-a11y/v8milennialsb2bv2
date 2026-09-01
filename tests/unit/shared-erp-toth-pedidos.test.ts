/**
 * Tests for the Toth `/pedidos` mapper and the client-recency plumbing that came
 * with it.
 *
 * A fixture de pedido é o retorno REAL que o fornecedor mandou em 2026-08-25,
 * com os documentos trocados. Os valores são os dele — inclusive o pedido cuja
 * soma dos itens bate ao centavo com `valortotalliquido`, que é o fato que
 * autoriza usar a soma como recuo.
 */
import { describe, it, expect } from "vitest";
import {
  mapTothPedidoToCanonical,
  mapTothPedidoItens,
  describePedidoItems,
  extractHasNext,
  extractRows,
  mapTothClienteToCanonical,
  TothMappingError,
} from "../../supabase/functions/_shared/erp/toth-mappers";
import {
  clientEnrichmentColumns,
  erpDateToTimestamp,
  seedLastOrderAt,
} from "../../supabase/functions/_shared/erp/sync/client-enrichment";
import {
  approvalForErpStatus,
  upsertCanonicalOrder,
  type OrderStore,
} from "../../supabase/functions/_shared/erp/sync/upsert-order";
import type { CanonicalOrder } from "../../supabase/functions/_shared/erp/types";

/** Forma real de uma página de `/pedidos` — nomes em caixa baixa colada. */
const PAGINA_REAL = {
  data: [
    {
      numeropedido: "19400",
      dataemissao: "2026-07-29T00:00:00.000Z",
      numeroinscricao: "67964429000501",
      valortotalliquido: 884.4,
      statuspedido: "NORMAL",
      itens: [
        {
          codigoproduto: "3686",
          descricaoproduto: "DRIP COFFEE BAG JURERE GOURMET 100G ",
          qtdpedido: 6,
          valorunitario: 19.9,
        },
        {
          codigoproduto: "5739",
          descricaoproduto: "Linha Gerações- Café Da Cheli- Torrado Em Grãos 250g",
          qtdpedido: 12,
          valorunitario: 26.9,
        },
        {
          codigoproduto: "922",
          descricaoproduto: "DRIP COFFEE BAG JURERE SUPERIOR 100G ",
          qtdpedido: 6,
          valorunitario: 19.9,
        },
        {
          codigoproduto: "5743",
          descricaoproduto: "Linha Gerações- Café Da Vó Damázia- Torrado Em Grãos 250g",
          qtdpedido: 12,
          valorunitario: 26.9,
        },
      ],
    },
    {
      numeropedido: "20066",
      dataemissao: "2026-06-05T00:00:00.000Z",
      numeroinscricao: "48359453000135",
      valortotalliquido: 500,
      statuspedido: "FATURADO",
      itens: [
        {
          codigoproduto: "906",
          descricaoproduto: "CAFÉ JURERE TRADICIONAL VÁCUO 500G",
          qtdpedido: 25,
          valorunitario: 20,
        },
      ],
    },
  ],
  page: 1,
  hasNext: true,
};

describe("mapTothPedidoToCanonical", () => {
  it("lê a página real: envelope `data`, chaves em caixa baixa, itens dentro", () => {
    const rows = extractRows(PAGINA_REAL);
    expect(rows).toHaveLength(2);

    const pedido = mapTothPedidoToCanonical(rows[0]);
    expect(pedido.externalId).toBe("19400");
    expect(pedido.saleValue).toBe(884.4);
    expect(pedido.erpStatus).toBe("NORMAL");
    expect(pedido.items).toHaveLength(4);
  });

  it("resolve o cliente pelo DOCUMENTO, porque o pedido não traz codigoCliente", () => {
    const pedido = mapTothPedidoToCanonical(extractRows(PAGINA_REAL)[0]);
    expect(pedido.clientExternalId).toBeNull();
    expect(pedido.clientCnpj).toBe("67964429000501");
  });

  it("emite ao MEIO-DIA UTC — meia-noite mostraria o pedido no dia anterior em Brasília", () => {
    const pedido = mapTothPedidoToCanonical(extractRows(PAGINA_REAL)[0]);
    expect(pedido.soldAt).toBe("2026-07-29T12:00:00.000Z");
    // A data lida em horário de Brasília continua sendo o dia 29.
    const emBrasilia = new Date(pedido.soldAt as string).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    expect(emBrasilia).toBe("29/07/2026");
  });

  it("prefere o total do ERP, e a soma dos itens bate com ele na amostra real", () => {
    const row = extractRows(PAGINA_REAL)[0];
    const pedido = mapTothPedidoToCanonical(row);
    const soma = (pedido.items ?? []).reduce((acc, i) => acc + i.totalValue, 0);
    expect(soma).toBeCloseTo(884.4, 2);
    expect(pedido.saleValue).toBe(884.4);
  });

  it("cai para a soma dos itens quando o ERP não manda total", () => {
    const { valortotalliquido: _drop, ...semTotal } = PAGINA_REAL.data[1] as Record<string, unknown>;
    const pedido = mapTothPedidoToCanonical(semTotal);
    expect(pedido.saleValue).toBe(500);
  });

  it("recusa pedido sem número — sem chave de idempotência, duplicaria a cada volta", () => {
    expect(() => mapTothPedidoToCanonical({ dataemissao: "2026-01-01" })).toThrow(TothMappingError);
  });

  it("aceita camelCase também: `pickField` normaliza a chave", () => {
    const pedido = mapTothPedidoToCanonical({
      numeroPedido: "77",
      dataEmissao: "2026-03-04T00:00:00.000Z",
      numeroInscricao: "12345678000199",
      valorTotalLiquido: 10,
      statusPedido: "FATURADO",
      itens: [],
    });
    expect(pedido.externalId).toBe("77");
    expect(pedido.erpStatus).toBe("FATURADO");
  });
});

describe("mapTothPedidoItens", () => {
  it("arredonda quantidade × unitário a 2 casas (6 × 19.9 dá 119.39999999999999)", () => {
    const [item] = mapTothPedidoItens([
      { codigoproduto: "3686", descricaoproduto: "X", qtdpedido: 6, valorunitario: 19.9 },
    ]);
    expect(item.totalValue).toBe(119.4);
  });

  it("apara o espaço à direita que o cadastro do Toth carrega", () => {
    const [item] = mapTothPedidoItens([
      { codigoproduto: "1", descricaoproduto: "DRIP COFFEE BAG JURERE GOURMET 100G ", qtdpedido: 1 },
    ]);
    expect(item.description).toBe("DRIP COFFEE BAG JURERE GOURMET 100G");
  });

  it("devolve lista vazia quando não há itens, em vez de estourar", () => {
    expect(mapTothPedidoItens(undefined)).toEqual([]);
    expect(mapTothPedidoItens("nada")).toEqual([]);
  });
});

describe("describePedidoItems", () => {
  it("mostra o primeiro produto e quantos mais — a coluna comporta um nome", () => {
    const itens = mapTothPedidoItens(PAGINA_REAL.data[0].itens);
    expect(describePedidoItems(itens, "19400")).toBe(
      "DRIP COFFEE BAG JURERE GOURMET 100G +3",
    );
  });

  it("cai para o número do pedido quando não há descrição nenhuma", () => {
    expect(describePedidoItems([], "19400")).toBe("Pedido 19400");
  });
});

describe("extractHasNext", () => {
  it("lê o sinal de paginação da resposta real", () => {
    expect(extractHasNext(PAGINA_REAL)).toBe(true);
    expect(extractHasNext({ ...PAGINA_REAL, hasNext: false })).toBe(false);
  });

  it("devolve null quando o ERP não diz — silêncio não é fim de lista", () => {
    expect(extractHasNext({ data: [] })).toBeNull();
    expect(extractHasNext([])).toBeNull();
  });
});

describe("approvalForErpStatus", () => {
  it("só FATURADO conta como receita", () => {
    expect(approvalForErpStatus("FATURADO")).toBe("approved");
    expect(approvalForErpStatus("NORMAL")).toBe("pending");
  });

  /**
   * Este caso mudou de propósito em 01/09, por decisão do CTO. Antes
   * `CANCELADO` caía em `pending` — o balde de "tudo que não é faturado" — e
   * ficava lá para sempre, aparecendo na ficha do cliente como carteira em
   * formação. Com o enum completo em mãos (o fornecedor mandou o fonte) e a
   * medição de que cancelado é **22% do volume** (122 de 554 pedidos entre
   * junho e agosto), pendurar um quinto da base em "quase vendeu" deixou de ser
   * defensável: cancelado e devolvido são desfechos, não etapas.
   */
  it("CANCELADO e DEVOLVIDO são desfecho, não pendência", () => {
    expect(approvalForErpStatus("CANCELADO")).toBe("rejected");
    expect(approvalForErpStatus("DEVOLVIDO")).toBe("rejected");
  });

  it("provider sem situação segue aprovado, como sempre foi", () => {
    expect(approvalForErpStatus(null)).toBe("approved");
    expect(approvalForErpStatus(undefined)).toBe("approved");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// upsert de pedido: recuo por CNPJ e itens
// ─────────────────────────────────────────────────────────────────────────────

const PEDIDO: CanonicalOrder = {
  externalId: "19400",
  externalRef: null,
  clientExternalId: null,
  clientCnpj: "67964429000501",
  saleValue: 884.4,
  productName: "DRIP COFFEE BAG JURERE GOURMET 100G +3",
  soldAt: "2026-07-29T12:00:00.000Z",
  etapa: null,
  erpStatus: "NORMAL",
  items: [
    { productExternalId: "3686", description: "DRIP", quantity: 6, unitValue: 19.9, totalValue: 119.4 },
  ],
};

function makeStore(overrides: Partial<OrderStore> = {}) {
  const calls = {
    creates: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    items: [] as Array<{ orderId: string; count: number }>,
    byCnpj: [] as string[],
  };
  const store: OrderStore = {
    findClientIdByExternalId: async () => null,
    findClientIdByCnpj: async (_org, cnpj) => {
      calls.byCnpj.push(cnpj);
      return "client-1";
    },
    findOrderByExternalId: async () => null,
    updateOrder: async (id, patch) => {
      calls.updates.push({ id, patch });
    },
    createOrder: async (row) => {
      calls.creates.push(row);
      return "order-1";
    },
    replaceOrderItems: async ({ orderId, items }) => {
      calls.items.push({ orderId, count: items.length });
    },
    ...overrides,
  };
  return { store, calls };
}

describe("upsertCanonicalOrder — pedido do Toth", () => {
  it("resolve o cliente por CNPJ quando o pedido não tem id externo de cliente", async () => {
    const { store, calls } = makeStore();
    const result = await upsertCanonicalOrder(store, {
      organizationId: "org-1",
      source: "toth",
      order: PEDIDO,
    });
    expect(result.action).toBe("created");
    expect(calls.byCnpj).toEqual(["67964429000501"]);
  });

  it("pedido NÃO faturado entra pendente — não soma na receita da Carteira", async () => {
    const { store, calls } = makeStore();
    await upsertCanonicalOrder(store, { organizationId: "org-1", source: "toth", order: PEDIDO });
    expect(calls.creates[0].approval_status).toBe("pending");
    expect(calls.creates[0].erp_status).toBe("NORMAL");
  });

  it("faturado entra aprovado", async () => {
    const { store, calls } = makeStore();
    await upsertCanonicalOrder(store, {
      organizationId: "org-1",
      source: "toth",
      order: { ...PEDIDO, erpStatus: "FATURADO" },
    });
    expect(calls.creates[0].approval_status).toBe("approved");
  });

  it("a virada NORMAL → FATURADO reaprova o pedido já gravado", async () => {
    const { store, calls } = makeStore({ findOrderByExternalId: async () => ({ id: "order-1" }) });
    await upsertCanonicalOrder(store, {
      organizationId: "org-1",
      source: "toth",
      order: { ...PEDIDO, erpStatus: "FATURADO" },
    });
    expect(calls.updates[0].patch.approval_status).toBe("approved");
    // `sold_at` não é reescrito: mover a emissão trocaria a venda de mês.
    expect(calls.updates[0].patch).not.toHaveProperty("sold_at");
  });

  it("grava os itens nas duas rotas, criação e atualização", async () => {
    const novo = makeStore();
    await upsertCanonicalOrder(novo.store, {
      organizationId: "org-1",
      source: "toth",
      order: PEDIDO,
    });
    expect(novo.calls.items).toEqual([{ orderId: "order-1", count: 1 }]);

    const existente = makeStore({ findOrderByExternalId: async () => ({ id: "order-9" }) });
    await upsertCanonicalOrder(existente.store, {
      organizationId: "org-1",
      source: "toth",
      order: PEDIDO,
    });
    expect(existente.calls.items).toEqual([{ orderId: "order-9", count: 1 }]);
  });

  it("sem cliente casado, pula — e o motivo diz qual sincronização falta", async () => {
    const { store } = makeStore({ findClientIdByCnpj: async () => null });
    const result = await upsertCanonicalOrder(store, {
      organizationId: "org-1",
      source: "toth",
      order: PEDIDO,
    });
    expect(result).toEqual({ action: "skipped", reason: "client_not_synced" });
  });

  it("store sem suporte a itens (Omie) não quebra", async () => {
    const { store, calls } = makeStore({ replaceOrderItems: undefined });
    const result = await upsertCanonicalOrder(store, {
      organizationId: "org-1",
      source: "toth",
      order: PEDIDO,
    });
    expect(result.action).toBe("created");
    expect(calls.items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dataEmissaoUltimoPedidoFaturado → recência do cliente
// ─────────────────────────────────────────────────────────────────────────────

describe("último pedido faturado no cadastro do cliente", () => {
  it("mapeia o campo que o fornecedor acrescentou em 24/08", () => {
    const cliente = mapTothClienteToCanonical({
      codigoCliente: "123",
      razaoSocial: "TORREFACAO EXEMPLO LTDA",
      dataEmissaoUltimoPedidoFaturado: "2021-01-25",
    });
    expect(cliente.lastOrderAt).toBe("2021-01-25");
    expect(clientEnrichmentColumns(cliente).erp_last_order_at).toBe("2021-01-25");
  });

  it("cliente que nunca faturou vem sem data — 60% da base da Café Jurerê", () => {
    const cliente = mapTothClienteToCanonical({ codigoCliente: "123", razaoSocial: "X" });
    expect(cliente.lastOrderAt).toBeNull();
  });

  it("semeia last_order_at ao meio-dia, preservando o dia em Brasília", () => {
    expect(erpDateToTimestamp("2026-07-29")).toBe("2026-07-29T12:00:00.000Z");
    expect(seedLastOrderAt("2026-07-29", null)).toBe("2026-07-29T12:00:00.000Z");
  });

  it("🔴 não reescreve quando o instante é o mesmo em outra grafia", () => {
    // O Postgres devolve `+00:00`; nós escrevemos `.000Z`. Comparação de texto
    // marcaria como diferente e reescreveria 12 mil clientes a cada execução.
    expect(seedLastOrderAt("2026-07-29", "2026-07-29T12:00:00+00:00")).toBeNull();
  });

  it("só semeia para frente — pedido registrado no CRM é notícia mais nova", () => {
    expect(seedLastOrderAt("2026-01-10", "2026-05-01T12:00:00+00:00")).toBeNull();
    expect(seedLastOrderAt("2026-06-10", "2026-05-01T12:00:00+00:00")).toBe(
      "2026-06-10T12:00:00.000Z",
    );
  });

  it("valor ilegível no banco não vira apagão: mantém o que está lá", () => {
    expect(seedLastOrderAt("2026-06-10", "não é data")).toBeNull();
  });

  it("sem data no ERP, não toca na métrica da carteira", () => {
    expect(seedLastOrderAt(null, null)).toBeNull();
    expect(seedLastOrderAt(undefined, "2026-05-01T12:00:00+00:00")).toBeNull();
  });
});
