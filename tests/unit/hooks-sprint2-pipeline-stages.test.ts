import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { supabase } from "@/integrations/supabase/client";

// ---- Chain mock helper ----

function createChainMock(data: unknown[] = [{ id: "mock-1", name: "Test" }]) {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains", "order", "limit", "range", "insert", "update", "delete", "upsert", "not", "is", "filter", "match"].forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? { id: "mock-1" }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-t", isReady: true }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false, isLoading: false }) }));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", user_id: "u1", role: "admin" } }),
  useTeamMembers: () => ({ data: [] }),
  isVirtualTeamMember: () => false,
  getSelectedOrgId: () => "org-t",
  setSelectedOrgId: vi.fn(),
  useResponsibleMembers: () => ({ data: [] }),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---- Import hooks and helpers ----

import {
  usePipelineStages,
  useAllPipelineStages,
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
  useReorderPipelineStages,
  usePipelineStageOptions,
  useAllPipelineStageOptions,
  stagesToColumns,
  stagesToSelectOptions,
  getPipelineTypeName,
  getStageFamilyName,
  getSuccessStageTransition,
  FALLBACK_STAGES,
} from "@/modules/pipelines/hooks/model/usePipelineStages";

// ---- Pure function tests ----

describe("getPipelineTypeName", () => {
  it("returns friendly name for each type", () => {
    expect(getPipelineTypeName("whatsapp")).toBe("Qualificação");
    expect(getPipelineTypeName("confirmacao")).toBe("Confirmação");
    expect(getPipelineTypeName("propostas")).toBe("Propostas");
  });
});

describe("getStageFamilyName", () => {
  it("resolve funis e o resíduo Carteira (editor compartilhado)", () => {
    expect(getStageFamilyName("whatsapp")).toBe("Qualificação");
    expect(getStageFamilyName("upsell_base")).toBe("Carteira Base");
    expect(getStageFamilyName("upsell_gestao")).toBe("Carteira Gestão");
  });
});

describe("stagesToColumns", () => {
  it("converts stages with stage_key", () => {
    const stages = [
      { id: "s1", stage_key: "novo", name: "Novo", color: "#fff" },
      { id: "s2", stage_key: "abordado", name: "Abordado", color: null },
    ];
    const columns = stagesToColumns(stages);
    expect(columns).toEqual([
      { id: "novo", title: "Novo", color: "#fff" },
      { id: "abordado", title: "Abordado", color: "#64748b" },
    ]);
  });

  it("converts stages without stage_key", () => {
    const stages = [
      { id: "s1", name: "Stage 1", color: "#f00" },
    ] as any[];
    const columns = stagesToColumns(stages);
    expect(columns[0].id).toBe("s1");
  });
});

describe("stagesToSelectOptions", () => {
  it("converts stages to select options", () => {
    const stages = [
      { id: "s1", stage_key: "novo", name: "Novo", color: "#fff" },
    ];
    const options = stagesToSelectOptions(stages);
    expect(options).toEqual([{ value: "novo", label: "Novo" }]);
  });

  it("returns empty array for undefined input", () => {
    expect(stagesToSelectOptions(undefined)).toEqual([]);
  });
});

describe("getSuccessStageTransition", () => {
  it("returns transition for final positive stage", () => {
    const stages = [
      { id: "s1", stage_key: "novo", is_final_positive: false, target_pipe_type: null, target_stage_key: null } as any,
      { id: "s2", stage_key: "agendado", is_final_positive: true, target_pipe_type: "confirmacao", target_stage_key: "reuniao_marcada" } as any,
    ];
    const transition = getSuccessStageTransition(stages);
    expect(transition).toEqual({ targetPipe: "confirmacao", targetStage: "reuniao_marcada" });
  });

  it("returns null when no final positive stage", () => {
    const stages = [
      { id: "s1", stage_key: "novo", is_final_positive: false, target_pipe_type: null, target_stage_key: null } as any,
    ];
    expect(getSuccessStageTransition(stages)).toBeNull();
  });

  it("returns null for undefined stages", () => {
    expect(getSuccessStageTransition(undefined)).toBeNull();
  });
});

describe("FALLBACK_STAGES (SCRUM-641)", () => {
  it("é a trilha única do Funil de Vendas — o Record por trio morreu", () => {
    expect(Array.isArray(FALLBACK_STAGES)).toBe(true);
    expect(FALLBACK_STAGES[0].id).toBe("novo");
    expect(FALLBACK_STAGES.find((s) => s.id === "ganhou")?.is_final_positive).toBe(true);
    expect(FALLBACK_STAGES.find((s) => s.id === "perdeu")?.is_final_negative).toBe(true);
  });
});

// ---- Hook tests ----

