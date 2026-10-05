/**
 * Realtime cirúrgico do `/funil/:slug` (`useFunilRealtime` +
 * `planejarInvalidacaoRealtime`).
 *
 * Antes: qualquer evento de `pipeline_entries` da org invalidava o prefixo
 * `["pipeline-page"]` — toda coluna de todo board montado (14 colunas = 14
 * `get_pipeline_page` por evento, por pessoa). O que está sob prova:
 *
 *  1. move de OUTRO usuário invalida só as colunas de origem e destino + a
 *     contagem DESTE funil;
 *  2. o eco do próprio move é ignorado;
 *  3. evento de outro funil da org não invalida nada;
 *  4. card criado por automação neste funil aparece (coluna dele refaz);
 *  5. card que SAI do funil (pipeline_id novo) é removido da coluna de origem;
 *  6. o canal filtra por org e não abre sem org.
 */
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UseRealtimeChannelOptions } from "@/shared/realtime/useRealtimeChannel";

let canal: UseRealtimeChannelOptions | null = null;
vi.mock("@/shared/realtime/useRealtimeChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/realtime/useRealtimeChannel")>()),
  useRealtimeChannel: (opts: UseRealtimeChannelOptions) => {
    canal = opts;
    return { state: "joined", diagnostics: [] };
  },
}));
let orgId: string | null = "org-1";
vi.mock("@/shared/realtime/realtime-org-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/realtime/realtime-org-context")>()),
  useRealtimeOrgId: () => orgId,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { useFunilRealtime, FUNIL_REALTIME_JANELA_MS } from "@/modules/pipelines/hooks/model/useFunilRealtime";
import {
  __ecosEsperados,
  __limparEcosProprios,
  ECO_METADATA_TTL_MS,
  ECO_PROPRIO_TTL_MS,
  registrarEcoProprio,
} from "@/modules/pipelines/lib/funil-move-cache";

const PL = "pl-1";
const OUTRO_PL = "pl-2";

function semear(qc: QueryClient) {
  qc.setQueryData(["pipeline-page", PL, "a", "org-1", "f"], {
    pages: [[{ id: "e-1", stage_key: "a" }]],
    pageParams: [null],
  });
  qc.setQueryData(["pipeline-page", PL, "b", "org-1", "f"], { pages: [[]], pageParams: [null] });
  qc.setQueryData(["pipeline-page", PL, "c", "org-1", "f"], { pages: [[]], pageParams: [null] });
  qc.setQueryData(["pipeline-stage-counts", PL, "org-1", "{}"], { a: 1, b: 0, c: 0 });
  qc.setQueryData(["pipeline-page", OUTRO_PL, "x", "org-1", "f"], {
    pages: [[{ id: "e-9", stage_key: "x" }]],
    pageParams: [null],
  });
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  semear(qc);
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  renderHook(() => useFunilRealtime(PL), { wrapper });
  return { qc, spy };
}

function emitir(payload: Record<string, unknown>) {
  if (!canal) throw new Error("canal não montado");
  canal.onEvent(payload as never);
}

function chavesInvalidadas(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
}

beforeEach(() => {
  vi.useFakeTimers();
  canal = null;
  orgId = "org-1";
  __limparEcosProprios();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFunilRealtime — canal", () => {
  it("filtra por organization_id (isolamento continua na RLS) e liga com funil + org", () => {
    montar();
    expect(canal?.table).toBe("pipeline_entries");
    expect(canal?.filter).toBe("organization_id=eq.org-1");
    expect(canal?.enabled).toBe(true);
  });

  it("sem org resolvida o canal não abre (o genérico abria SEM filtro)", () => {
    orgId = null;
    montar();
    expect(canal?.enabled).toBe(false);
    expect(canal?.filter).toBeUndefined();
  });
});

