import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useFunilMetrics } from "./useFunilMetrics";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();

/**
 * Dublê que despacha POR NOME de RPC.
 *
 * A versão anterior era um `mockResolvedValue` único: qualquer chamada
 * recebia o shape de `get_pipeline_stage_counts_by_id`. Funcionava enquanto
 * o hook chamava uma RPC só. Com a segunda (`get_funil_desfecho_counts`, do
 * B2d) ela passou a devolver linhas de ETAPA para quem esperava linhas de
 * DESFECHO — sem `outcome`, o hook lia zero, e o teste acusava um defeito que
 * não existia no código.
 *
 * Despachar por nome também deixa o teste falhar de verdade quando o hook
 * chama uma RPC que ninguém dublou, em vez de receber dados de outra.
 */
function dublarRpc(porNome: Record<string, unknown[]>) {
  rpc.mockImplementation((nome: string) => {
    if (!(nome in porNome)) {
      return Promise.resolve({ data: null, error: { message: `RPC sem dublê: ${nome}` } });
    }
    return Promise.resolve({ data: porNome[nome], error: null });
  });
}
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
  it("funil CUSTOM: bloco generic via get_pipeline_stage_counts_by_id + won/lost pelo DESFECHO do negócio (B2d)", async () => {
    dublarRpc({
      get_pipeline_stage_counts_by_id: [
        { stage_id: "s1", stage_key: "novo", cnt: 7 },
        // Linha fantasma (stage_id NULL) da MESMA key: reagrega por key.
        { stage_id: null, stage_key: "novo", cnt: 1 },
        { stage_id: "s2", stage_key: "ganhou", cnt: 2 },
        { stage_id: "s3", stage_key: "perdeu", cnt: 2 },
      ],
      // B2d: ganho e perda vêm do NEGÓCIO. Repare que os números batem com as
      // etapas `ganhou`/`perdeu` acima só por coincidência de cenário — o hook
      // não olha mais para elas.
      get_funil_desfecho_counts: [
        { outcome: "open", cnt: 8 },
        { outcome: "won", cnt: 2 },
        { outcome: "lost", cnt: 2 },
      ],
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
    // E a companheira do B2d, que responde ganho/perda pelo negócio.
    expect(rpc).toHaveBeenCalledWith("get_funil_desfecho_counts", {
      p_pipeline_id: "pipe-custom",
      p_org_id: "org-1",
      p_period_after: null,
      p_period_before: null,
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
    dublarRpc({
      get_pipeline_stage_counts_by_id: [{ stage_id: "s5", stage_key: "vendido", cnt: 3 }],
      get_funil_desfecho_counts: [{ outcome: "won", cnt: 3 }],
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
