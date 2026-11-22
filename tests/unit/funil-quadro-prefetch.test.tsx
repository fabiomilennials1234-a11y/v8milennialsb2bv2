/**
 * Quadro numa chamada (get_pipeline_board, 20280123000000) — prefetch do trilho.
 *
 * O aquecimento faz UMA ida (o quadro) em vez de N páginas + contagem, semeia
 * as MESMAS chaves que a tela lê e deixa a chave do quadro no cache: a tela
 * aberta logo depois não repete nenhuma ida.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";

const ORG = "org-1";
const PIPE = { id: "p-1", slug: "vendas", is_active: true, type: "custom" };
const ETAPAS = [
  { id: "s1", stage_key: "novo", position: 0 },
  { id: "s2", stage_key: "proposta", position: 1 },
];
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: ETAPAS, error: null });
  return { supabase: { from: () => chain, rpc: (...a: unknown[]) => rpc(...a) } };
});
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: ORG, isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useCurrentTeamMember: () => ({ data: { organization_id: ORG } }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: () => {} }));
vi.mock("@/modules/pipelines/hooks/model/useFunilRealtime", () => ({ useFunilRealtime: () => {} }));
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({ executarMoveCustom: vi.fn() }));

import { usePaginatedFunil, useFunilStages } from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import { usePrefetchPipes, recorteInicialDoFunil } from "@/modules/pipelines/hooks/perf/usePrefetchPipes";
import {
  EXTRAS_INICIAIS_DO_FUNIL,
  comporFiltrosDoFunil,
  createInitialFunilFilterState,
  paginatedFiltersDoEstado,
} from "@/modules/pipelines/lib/funil-filtros-estado";

const card = (id: string, stage: string) => ({
  id, pipeline_id: PIPE.id, lead_id: `l-${id}`, stage_key: stage, created_at: "2026-11-01T00:00:00+00:00",
  metadata: {}, lead: { id: `l-${id}`, name: `Lead ${id}` },
});

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) =>
    fn === "get_pipeline_board"
      ? {
          data: {
            counts: [{ stage_id: "s1", stage_key: "novo", cnt: 2 }],
            columns: { novo: [card("e1", "novo"), card("e2", "novo")], proposta: [] },
          },
          error: null,
        }
      : { data: [], error: null },
  );
});

const filtrosDaTela = () =>
  comporFiltrosDoFunil(
    paginatedFiltersDoEstado(createInitialFunilFilterState(), "", "all"),
    { ...EXTRAS_INICIAIS_DO_FUNIL },
    { closedStatusKeys: [], temPeriodo: false, timeParams: {} },
  );

describe("prefetch do funil com o quadro", () => {
  it("aquece com UMA ida e a tela aberta em seguida não sai mais nenhuma", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["pipelines", ORG], [PIPE]);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

    const { result: prefetch } = renderHook(() => usePrefetchPipes(), { wrapper });
    await act(async () => { await prefetch.current({ slug: PIPE.slug, donoForcado: null }); });
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(["get_pipeline_board"]);
    expect(rpc.mock.calls[0][1]).toMatchObject({ ...recorteInicialDoFunil(ORG, null), p_pipeline_id: PIPE.id, p_stage_keys: ["novo", "proposta"] });

    const filtros = filtrosDaTela();
    const { result: tela } = renderHook(
      () => {
        const { data: stages = [] } = useFunilStages(PIPE.id);
        return usePaginatedFunil(PIPE.id, stages, filtros);
      },
      { wrapper },
    );
    await waitFor(() => expect(tela.current.stageData["novo"]?.items).toHaveLength(2));
    await waitFor(() => expect(tela.current.isLoading).toBe(false));
    expect(tela.current.stageCounts).toEqual({ novo: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);

    const chaves = qc.getQueryCache().getAll().map((q) => String((q.queryKey as QueryKey)[0]));
    expect(chaves).toContain("pipeline-board");
  });
});
