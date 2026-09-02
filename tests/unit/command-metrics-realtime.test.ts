/**
 * F0 funis-unificacao §4.2 — realtime do Comando assinava VIEWS.
 *
 * `useCommandMetrics` assinava `pipe_propostas` e `pipe_confirmacao`. Views
 * não entram em logical replication: não emitem `postgres_changes`, e o filtro
 * `organization_id` nem resolve as colunas — a assinatura era um no-op
 * silencioso (o Comando só atualizava por staleTime). O fix segue o padrão já
 * documentado em `useDashboardMetrics`: assinar a tabela base
 * `pipeline_entries`, que cobre todos os stages de todos os pipes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockUseRealtimeSubscription = vi.fn();

vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: (...args: unknown[]) => mockUseRealtimeSubscription(...args),
}));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: true }),
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-1" } }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

import { useCommandMetrics } from "@/modules/analytics/hooks/useCommandMetrics";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  mockUseRealtimeSubscription.mockClear();
});

describe("useCommandMetrics — realtime nas tabelas base, nunca em views", () => {
  it("assina pipeline_entries e leads com a queryKey do Comando", () => {
    renderHook(
      () => useCommandMetrics({ start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T23:59:59Z") }),
      { wrapper: createWrapper() },
    );

    const tables = mockUseRealtimeSubscription.mock.calls.map((c) => c[0] as string);
    expect(tables).toContain("pipeline_entries");
    expect(tables).toContain("leads");

    for (const call of mockUseRealtimeSubscription.mock.calls) {
      expect(call[1]).toEqual(["command-metrics"]);
    }
  });

  it("NÃO assina as views pipe_propostas/pipe_confirmacao (no-op garantido)", () => {
    renderHook(
      () => useCommandMetrics({ start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T23:59:59Z") }),
      { wrapper: createWrapper() },
    );

    const tables = mockUseRealtimeSubscription.mock.calls.map((c) => c[0] as string);
    expect(tables).not.toContain("pipe_propostas");
    expect(tables).not.toContain("pipe_confirmacao");
    expect(tables).not.toContain("pipe_whatsapp");
  });
});