describe("useFunilRealtime — invalidação só das colunas afetadas", () => {
  it("move de outro usuário (a → b): só colunas a e b + contagem deste funil", () => {
    const { spy } = montar();
    emitir({
      eventType: "UPDATE",
      new: { id: "e-1", pipeline_id: PL, stage_key: "b" },
      old: { id: "e-1" }, // RLS: old traz só a PK
    });
    expect(spy).not.toHaveBeenCalled(); // janela de agrupamento
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);

    expect(chavesInvalidadas(spy)).toEqual([
      ["pipeline-page", PL, "a"],
      ["pipeline-page", PL, "b"],
      ["pipeline-stage-counts", PL],
    ]);
    // Nunca o prefixo de todos os boards.
    expect(chavesInvalidadas(spy)).not.toContainEqual(["pipeline-page"]);
  });

  it("rajada dentro da janela vira UM lote (colunas unidas, contagem uma vez)", () => {
    const { spy } = montar();
    emitir({ eventType: "UPDATE", new: { id: "e-1", pipeline_id: PL, stage_key: "b" }, old: { id: "e-1" } });
    emitir({ eventType: "INSERT", new: { id: "e-2", pipeline_id: PL, stage_key: "c" }, old: {} });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(chavesInvalidadas(spy)).toEqual([
      ["pipeline-page", PL, "a"],
      ["pipeline-page", PL, "b"],
      ["pipeline-page", PL, "c"],
      ["pipeline-stage-counts", PL],
    ]);
  });

  it("eco do próprio move é ignorado", () => {
    const { spy } = montar();
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "b" });
    emitir({ eventType: "UPDATE", new: { id: "e-1", pipeline_id: PL, stage_key: "b" }, old: { id: "e-1" } });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(spy).not.toHaveBeenCalled();
  });

  it("automação que move o card DE NOVO (outra etapa) não é confundida com eco", () => {
    const { spy } = montar();
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "b" });
    emitir({ eventType: "UPDATE", new: { id: "e-1", pipeline_id: PL, stage_key: "c" }, old: { id: "e-1" } });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(chavesInvalidadas(spy)).toEqual([
      ["pipeline-page", PL, "a"],
      ["pipeline-page", PL, "c"],
      ["pipeline-stage-counts", PL],
    ]);
  });

  it("eco vencido (além do TTL) volta a ser processado", () => {
    const { spy } = montar();
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "b" }, Date.now() - ECO_PROPRIO_TTL_MS - 1);
    emitir({ eventType: "UPDATE", new: { id: "e-1", pipeline_id: PL, stage_key: "b" }, old: { id: "e-1" } });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(spy).toHaveBeenCalled();
  });

  it("evento de OUTRO funil da org não invalida nada", () => {
    const { spy } = montar();
    emitir({ eventType: "UPDATE", new: { id: "e-9", pipeline_id: OUTRO_PL, stage_key: "y" }, old: { id: "e-9" } });
    emitir({ eventType: "INSERT", new: { id: "e-7", pipeline_id: OUTRO_PL, stage_key: "x" }, old: {} });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS * 3);
    expect(spy).not.toHaveBeenCalled();
  });

  it("lead criado por automação neste funil: a coluna dele refaz (o card aparece)", () => {
    const { spy } = montar();
    emitir({ eventType: "INSERT", new: { id: "e-novo", pipeline_id: PL, stage_key: "a" }, old: {} });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(chavesInvalidadas(spy)).toEqual([
      ["pipeline-page", PL, "a"],
      ["pipeline-stage-counts", PL],
    ]);
  });

  it("card que SAI deste funil (auto-transição) é tirado da coluna de origem", () => {
    const { spy } = montar();
    emitir({ eventType: "UPDATE", new: { id: "e-1", pipeline_id: OUTRO_PL, stage_key: "x" }, old: { id: "e-1" } });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(chavesInvalidadas(spy)).toEqual([
      ["pipeline-page", PL, "a"],
      ["pipeline-stage-counts", PL],
    ]);
  });

  it("DELETE de card carregado (old só com PK): coluna dele + contagem", () => {
    const { spy } = montar();
    emitir({ eventType: "DELETE", new: {}, old: { id: "e-1" } });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(chavesInvalidadas(spy)).toEqual([
      ["pipeline-page", PL, "a"],
      ["pipeline-stage-counts", PL],
    ]);
  });

  it("invalidação é refetchType active — coluna desmontada não busca", () => {
    const { spy } = montar();
    emitir({ eventType: "INSERT", new: { id: "e-novo", pipeline_id: PL, stage_key: "a" }, old: {} });
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    for (const [f] of spy.mock.calls) expect((f as { refetchType?: string }).refetchType).toBe("active");
  });
});

describe("eco próprio — consumido uma vez; desvio descarta (volta 1, R1/R3)", () => {
  const upd = (stage: string, pl = PL) => ({
    eventType: "UPDATE",
    new: { id: "e-1", pipeline_id: pl, stage_key: stage },
    old: { id: "e-1" },
  });

  it("R1: meu move a→b; outro usuário b→c→b em < 10 s — o b final NÃO é engolido", () => {
    const { spy } = montar();
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "b" });

    emitir(upd("b")); // meu eco — ignorado e consumido
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(spy).not.toHaveBeenCalled();
    expect(__ecosEsperados("e-1")).toEqual([]);

    emitir(upd("c")); // outro usuário b→c
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();

    emitir(upd("b")); // outro usuário c→b — antes era descartado como "eco"
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(chavesInvalidadas(spy)).toContainEqual(["pipeline-page", PL, "b"]);
    expect(chavesInvalidadas(spy)).toContainEqual(["pipeline-stage-counts", PL]);
  });

  it("desvio antes do eco chegar: lista descartada, nada daquele id é ignorado depois", () => {
    const { spy } = montar();
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "b" });

    emitir(upd("c")); // outra escrita passou na frente
    expect(__ecosEsperados("e-1")).toEqual([]);
    emitir(upd("b")); // mesmo que pareça o meu eco, é processado
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(chavesInvalidadas(spy)).toContainEqual(["pipeline-page", PL, "b"]);
    expect(chavesInvalidadas(spy)).toContainEqual(["pipeline-page", PL, "c"]);
  });

  it("R3: perda/venda — eco do metadata (etapa de origem) e do move (destino) ignorados: 0 rodadas extras", () => {
    const { spy } = montar();
    // Ordem do completarMove: otimismo registra o destino; o metadata, a origem.
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "b" });
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "a" }, Date.now(), ECO_METADATA_TTL_MS);

    emitir(upd("a")); // UPDATE do metadata
    emitir(upd("b")); // UPDATE do move
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS * 2);
    expect(spy).not.toHaveBeenCalled();
    expect(__ecosEsperados("e-1")).toEqual([]);
  });

  it("eco de metadata vence na janela curta e volta a ser processado", () => {
    const { spy } = montar();
    registrarEcoProprio({ entryId: "e-1", pipelineId: PL, stageKey: "a" }, Date.now(), ECO_METADATA_TTL_MS);
    vi.advanceTimersByTime(ECO_METADATA_TTL_MS + 1);
    emitir(upd("a"));
    vi.advanceTimersByTime(FUNIL_REALTIME_JANELA_MS);
    expect(spy).toHaveBeenCalled();
  });
});
