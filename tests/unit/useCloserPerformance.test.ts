import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useCloserPerformance } from "@/modules/engagement/hooks/useCloserPerformance";
import type { TVPeriodRange } from "@/lib/tv-periods";

const inRangeDate = new Date(2026, 4, 20).toISOString();
const outRangeDate = new Date(2026, 2, 10).toISOString();

const mockClosers = [
  { id: "cl1", name: "Closer A", metric_type: "sales", is_active: true },
  { id: "cl2", name: "Closer B", metric_type: "sales", is_active: true },
  { id: "sdr1", name: "SDR X", metric_type: "meetings", is_active: true },
];

const mockPropostas = [
  // cl1: 2 propostas in range, 1 venda 10k
  { id: "p1", stage_key: "vendido", metrics_period_at: inRangeDate, created_at: inRangeDate, closed_at: inRangeDate, sale_value: 10000, sale_responsible_id: "cl1" },
  { id: "p2", stage_key: "proposta_enviada", metrics_period_at: inRangeDate, created_at: inRangeDate, sale_value: 0, sale_responsible_id: "cl1" },
  // cl2: 1 proposta, 1 venda 30k
  { id: "p3", stage_key: "vendido", metrics_period_at: inRangeDate, created_at: inRangeDate, closed_at: inRangeDate, sale_value: 30000, sale_responsible_id: "cl2" },
  // fora do range
  { id: "p4", stage_key: "vendido", metrics_period_at: outRangeDate, created_at: outRangeDate, closed_at: outRangeDate, sale_value: 50000, sale_responsible_id: "cl1" },
  // legacy: closer_id sem sale_responsible_id
  { id: "p5", stage_key: "proposta_enviada", metrics_period_at: inRangeDate, created_at: inRangeDate, closer_id: "cl2" },
];

const mockConfirmacoes = [
  { id: "c1", stage_key: "compareceu", meeting_date: inRangeDate, sale_responsible_id: "cl1" },
  { id: "c2", stage_key: "compareceu", meeting_date: inRangeDate, sale_responsible_id: "cl2" },
  { id: "c3", stage_key: "compareceu", meeting_date: inRangeDate, sale_responsible_id: "cl2" },
  { id: "c4", stage_key: "remarcar", meeting_date: inRangeDate, sale_responsible_id: "cl1" }, // não compareceu
  { id: "c5", stage_key: "compareceu", meeting_date: outRangeDate, sale_responsible_id: "cl1" }, // fora
];

// As perf hooks leem a projeção canônica `negocio_projetado`, que serve os dois
// funis. O recorte deixou de ser o nome da tabela e passou a ser o filtro
// `funil_sistema`, então o dublê escolhe o conjunto por ele.
//
// A cadeia espelha a real, sem folga: `.select().eq("funil_sistema", …)
// .eq("organization_id", …)`. Só o SEGUNDO `eq` resolve — um hook que esquecesse
// o escopo de org devolveria um objeto, não dados, e o teste quebraria.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: (coluna: string, valor: string) => {
          const dados = valor === "propostas" ? mockPropostas : mockConfirmacoes;
          if (coluna !== "funil_sistema") {
            throw new Error(`dublê esperava .eq("funil_sistema", …) primeiro, veio "${coluna}"`);
          }
          return {
            eq: () => Promise.resolve({ data: dados, error: null }),
          };
        },
      }),
    }),
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({ useTeamMembers: () => ({ data: mockClosers }) }));
vi.mock("@/modules/identity/hooks/useAvatarMap", () => ({ useAvatarMap: () => new Map() }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCloserPerformance", () => {
  const range: TVPeriodRange = {
    start: new Date(2026, 4, 15, 0, 0, 0),
    end: new Date(2026, 4, 22, 23, 59, 59),
  };

  it("calcula vendas, valor, ticket, conversão por closer", async () => {
    const { result } = renderHook(() => useCloserPerformance(range), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.totals.vendas).toBe(2), { timeout: 3000 });
    const cl1 = result.current.byCloser.find((c) => c.id === "cl1")!;
    const cl2 = result.current.byCloser.find((c) => c.id === "cl2")!;

    expect(cl1.vendas).toBe(1);
    expect(cl1.vendasValor).toBe(10000);
    expect(cl1.propostas).toBe(2);
    expect(cl1.ticketMedio).toBe(10000);
    expect(cl1.conversao).toBe(50);

    expect(cl2.vendas).toBe(1);
    expect(cl2.vendasValor).toBe(30000);
    expect(cl2.propostas).toBe(2); // p3 + p5 (legacy closer_id)
    expect(cl2.ticketMedio).toBe(30000);
    expect(cl2.conversao).toBe(50);
  });

  it("reuniões realizadas só conta compareceu", async () => {
    const { result } = renderHook(() => useCloserPerformance(range), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.totals.reunioesRealizadas).toBe(3), { timeout: 3000 });
    const cl1 = result.current.byCloser.find((c) => c.id === "cl1")!;
    const cl2 = result.current.byCloser.find((c) => c.id === "cl2")!;
    expect(cl1.reunioesRealizadas).toBe(1);
    expect(cl2.reunioesRealizadas).toBe(2);
  });

  it("ordena por vendasValor desc; topCloser = maior valor", async () => {
    const { result } = renderHook(() => useCloserPerformance(range), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.totals.vendas).toBe(2), { timeout: 3000 });
    expect(result.current.byCloser[0].id).toBe("cl2");
    expect(result.current.topCloserId).toBe("cl2");
  });

  it("ignora SDRs", async () => {
    const { result } = renderHook(() => useCloserPerformance(range), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.byCloser.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(result.current.byCloser.find((c) => c.id === "sdr1")).toBeUndefined();
  });

  it("totals batem com soma dos closers", async () => {
    const { result } = renderHook(() => useCloserPerformance(range), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.totals.vendas).toBe(2), { timeout: 3000 });
    const t = result.current.totals;
    expect(t.vendas).toBe(2);
    expect(t.vendasValor).toBe(40000);
    expect(t.ticketMedio).toBe(20000);
  });
});
