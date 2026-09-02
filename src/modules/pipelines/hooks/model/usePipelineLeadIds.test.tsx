import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { usePipelineLeadIds } from "./usePipelineLeadIds";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: ["lead-1", "lead-2"], error: null });
});

describe("usePipelineLeadIds — resolvedor de público por pipeline_id (SCRUM-633)", () => {
  it("chama get_pipeline_lead_ids com p_pipeline_id — MESMO caminho p/ funil custom e de sistema", async () => {
    // Funil de sistema agora entra pelo id igual ao custom: sem slug, sem
    // PipelineType-de-3 — o motor único não distingue família.
    const { result } = renderHook(
      () => usePipelineLeadIds("pipe-sistema-uuid", { stageKey: "novo_lead" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual(["lead-1", "lead-2"]));

    expect(rpc).toHaveBeenCalledWith("get_pipeline_lead_ids", {
      p_pipeline_id: "pipe-sistema-uuid",
      p_stage_id: null,
      p_stage_key: "novo_lead",
      p_search: null,
      p_responsible_id: null,
      p_tag_ids: null,
      p_qualification_tier: null,
      p_pre_qualification_tier: null,
      p_origin: null,
      p_organization_id: "org-1",
    });
  });

  it("funil custom: etapa por uuid (p_stage_id) e filtros normalizados", async () => {
    const { result } = renderHook(
      () =>
        usePipelineLeadIds("pipe-custom-uuid", {
          stageId: "stage-uuid",
          search: "acme",
          responsibleId: "member-9",
          tagIds: ["tag-1"],
          origin: ["site"],
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpc).toHaveBeenCalledWith(
      "get_pipeline_lead_ids",
      expect.objectContaining({
        p_pipeline_id: "pipe-custom-uuid",
        p_stage_id: "stage-uuid",
        p_stage_key: null,
        p_search: "acme",
        p_responsible_id: "member-9",
        p_tag_ids: ["tag-1"],
        p_origin: ["site"],
      }),
    );
  });

  it('normaliza sentinelas: responsibleId "all" e arrays vazios viram null (filtro inativo curto-circuita no servidor)', async () => {
    const { result } = renderHook(
      () =>
        usePipelineLeadIds("pipe-1", {
          responsibleId: "all",
          tagIds: [],
          qualificationTier: [],
          preQualificationTier: [],
          origin: [],
          search: "",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpc).toHaveBeenCalledWith(
      "get_pipeline_lead_ids",
      expect.objectContaining({
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: null,
        p_search: null,
      }),
    );
  });

  it("sem pipelineId a query fica desligada — nunca chama a RPC", async () => {
    const { result } = renderHook(() => usePipelineLeadIds(null), { wrapper });
    // fetchStatus idle + nenhuma chamada: gate `enabled` real.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(rpc).not.toHaveBeenCalled();
  });
});
