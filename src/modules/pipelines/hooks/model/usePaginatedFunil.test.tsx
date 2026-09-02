import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePaginatedFunil } from "./usePaginatedFunil";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: () => {},
}));
// O hook de move custom arrasta meio módulo atrás dele — o board paginado não
// o exercita neste teste.
vi.mock("../custom/useCustomPipelines", () => ({
  useMoveLeadInCustomPipe: () => ({ mutateAsync: vi.fn() }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PIPELINE_ID = "11111111-2222-4333-8444-555566667777";

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string, params: Record<string, unknown>) => {
    if (fn === "get_pipeline_stage_counts_by_id") {
      return Promise.resolve({
        data: [
          { stage_id: "s-a", stage_key: "novo", cnt: 2 },
          // Linha fantasma (stage_id NULL) da MESMA key — soma na coluna.
          { stage_id: null, stage_key: "novo", cnt: 1 },
          { stage_id: "s-b", stage_key: "ganho", cnt: 5 },
        ],
        error: null,
      });
    }
    if (fn === "get_pipeline_page") {
      if (params.p_stage_id === "novo") {
        return Promise.resolve({
          data: [
            {
              id: "e-1",
              lead_id: "l-1",
              stage_key: "novo",
              created_at: "2026-09-01T00:00:00Z",
              lead: { id: "l-1", name: "Josilene" },
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
});

const stages = [{ stage_key: "novo" }, { stage_key: "ganho" }];

describe("usePaginatedFunil — via canônica por pipeline_id (SCRUM-632/626)", () => {
  it("pagina por p_pipeline_id (não por slug) e agrega contagens por stage_key", async () => {
    const { result } = renderHook(() => usePaginatedFunil(PIPELINE_ID, stages), { wrapper });

    await waitFor(() => {
      expect(result.current.stageData["novo"]?.items).toHaveLength(1);
    });

    // Toda chamada de página endereça o funil por id — o caminho canônico 626.
    const pageCalls = rpc.mock.calls.filter(([fn]) => fn === "get_pipeline_page");
    expect(pageCalls.length).toBeGreaterThan(0);
    for (const [, params] of pageCalls) {
      expect(params.p_pipeline_id).toBe(PIPELINE_ID);
      expect(params).not.toHaveProperty("p_pipeline_slug");
    }

    // Contagem vem do motor único por id…
    const countCalls = rpc.mock.calls.filter(([fn]) => fn === "get_pipeline_stage_counts_by_id");
    expect(countCalls.length).toBeGreaterThan(0);
    expect(countCalls[0][1].p_pipeline_id).toBe(PIPELINE_ID);

    // …e o badge soma a linha fantasma na key que o card ainda carrega.
    await waitFor(() => {
      expect(result.current.stageCounts).toEqual({ novo: 3, ganho: 5 });
    });
    expect(result.current.stageData["novo"]?.totalCount).toBe(3);
    expect(result.current.stageData["ganho"]?.totalCount).toBe(5);
  });

  it("sem pipelineId não dispara RPC nenhuma", async () => {
    renderHook(() => usePaginatedFunil(undefined, stages), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
  });
});
