/**
 * Cluster de carteira da lista de Leads (`inv:H1-02`, SCRUM-45).
 *
 * A lista virou cartão e passou a mostrar "quanto esse cliente já comprou". O
 * número vem de `useLeadsCarteiraMetrics`, que lê `upsell_clients` — a tabela
 * alimentada por integração de ERP (`tinyerp-*`, `erp-order-webhook`), não pelo
 * funil. São 738 clientes de carteira em prod, todos dessa origem.
 *
 * Os defeitos que este arquivo impede:
 *
 *   1. **Vazamento cross-tenant.** A consulta manda um `IN (lead_ids)` montado
 *      no cliente. Sem o `.eq("organization_id", …)` explícito, a barreira
 *      passa a ser só a RLS — e este projeto já mediu que `service_role` tem
 *      BYPASSRLS e que policies de outras tabelas validam só o org da LINHA.
 *      Filtro explícito é a defesa que o teste tranca.
 *   2. **Zero que mente.** Lead sem linha em `upsell_clients` é o estado
 *      majoritário e legítimo ("ainda não comprou"). Ele tem que ficar FORA do
 *      mapa, não entrar como `0`. E `days_since_last_order = null` não pode
 *      virar `0`: "0 dias desde o último pedido" é "comprou hoje", que é uma
 *      afirmação, não uma ausência.
 *   3. **Dinheiro dobrado.** `mergeDataMetrics` junta carteira (ERP) com venda
 *      no funil (`sale_events`). Somar dobraria o valor nas organizações que
 *      têm ERP — o mesmo pedido entra pelos dois lados. A regra é PRECEDÊNCIA:
 *      venda no funil ganha, carteira só preenche quem não fechou aqui dentro.
 *   4. **Refetch em cada render.** A `queryKey` ordena os ids justamente porque
 *      a ordem de renderização varia; sem isso, a mesma página vira chave nova
 *      e a lista consulta o banco de novo a cada repaint.
 *
 * O supabase aqui é uma tabela falsa que APLICA os filtros declarados pelo
 * código de produção — é o que faz o item 1 realmente morder.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Banco falso ─────────────────────────────────────────────────────────────

const ORG_DESTA = "org-desta-casa";
const ORG_VIZINHA = "org-da-casa-ao-lado";

interface LinhaUpsellClient {
  lead_id: string | null;
  organization_id: string;
  lifetime_value: number | string | null;
  avg_ticket: number | string | null;
  order_count: number | string | null;
  reorder_cycle_days: number | null;
  days_since_last_order: number | null;
  segment: string | null;
}

let UPSELL_CLIENTS: LinhaUpsellClient[] = [];

interface ConsultaRegistrada {
  tabela: string;
  colunas: string;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
}

const consultas: ConsultaRegistrada[] = [];

function fakeFrom(tabela: string) {
  const registro: ConsultaRegistrada = { tabela, colunas: "", eq: [], in: [] };

  const resolver = () => {
    consultas.push(registro);
    const linhas = UPSELL_CLIENTS.filter((linha) => {
      const passaEq = registro.eq.every(
        ([coluna, valor]) => (linha as unknown as Record<string, unknown>)[coluna] === valor,
      );
      const passaIn = registro.in.every(([coluna, valores]) =>
        valores.includes((linha as unknown as Record<string, unknown>)[coluna]),
      );
      return passaEq && passaIn;
    });
    return Promise.resolve({ data: linhas, error: null });
  };

  const chain = {
    select: (colunas: string) => {
      registro.colunas = colunas;
      return chain;
    },
    eq: (coluna: string, valor: unknown) => {
      registro.eq.push([coluna, valor]);
      return chain;
    },
    in: (coluna: string, valores: unknown[]) => {
      registro.in.push([coluna, valores]);
      return chain;
    },
    then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      resolver().then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (tabela: string) => fakeFrom(tabela) },
}));

const orgRef: { organizationId: string | null; isReady: boolean } = {
  organizationId: ORG_DESTA,
  isReady: true,
};

vi.mock("@/modules/identity", () => ({
  useOrganization: () => orgRef,
}));

import { useLeadsCarteiraMetrics } from "@/modules/leads/hooks/useLeadsCarteiraMetrics";
import { mergeDataMetrics } from "@/modules/leads/lib/data-metrics";
import type { LeadCarteiraMetrics } from "@/modules/leads/hooks/useLeadsCarteiraMetrics";
import type { LeadSalesMetrics } from "@/modules/leads/hooks/useLeadsSalesMetrics";

function cliente(over: Partial<LinhaUpsellClient> & { lead_id: string }): LinhaUpsellClient {
  return {
    organization_id: ORG_DESTA,
    lifetime_value: 0,
    avg_ticket: 0,
    order_count: 0,
    reorder_cycle_days: null,
    days_since_last_order: null,
    segment: null,
    ...over,
  };
}

function comCliente() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

beforeEach(() => {
  consultas.length = 0;
  UPSELL_CLIENTS = [];
  orgRef.organizationId = ORG_DESTA;
  orgRef.isReady = true;
});

// ── Multi-tenancy ───────────────────────────────────────────────────────────

describe("useLeadsCarteiraMetrics — isolamento entre organizações", () => {
  it("não traz o cliente de carteira da org vizinha, mesmo com o id do lead na mão", async () => {
    UPSELL_CLIENTS = [
      cliente({ lead_id: "lead-de-casa", lifetime_value: 1000 }),
      cliente({
        lead_id: "lead-de-fora",
        organization_id: ORG_VIZINHA,
        lifetime_value: 999_999,
      }),
    ];

    const { wrapper } = comCliente();
    const { result } = renderHook(
      () => useLeadsCarteiraMetrics(["lead-de-casa", "lead-de-fora"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(Object.keys(result.current.data!)).toEqual(["lead-de-casa"]);
    expect(result.current.data!["lead-de-fora"]).toBeUndefined();
  });

  it("declara o filtro de organização na consulta, não só o IN de leads", async () => {
    UPSELL_CLIENTS = [cliente({ lead_id: "lead-1" })];
    const { wrapper } = comCliente();
    const { result } = renderHook(() => useLeadsCarteiraMetrics(["lead-1"]), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(consultas).toHaveLength(1);
    expect(consultas[0].tabela).toBe("upsell_clients");
    expect(consultas[0].eq).toContainEqual(["organization_id", ORG_DESTA]);
    expect(consultas[0].in).toContainEqual(["lead_id", ["lead-1"]]);
  });

  it("página sem leads não consulta o banco — nada de IN vazio", async () => {
    const { wrapper } = comCliente();
    const { result } = renderHook(() => useLeadsCarteiraMetrics([]), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(consultas).toHaveLength(0);
  });

  it("organização ainda não resolvida não consulta o banco", async () => {
    orgRef.isReady = false;
    orgRef.organizationId = null;
    const { wrapper } = comCliente();
    renderHook(() => useLeadsCarteiraMetrics(["lead-1"]), { wrapper });

    await new Promise((r) => setTimeout(r, 20));
    expect(consultas).toHaveLength(0);
  });
});

// ── Mapeamento: ausência ≠ zero ─────────────────────────────────────────────

describe("useLeadsCarteiraMetrics — o que o mapa diz e o que ele cala", () => {
  it("lead que nunca comprou fica FORA do mapa, não entra como zero", async () => {
    UPSELL_CLIENTS = [cliente({ lead_id: "comprou", lifetime_value: 500 })];

    const { wrapper } = comCliente();
    const { result } = renderHook(
      () => useLeadsCarteiraMetrics(["comprou", "nunca-comprou"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!["nunca-comprou"]).toBeUndefined();
    expect(result.current.data!["comprou"].lifetimeValue).toBe(500);
  });

  it("numeric do Postgres chega como string e vira número — senão a soma na tela concatena", async () => {
    UPSELL_CLIENTS = [
      cliente({
        lead_id: "lead-1",
        lifetime_value: "1234.50",
        avg_ticket: "617.25",
        order_count: "2",
      }),
    ];

    const { wrapper } = comCliente();
    const { result } = renderHook(() => useLeadsCarteiraMetrics(["lead-1"]), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const m = result.current.data!["lead-1"];
    expect(m.lifetimeValue).toBe(1234.5);
    expect(m.avgTicket).toBe(617.25);
    expect(m.orderCount).toBe(2);
  });

  it("dinheiro ausente é 0, mas dias e segmento ausentes continuam NULL", async () => {
    UPSELL_CLIENTS = [
      cliente({
        lead_id: "lead-1",
        lifetime_value: null,
        avg_ticket: null,
        order_count: null,
        reorder_cycle_days: null,
        days_since_last_order: null,
        segment: null,
      }),
    ];

    const { wrapper } = comCliente();
    const { result } = renderHook(() => useLeadsCarteiraMetrics(["lead-1"]), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const m = result.current.data!["lead-1"];
    expect(m.lifetimeValue).toBe(0);
    expect(m.avgTicket).toBe(0);
    expect(m.orderCount).toBe(0);
    // 0 dias desde o último pedido = "comprou hoje". Não é o mesmo que "não sei".
    expect(m.daysSinceLastOrder).toBeNull();
    expect(m.reorderCycleDays).toBeNull();
    expect(m.segment).toBeNull();
  });

  it("linha sem lead_id é descartada em vez de virar chave vazia no mapa", async () => {
    UPSELL_CLIENTS = [
      { ...cliente({ lead_id: "lead-1" }), lead_id: null },
      cliente({ lead_id: "lead-1", lifetime_value: 10 }),
    ];

    const { wrapper } = comCliente();
    const { result } = renderHook(() => useLeadsCarteiraMetrics(["lead-1"]), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(Object.keys(result.current.data!)).toEqual(["lead-1"]);
  });

  it("a mesma página em ordem diferente reaproveita o cache — não refaz a consulta", async () => {
    UPSELL_CLIENTS = [cliente({ lead_id: "a" }), cliente({ lead_id: "b" })];
    const { wrapper } = comCliente();

    const um = renderHook(() => useLeadsCarteiraMetrics(["a", "b"]), { wrapper });
    await waitFor(() => expect(um.result.current.data).toBeDefined());

    const dois = renderHook(() => useLeadsCarteiraMetrics(["b", "a"]), { wrapper });
    await waitFor(() => expect(dois.result.current.data).toBeDefined());

    expect(consultas).toHaveLength(1);
  });
});

// ── Precedência entre carteira (ERP) e venda no funil ───────────────────────

function daCarteira(over: Partial<LeadCarteiraMetrics> & { leadId: string }): LeadCarteiraMetrics {
  return {
    lifetimeValue: 0,
    avgTicket: 0,
    orderCount: 0,
    reorderCycleDays: null,
    daysSinceLastOrder: null,
    segment: null,
    ...over,
  };
}

function doFunil(over: Partial<LeadSalesMetrics> & { leadId: string }): LeadSalesMetrics {
  return {
    saleCount: 0,
    totalValue: 0,
    avgTicket: 0,
    lastSaleAt: null,
    daysSinceLastSale: null,
    cycleDays: null,
    ...over,
  };
}

describe("mergeDataMetrics — precedência, nunca soma", () => {
  it("lead com venda no funil E pedido no ERP mostra a venda do funil, não a soma", () => {
    const out = mergeDataMetrics(
      { "lead-1": daCarteira({ leadId: "lead-1", lifetimeValue: 8000, orderCount: 4 }) },
      { "lead-1": doFunil({ leadId: "lead-1", totalValue: 3000, saleCount: 1 }) },
    );

    expect(out["lead-1"].lifetimeValue).toBe(3000);
    expect(out["lead-1"].orderCount).toBe(1);
    // 11000 seria o mesmo pedido contado duas vezes nas orgs com ERP.
    expect(out["lead-1"].lifetimeValue).not.toBe(11000);
  });

  it("lead sem venda no funil continua mostrando a carteira", () => {
    const out = mergeDataMetrics(
      { "so-erp": daCarteira({ leadId: "so-erp", lifetimeValue: 750, orderCount: 3 }) },
      { outro: doFunil({ leadId: "outro", totalValue: 100 }) },
    );

    expect(out["so-erp"].lifetimeValue).toBe(750);
    expect(out["so-erp"].orderCount).toBe(3);
  });

  it("o segmento sobrevive à precedência — é rótulo, só existe na carteira", () => {
    const out = mergeDataMetrics(
      { "lead-1": daCarteira({ leadId: "lead-1", lifetimeValue: 8000, segment: "ouro" }) },
      { "lead-1": doFunil({ leadId: "lead-1", totalValue: 3000 }) },
    );

    expect(out["lead-1"].segment).toBe("ouro");
    expect(out["lead-1"].lifetimeValue).toBe(3000);
  });

  it("venda no funil sem carteira nenhuma não inventa segmento", () => {
    const out = mergeDataMetrics(undefined, {
      "lead-1": doFunil({ leadId: "lead-1", totalValue: 3000 }),
    });

    expect(out["lead-1"].segment).toBeNull();
    expect(out["lead-1"].lifetimeValue).toBe(3000);
  });

  it("sem nenhuma das duas fontes o resultado é vazio, não explode", () => {
    expect(mergeDataMetrics(undefined, undefined)).toEqual({});
  });
});
