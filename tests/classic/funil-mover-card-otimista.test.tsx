/**
 * `useMoverCardNoFunil` — o move da página `/funil/:slug`.
 *
 * Antes: sem otimismo (o card esperava a ida + o eco do Realtime) e DUAS
 * rodadas de invalidação por prefixo (o `onSuccess` de
 * `useMoveLeadInCustomPipe` → `invalidateAfterMove`, e o deste hook) — 27
 * `get_pipeline_page` + 2 contagens no mesmo segundo num board de 14 colunas.
 * O que está sob prova:
 *
 *  1. o card muda de coluna no cache ANTES da escrita terminar;
 *  2. erro → rollback fiel (card e contagem de volta);
 *  3. UMA rodada: só as colunas de origem e destino + contagem deste funil
 *     buscam de novo; coluna alheia e board de outro funil não buscam;
 *  4. caminho custom usa a escrita de `executarMoveCustom` sem herdar a
 *     invalidação ampla de `useMoveLeadInCustomPipe`;
 *  5. otimismo do chamador (`completarMove`) não é reaplicado nem revertido aqui.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Dublês ───────────────────────────────────────────────────────────────────
let resolverUpdate: (v: { data: unknown; error: unknown }) => void = () => {};
const updateSpy = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => {
        updateSpy(patch);
        return {
          eq: () => ({
            select: () => ({
              single: () => new Promise((r) => (resolverUpdate = r)),
            }),
          }),
        };
      },
    }),
    rpc: vi.fn(),
  },
}));
let permitido = true;
vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/identity")>()),
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCanDo: () => ({ allowed: permitido, isLoading: false }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));
vi.mock("@/modules/pipelines/hooks/model/useFunilRealtime", () => ({
  useFunilRealtime: () => {},
}));
const executarMoveCustom = vi.fn();
const useMoveLeadInCustomPipe = vi.fn();
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/pipelines/hooks/custom/useCustomPipelines")>()),
  executarMoveCustom: (...a: unknown[]) => executarMoveCustom(...a),
  useMoveLeadInCustomPipe: (...a: unknown[]) => useMoveLeadInCustomPipe(...a),
}));

import { useMoverCardNoFunil } from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import {
  __ecosEsperados,
  __limparEcosProprios,
  aplicarMoveOtimista,
} from "@/modules/pipelines/lib/funil-move-cache";

const PL = "pl-1";
const pageKey = (stage: string, pl = PL) => ["pipeline-page", pl, stage, "org-1", "f"];
const countsKey = ["pipeline-stage-counts", PL, "org-1", "{}"];

/**
 * Board com observers ATIVOS (o que um board montado tem): 3 colunas deste
 * funil, a contagem, e uma coluna de OUTRO funil. Cada `queryFn` conta buscas.
 */
function montarBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const buscas: Record<string, number> = {};
  const inicial: Record<string, unknown[]> = {
    [JSON.stringify(pageKey("a"))]: [{ id: "e-1", stage_key: "a", lead_id: "l-1" }],
    [JSON.stringify(pageKey("b"))]: [],
    [JSON.stringify(pageKey("c"))]: [{ id: "e-3", stage_key: "c" }],
    [JSON.stringify(pageKey("x", "pl-2"))]: [{ id: "e-9", stage_key: "x" }],
  };
  const unsubs: Array<() => void> = [];
  for (const k of Object.keys(inicial)) {
    const key = JSON.parse(k);
    qc.setQueryData(key, { pages: [inicial[k]], pageParams: [null] });
    const obs = new QueryObserver(qc, {
      queryKey: key,
      queryFn: async () => {
        buscas[k] = (buscas[k] ?? 0) + 1;
        return qc.getQueryData(key);
      },
    });
    unsubs.push(obs.subscribe(() => {}));
  }
  qc.setQueryData(countsKey, { a: 1, b: 0, c: 1 });
  const countsObs = new QueryObserver(qc, {
    queryKey: countsKey,
    queryFn: async () => {
      buscas.counts = (buscas.counts ?? 0) + 1;
      return qc.getQueryData(countsKey);
    },
  });
  unsubs.push(countsObs.subscribe(() => {}));

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, buscas, wrapper, unsubs };
}

const idsNaColuna = (qc: QueryClient, stage: string) =>
  ((qc.getQueryData(pageKey(stage)) as { pages: Array<Array<{ id: string }>> }).pages.flat()).map((e) => e.id);

beforeEach(() => {
  vi.clearAllMocks();
  permitido = true;
  __limparEcosProprios();
});