describe("usePipelineStages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Desde 20270902000000, `usePipelineStages` consulta primeiro
   * `pipeline_display_config` — o REGISTRO de quais funis de sistema a org tem.
   * Por isso o mock precisa responder por TABELA: devolver a mesma lista para
   * todo mundo faria o registro parecer conter etapas.
   */
  function mockPorTabela(registro: unknown[], etapas: unknown[]) {
    mockFrom.mockImplementation((tabela: string) =>
      createChainMock(tabela === "pipeline_display_config" ? registro : etapas),
    );
  }

  const REGISTRO_COM_WHATSAPP = [{ pipe_type: "whatsapp" }];

  it("fetches pipeline stages from DB", async () => {
    const dbStages = [
      { id: "ps-1", organization_id: "org-t", pipeline_type: "whatsapp", stage_key: "novo", name: "Novo Custom", color: "#123", position: 0, is_active: true, is_final_positive: false, is_final_negative: false, target_pipe_type: null, target_stage_key: null },
    ];
    mockPorTabela(REGISTRO_COM_WHATSAPP, dbStages);

    const { result } = renderHook(() => usePipelineStages("whatsapp"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("pipeline_stages");
  });

  /**
   * SCRUM-618: lista vazia é estado LEGÍTIMO. O seed é 100% server-side
   * (enable_system_pipeline → create_default_pipeline_stages) e o front nem
   * semeia nem fabrica etapa para funil habilitado — devolver o fallback aqui
   * faria a tela mentir sobre o banco de novo. Se alguém reintroduzir o
   * fallback (ou o upsert do ensureDefaultStagesInDb), este teste cai.
   */
  it("funil habilitado sem etapa: devolve [] e NÃO semeia nada", async () => {
    mockPorTabela(REGISTRO_COM_WHATSAPP, []);
    const { result } = renderHook(() => usePipelineStages("whatsapp"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
    // Nenhuma escrita: o caminho de seed do cliente morreu (SCRUM-618).
    const chains = mockFrom.mock.results.map((r) => r.value);
    for (const chain of chains) {
      expect(chain.upsert).not.toHaveBeenCalled();
      expect(chain.insert).not.toHaveBeenCalled();
    }
  });

  /**
   * 🚨 A guarda que torna a EXCLUSÃO de funil de sistema possível.
   *
   * Este era o quarto vazamento: sem registro, o hook caía em
   * `buildFallbackStages` e devolvia as etapas padrão fabricadas em memória. O
   * banco ficava limpo e a tela continuava desenhando o funil — o usuário
   * excluía e nada acontecia.
   *
   * Se alguém reintroduzir o fallback neste ramo, este teste cai.
   */
  it("org SEM o funil no registro: devolve [] e nem consulta pipeline_stages", async () => {
    mockPorTabela([{ pipe_type: "propostas" }], FALLBACK_STAGES);

    const { result } = renderHook(() => usePipelineStages("whatsapp"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(mockFrom).toHaveBeenCalledWith("pipeline_display_config");
    expect(mockFrom).not.toHaveBeenCalledWith("pipeline_stages");
  });

  /**
   * Falhar para o lado de NÃO semear. Um erro transitório de rede na leitura do
   * registro não pode ressuscitar um funil que a org excluiu — por isso
   * `lerTiposHabilitados` devolve conjunto vazio em erro, nunca "todos".
   */
  it("erro ao ler o registro NÃO ressuscita o funil", async () => {
    mockFrom.mockImplementation((tabela: string) => {
      if (tabela !== "pipeline_display_config") return createChainMock(FALLBACK_STAGES);
      const chain = createChainMock([]);
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: "network" } }).then(resolve);
      return chain;
    });

    const { result } = renderHook(() => usePipelineStages("whatsapp"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe("useAllPipelineStages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([
      { id: "ps-1", pipeline_type: "whatsapp", stage_key: "novo", name: "Novo", position: 0 },
    ]));
  });

  it("fetches all stages for org", async () => {
    const { result } = renderHook(() => useAllPipelineStages(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("pipeline_stages");
  });
});

describe("useCreatePipelineStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "ps-new" }]));
  });

  it("creates a new stage", async () => {
    const { result } = renderHook(() => useCreatePipelineStage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          pipeline_type: "whatsapp",
          stage_key: "custom_stage",
          name: "Custom Stage",
          position: 5,
        });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("pipeline_stages");
  });
});

describe("useUpdatePipelineStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "ps-1", name: "Updated" }]));
  });

  it("updates a stage", async () => {
    const { result } = renderHook(() => useUpdatePipelineStage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "ps-1", pipeline_type: "whatsapp", name: "Updated" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("pipeline_stages");
  });
});

describe("useDeletePipelineStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("soft deletes a stage", async () => {
    const { result } = renderHook(() => useDeletePipelineStage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "ps-1", pipeline_type: "whatsapp" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("pipeline_stages");
  });
});

describe("useReorderPipelineStages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("reorders stages via RPC de statement único (SCRUM-616)", async () => {
    const { result } = renderHook(() => useReorderPipelineStages(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          pipeline_type: "whatsapp",
          stages: [
            { id: "ps-1", position: 1 },
            { id: "ps-2", position: 0 },
          ],
        });
      } catch {}
    });
    // UNIQUE (pipeline_id, position): a permutação vai numa RPC única, ids na
    // ordem final (position asc), nunca em UPDATEs por linha.
    expect(supabase.rpc).toHaveBeenCalledWith("reorder_pipeline_stages", {
      p_stage_ids: ["ps-2", "ps-1"],
    });
  });
});

describe("usePipelineStageOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([]));
  });

  it("returns options and loading state", async () => {
    const { result } = renderHook(() => usePipelineStageOptions("whatsapp"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 });
    expect(result.current.options).toBeDefined();
    expect(Array.isArray(result.current.options)).toBe(true);
  });
});

describe("useAllPipelineStageOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([]));
  });

  it("returns stage options for all pipe types", async () => {
    const { result } = renderHook(() => useAllPipelineStageOptions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 });
    expect(result.current.stagesByPipe).toHaveProperty("whatsapp");
    expect(result.current.stagesByPipe).toHaveProperty("confirmacao");
    expect(result.current.stagesByPipe).toHaveProperty("propostas");
  });
});
