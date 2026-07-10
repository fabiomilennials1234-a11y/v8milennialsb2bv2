import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { usePaginatedPipeline } from "./usePaginatedPipeline";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: () => {},
}));
vi.mock("./usePipelineEntries", () => ({
  usePipelineId: () => ({ data: "pipe-1" }),
  flattenMetadata: (row: unknown) => row,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockReset();
  // get_pipeline_page → 1 lead apenas na stage-alvo; counts → 1 lá, 0 no resto
  rpc.mockImplementation((fn: string, params: Record<string, unknown>) => {
    if (fn === "get_pipeline_stage_counts") {
      return Promise.resolve({ data: [{ stage_key: "stage_24", cnt: 1 }], error: null });
    }
    if (fn === "get_pipeline_page") {
      if (params.p_stage_id === "stage_24") {
        return Promise.resolve({
          data: [{ id: "lead-X", created_at: "2026-06-09T00:00:00Z", lead: { id: "lead-X", name: "Josilene" } }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
});

// 25 stages ativas — espelha o pior caso real em prod (funil whatsapp).
const stages = Array.from({ length: 25 }, (_, i) => ({ stage_key: `stage_${i}` }));

describe("usePaginatedPipeline — overflow de stages (regressão)", () => {
  it("busca leads de stage além do índice 20 (cap antigo) — lead não some do kanban", async () => {
    const { result } = renderHook(
      () => usePaginatedPipeline("whatsapp" as never, stages),
      { wrapper },
    );

    // stage_24 (índice 24) ficava SEM query-slot com MAX_STAGES=20 → lead invisível.
    await waitFor(() => {
      expect(result.current.stageData["stage_24"]).toBeDefined();
      expect(result.current.stageData["stage_24"].items).toHaveLength(1);
    });
    expect(result.current.stageData["stage_24"].items[0].id).toBe("lead-X");
  });

  it("cria slot de dados para TODAS as 25 stages ativas", async () => {
    const { result } = renderHook(
      () => usePaginatedPipeline("whatsapp" as never, stages),
      { wrapper },
    );
    await waitFor(() => {
      for (const s of stages) {
        expect(result.current.stageData[s.stage_key]).toBeDefined();
      }
    });
  });
});
