import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useFunilMetrics } from "./useFunilMetrics";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

const pipelines = [
  { id: "pipe-props", slug: "propostas", type: "system", name: "Propostas" },
  { id: "pipe-custom", slug: "meu-funil", type: "custom", name: "Meu Funil" },
];
vi.mock("../model/usePipelines", () => ({
  usePipelines: () => ({ data: pipelines }),
}));

const stagesByPipeline: Record<string, unknown[]> = {
  "pipe-custom": [
    { id: "s1", stage_key: "novo", stage_role: "open" },
    { id: "s2", stage_key: "ganhou", stage_role: "won" },
    { id: "s3", stage_key: "perdeu", stage_role: "lost" },
  ],
  "pipe-props": [
    { id: "s4", stage_key: "proposta_enviada", stage_role: "open" },
    { id: "s5", stage_key: "vendido", stage_role: "won" },
  ],
};
vi.mock("../model/useStagesDoFunil", () => ({
  useStagesDoFunil: (id: string | null | undefined) => ({
    data: (id && stagesByPipeline[id]) || [],
    isLoading: false,
  }),
}));

// Blocos legados: hooks-espiã que gravam o gate `enabled` recebido.
const whatsappSpy = vi.fn();
const confirmacaoSpy = vi.fn();
const propostasSpy = vi.fn();
vi.mock("./usePipeMetrics", () => ({
  usePipeWhatsappMetrics: (...a: unknown[]) => {
    whatsappSpy(...a);
    return { data: undefined, isLoading: false };
  },
  usePipeConfirmacaoMetrics: (...a: unknown[]) => {
    confirmacaoSpy(...a);
    return { data: undefined, isLoading: false };
  },
  usePipePropostasMetrics: (...a: unknown[]) => {
    propostasSpy(...a);
    return { data: { sold: 1000, soldCount: 2 }, isLoading: false };
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockReset();
  whatsappSpy.mockClear();
  confirmacaoSpy.mockClear();
  propostasSpy.mockClear();
});

describe("useFunilMetrics — métricas por pipeline_id (SCRUM-633)", () => {
  it("funil CUSTOM: bloco generic via get_pipeline_stage_counts_by_id + won/lost por stage_role", async () => {
    rpc.mockResolvedValue({
      data: [
        { stage_id: "s1", stage_key: "novo", cnt: 7 },
        // Linha fantasma (stage_id NULL) da MESMA key: reagrega por key.
        { stage_id: null, stage_key: "novo", cnt: 1 },
        { stage_id: "s2", stage_key: "ganhou", cnt: 2 },
        { stage_id: "s3", stage_key: "perdeu", cnt: 2 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useFunilMetrics("pipe-custom", null), { wrapper });
    await waitFor(() => expect(result.current.generic).not.toBeNull());

    expect(rpc).toHaveBeenCalledWith("get_pipeline_stage_counts_by_id", {
      p_pipeline_id: "pipe-custom",
      p_org_id: "org-1",
      p_period_after: null,
      p_period_before: null,
      // Âncora de período dos fechados: derivada do stage_role das etapas.
      p_closed_status_keys: ["ganhou", "perdeu"],
    });

    expect(result.current.kind).toBe("generic");
    expect(result.current.generic).toEqual({
      total: 12,
      byStageKey: { novo: 8, ganhou: 2, perdeu: 2 },
      wonCount: 2,
      lostCount: 2,
      openCount: 8,
      conversionRate: (2 / 12) * 100,
    });
    // Nenhum bloco legado ligado para funil custom.
    expect(whatsappSpy).toHaveBeenCalledWith(null, { enabled: false });
    expect(confirmacaoSpy).toHaveBeenCalledWith(null, { enabled: false });
    expect(propostasSpy).toHaveBeenCalledWith(null, { enabled: false });
    expect(result.current.propostas).toBeNull();
  });

  it("funil de SISTEMA (propostas): liga SÓ o wrapper legado do slug + generic junto", async () => {
    rpc.mockResolvedValue({
      data: [{ stage_id: "s5", stage_key: "vendido", cnt: 3 }],
      error: null,
    });
    const range = { startStr: "2026-08-01", endStr: "2026-08-31" } as never;

    const { result } = renderHook(() => useFunilMetrics("pipe-props", range), { wrapper });
    await waitFor(() => expect(result.current.generic).not.toBeNull());

    expect(result.current.kind).toBe("propostas");
    // O range plugável do MetricsPeriodSelector chega intacto no wrapper legado…
    expect(propostasSpy).toHaveBeenCalledWith(range, { enabled: true });
    expect(whatsappSpy).toHaveBeenCalledWith(range, { enabled: false });
    // …e na RPC generic como p_period_after/before.
    expect(rpc).toHaveBeenCalledWith(
      "get_pipeline_stage_counts_by_id",
      expect.objectContaining({
        p_period_after: "2026-08-01",
        p_period_before: "2026-08-31",
        p_closed_status_keys: ["vendido"],
      }),
    );
    expect(result.current.propostas).toEqual({ sold: 1000, soldCount: 2 });
    expect(result.current.whatsapp).toBeNull();
  });

  it("sem pipelineId: nada roda", async () => {
    const { result } = renderHook(() => useFunilMetrics(null, null), { wrapper });
    expect(result.current.generic).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
