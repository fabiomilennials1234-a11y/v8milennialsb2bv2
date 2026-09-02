/**
 * useCarteiraStages — o caminho DEDICADO da Carteira para ler etapas
 * (SCRUM-618, D9/ADR-0034). As famílias upsell_* saíram de `PipelineType`;
 * este hook lê `pipeline_stages` por `pipeline_type` direto e segura `/upsell`
 * de pé com o fallback render-only (em prod TODAS as etapas de carteira estão
 * aposentadas/inativas — o board vive do fallback).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

type ChainMock = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
};

function createChainMock(data: unknown[] = []): ChainMock {
  const chain = {} as ChainMock;
  ["select", "eq", "order", "insert", "update", "upsert", "delete"].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.then = (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t" } }),
}));

import {
  useCarteiraStages,
  CARTEIRA_DEFAULT_STAGES,
} from "@/modules/carteira/hooks/useCarteiraStages";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("CARTEIRA_DEFAULT_STAGES", () => {
  it("preserva as duas famílias movidas de DEFAULT_STAGES (contracts)", () => {
    expect(CARTEIRA_DEFAULT_STAGES.upsell_base.map((s) => s.id)).toEqual([
      "0-3m", "3-6m", "6-9m", "9-12m", "12-18m", "18m+",
    ]);
    expect(CARTEIRA_DEFAULT_STAGES.upsell_gestao.map((s) => s.id)).toEqual([
      "campeoes", "fieis", "primeira_compra", "em_risco", "inativos",
    ]);
  });
});

describe("useCarteiraStages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("banco vazio (o caso de prod): devolve o fallback render-only", async () => {
    mockFrom.mockReturnValue(createChainMock([]));
    const { result } = renderHook(() => useCarteiraStages("upsell_gestao"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(result.current.data?.map((s) => s.stage_key)).toEqual([
      "campeoes", "fieis", "primeira_compra", "em_risco", "inativos",
    ]);
    // Fallback é RENDER-ONLY: nada é escrito no banco, nunca.
    const chains = mockFrom.mock.results.map((r) => r.value);
    for (const chain of chains) {
      expect(chain.upsert).not.toHaveBeenCalled();
      expect(chain.insert).not.toHaveBeenCalled();
    }
  });

  it("com etapas no banco, devolve as do banco (sem fallback)", async () => {
    const rows = [
      {
        id: "ps-1", organization_id: "org-t", pipeline_type: "upsell_base",
        stage_key: "0-3m", name: "0-3 meses custom", color: "#111", position: 0,
        is_active: true, is_final_positive: false, is_final_negative: false,
      },
    ];
    mockFrom.mockReturnValue(createChainMock(rows));
    const { result } = renderHook(() => useCarteiraStages("upsell_base"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("0-3 meses custom");
  });

  it("consulta pipeline_stages filtrando pela família, ativas, em ordem", async () => {
    const chain = createChainMock([]);
    mockFrom.mockReturnValue(chain);
    renderHook(() => useCarteiraStages("upsell_base"), { wrapper: createWrapper() });
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith("pipeline_stages"));
    expect(chain.eq).toHaveBeenCalledWith("pipeline_type", "upsell_base");
    expect(chain.eq).toHaveBeenCalledWith("is_active", true);
  });
});
