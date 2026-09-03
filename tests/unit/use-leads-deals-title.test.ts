/**
 * `useLeadsDeals` — de onde vem o título do negócio.
 *
 * ADR-0023 decisão 9: o título é `deals.title` (derivado na criação como
 * `Negócio de <mês>/<ano>`, editável depois). Antes da fatia 2 este hook usava
 * `pipelines.name` — o nome do funil —, que a decisão rejeita explicitamente por
 * não distinguir nada: produziria dezenas de milhares de negócios chamados
 * "Qualificação".
 *
 * O fallback importa tanto quanto a regra: enquanto o backfill do L3 não roda,
 * `deal_id` é NULL nas 38.156 entries de prod, e o card tem que continuar se
 * identificando como hoje em vez de aparecer sem nome.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const ORG = "org-1";

/** Linhas servidas por tabela; cada teste reescreve o que precisa. */
const rows: Record<string, unknown[]> = {};
/** Tabelas consultadas, na ordem — prova que `deals` nem é chamada sem deal_id. */
const consultadas: string[] = [];

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: ORG, isReady: true }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    consultadas.push(table);
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = self;
    builder.eq = self;
    builder.in = self;
    builder.order = self;
    builder.limit = self;
    builder.is = self;
    builder.not = self;
    // O hook faz `await` direto no builder — `then` é o que resolve.
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
    return builder;
  };
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { useLeadsDeals } from "@/modules/leads/hooks/useLeadsDeals";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function seed(opts: { dealId?: string | null; dealTitle?: string }) {
  rows.pipeline_entries = [
    {
      id: "entry-1",
      lead_id: "lead-1",
      pipeline_id: "pipe-1",
      stage_key: "novo",
      entered_at: "2026-08-01T00:00:00Z",
      stage_changed_at: "2026-08-01T00:00:00Z",
      metadata: {},
      deal_id: opts.dealId ?? null,
    },
  ];
  rows.pipelines = [{ id: "pipe-1", slug: "whatsapp", name: "Qualificação", color: "#fff", type: "system" }];
  rows.pipeline_stages = [
    { id: "pipe-1-novo", pipeline_id: "pipe-1", stage_key: "novo", name: "Novo Lead", stage_role: null },
  ];
  rows.pipeline_stages = [];
  rows.deals = opts.dealId && opts.dealTitle
    ? [{ id: opts.dealId, title: opts.dealTitle }]
    : [];
}

describe("useLeadsDeals — título do negócio", () => {
  beforeEach(() => {
    for (const k of Object.keys(rows)) delete rows[k];
    consultadas.length = 0;
  });

  it("usa deals.title quando o card tem negócio", async () => {
    seed({ dealId: "deal-1", dealTitle: "Negócio de agosto/2026" });

    const { result } = renderHook(() => useLeadsDeals(["lead-1"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.["lead-1"]).toBeTruthy());

    const deal = result.current.data!["lead-1"][0];
    expect(deal.title).toBe("Negócio de agosto/2026");
    // O nome do funil sobrevive à parte — é o rótulo do funil, não do negócio.
    expect(deal.funnelName).toBe("Qualificação");
  });

  it("cai no nome do funil quando o card ainda não tem negócio", async () => {
    seed({ dealId: null });

    const { result } = renderHook(() => useLeadsDeals(["lead-1"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.["lead-1"]).toBeTruthy());

    expect(result.current.data!["lead-1"][0].title).toBe("Qualificação");
  });

  it("não consulta `deals` quando nenhum card tem deal_id", async () => {
    // Estado de prod hoje: 38.156 entries, todas com deal_id NULL. A consulta
    // extra não pode custar uma ida ao banco por página de leads até o backfill.
    seed({ dealId: null });

    const { result } = renderHook(() => useLeadsDeals(["lead-1"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.["lead-1"]).toBeTruthy());

    expect(consultadas).not.toContain("deals");
  });

  it("consulta `deals` quando existe deal_id", async () => {
    seed({ dealId: "deal-1", dealTitle: "Reposição trimestral" });

    const { result } = renderHook(() => useLeadsDeals(["lead-1"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.["lead-1"]).toBeTruthy());

    expect(consultadas).toContain("deals");
    expect(result.current.data!["lead-1"][0].title).toBe("Reposição trimestral");
  });

  it("negócio sem título não apaga o nome do card", async () => {
    // `deals.title` é NOT NULL no schema, mas a linha pode não voltar (RLS,
    // negócio de outra org). Sem o fallback o card apareceria sem nome.
    seed({ dealId: "deal-1" });
    rows.deals = [];

    const { result } = renderHook(() => useLeadsDeals(["lead-1"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.["lead-1"]).toBeTruthy());

    expect(result.current.data!["lead-1"][0].title).toBe("Qualificação");
  });
});