describe("useMoverCardNoFunil — otimismo + rollback", () => {
  it("card muda de coluna ANTES da escrita voltar; contagem ajusta; eco registrado", async () => {
    const { qc, wrapper } = montarBoard();
    const { result } = renderHook(() => useMoverCardNoFunil({ id: PL, type: "system" }), { wrapper });

    act(() => {
      result.current.mutate({ entryId: "e-1", stageId: "id-b", stageKey: "b" });
    });

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    // Escrita ainda pendente — e o card já está em b.
    expect(idsNaColuna(qc, "a")).toEqual([]);
    expect(idsNaColuna(qc, "b")).toEqual(["e-1"]);
    expect(qc.getQueryData(countsKey)).toEqual({ a: 0, b: 1, c: 1 });
    expect(__ecosEsperados("e-1")).toEqual([{ pipelineId: PL, stageKey: "b" }]);

    await act(async () => resolverUpdate({ data: { id: "e-1", lead_id: "l-1" }, error: null }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("erro na escrita → rollback: card e contagem voltam; eco esquecido", async () => {
    const { qc, wrapper } = montarBoard();
    const { result } = renderHook(() => useMoverCardNoFunil({ id: PL, type: "system" }), { wrapper });

    act(() => {
      result.current.mutate({ entryId: "e-1", stageId: "id-b", stageKey: "b" });
    });
    await waitFor(() => expect(idsNaColuna(qc, "b")).toEqual(["e-1"]));

    await act(async () => resolverUpdate({ data: null, error: new Error("RLS") }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(idsNaColuna(qc, "a")).toEqual(["e-1"]);
    expect(idsNaColuna(qc, "b")).toEqual([]);
    expect(qc.getQueryData(countsKey)).toEqual({ a: 1, b: 0, c: 1 });
    expect(__ecosEsperados("e-1")).toEqual([]);
  });

  it("sem permissão: não pisca o card, não escreve e não reconcilia (R4)", async () => {
    permitido = false;
    const { qc, wrapper, buscas } = montarBoard();
    const { result } = renderHook(() => useMoverCardNoFunil({ id: PL, type: "system" }), { wrapper });

    act(() => {
      result.current.mutate({ entryId: "e-1", stageId: "id-b", stageKey: "b" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(idsNaColuna(qc, "a")).toEqual(["e-1"]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(buscas).toEqual({});
  });
});

describe("useMoverCardNoFunil — UMA rodada restrita", () => {
  it("só origem, destino e contagem deste funil buscam — uma vez cada", async () => {
    const { wrapper, buscas } = montarBoard();
    const { result } = renderHook(() => useMoverCardNoFunil({ id: PL, type: "system" }), { wrapper });

    act(() => {
      result.current.mutate({ entryId: "e-1", stageId: "id-b", stageKey: "b" });
    });
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    await act(async () => resolverUpdate({ data: { id: "e-1", lead_id: "l-1" }, error: null }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(buscas.counts).toBe(1));

    expect(buscas).toEqual({
      [JSON.stringify(pageKey("a"))]: 1,
      [JSON.stringify(pageKey("b"))]: 1,
      counts: 1,
    });
  });

  it("caminho custom: escrita de executarMoveCustom, sem o hook de invalidação ampla", async () => {
    executarMoveCustom.mockResolvedValue({ id: "e-1", lead_id: "l-1" });
    const { wrapper, buscas } = montarBoard();
    const { result } = renderHook(() => useMoverCardNoFunil({ id: PL, type: "custom" }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ entryId: "e-1", stageId: "id-b", stageKey: "b" });
    });
    await waitFor(() => expect(buscas.counts).toBe(1));

    expect(executarMoveCustom).toHaveBeenCalledWith(
      { entry_id: "e-1", pipeline_id: PL, stage_id: "id-b" },
      "org-1",
    );
    expect(useMoveLeadInCustomPipe).not.toHaveBeenCalled();
    expect(buscas).toEqual({
      [JSON.stringify(pageKey("a"))]: 1,
      [JSON.stringify(pageKey("b"))]: 1,
      counts: 1,
    });
  });

  it("outras telas são marcadas como velhas SEM busca (refetchType none)", async () => {
    executarMoveCustom.mockResolvedValue({ id: "e-1", lead_id: "l-1" });
    const { qc, wrapper } = montarBoard();
    qc.setQueryData(["leads", "org-1", 1], []);
    qc.setQueryData(["custom_pipe_entries", PL], []);
    const { result } = renderHook(() => useMoverCardNoFunil({ id: PL, type: "custom" }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ entryId: "e-1", stageId: "id-b", stageKey: "b" });
    });

    expect(qc.getQueryState(["leads", "org-1", 1])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["custom_pipe_entries", PL])?.isInvalidated).toBe(true);
    // Board de OUTRO funil: velho, mas sem busca (o observer está ativo e
    // mesmo assim não buscou — ver teste anterior).
    expect(qc.getQueryState(pageKey("x", "pl-2"))?.isInvalidated).toBe(true);
  });
});

describe("useMoverCardNoFunil — otimismo do chamador", () => {
  it("não reaplica nem reverte; reconcilia pela origem que o chamador capturou", async () => {
    const { qc, wrapper, buscas } = montarBoard();
    const otimista = aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "e-1", toStage: "b" });
    const { result } = renderHook(() => useMoverCardNoFunil({ id: PL, type: "system" }), { wrapper });

    act(() => {
      result.current.mutate({ entryId: "e-1", stageId: "id-b", stageKey: "b", otimistaDoChamador: otimista });
    });
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(qc.getQueryData(countsKey)).toEqual({ a: 0, b: 1, c: 1 }); // não ajustou 2×

    await act(async () => resolverUpdate({ data: null, error: new Error("x") }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    // Rollback é do chamador: o hook não desfez.
    expect(idsNaColuna(qc, "b")).toEqual(["e-1"]);
    await waitFor(() => expect(buscas[JSON.stringify(pageKey("a"))]).toBe(1));
  });
});
