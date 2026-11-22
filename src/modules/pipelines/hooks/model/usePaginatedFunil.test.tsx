import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchStageEntryRefs, usePaginatedFunil } from "./usePaginatedFunil";
import { PAGE_SIZE } from "./usePaginatedPipeline";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: () => {},
}));
vi.mock("./useFunilRealtime", () => ({
  useFunilRealtime: () => {},
}));
// Dublê por spread: o board paginado não exercita o move custom, mas o
// módulo continua inteiro (export novo não quebra o teste em silêncio).
vi.mock("../custom/useCustomPipelines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../custom/useCustomPipelines")>()),
  executarMoveCustom: vi.fn(),
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

// ── Cursor composto (created_at, id) — migration 20271230000100 ────────────
//
// Dublê da RPC com a MESMA semântica do banco: ordem total (created_at DESC,
// id DESC) e predicado `created_at < c OR (created_at = c AND id < cid)`. Sem
// p_cursor_id, cai no `<` estrito antigo — o dublê também, então um front que
// esquecesse o id voltaria a perder linha e o teste pegaria.
//
// Massa: 7 soltos, 30 empatados, 3 soltos, 49 empatados, 6 soltos = 95 cards.
// Grupos empatados cruzam bordas de página (PAGE_SIZE = 20), como os lotes de
// import em lote medidos em prod (até 49 cards no mesmo instante).
type FakeRow = { id: string; lead_id: string; stage_key: string; created_at: string; lead: { id: string; name: string } };

function massaComEmpates(): FakeRow[] {
  const grupos: Array<[number, boolean]> = [[7, true], [30, false], [3, true], [49, false], [6, true]];
  const rows: FakeRow[] = [];
  let n = 0;
  let t = Date.parse("2026-10-01T12:00:00Z");
  for (const [qtd, solto] of grupos) {
    for (let i = 0; i < qtd; i++) {
      n++;
      if (solto) t -= 1000;
      const id = `e-${String(n).padStart(4, "0")}`;
      rows.push({ id, lead_id: `l-${n}`, stage_key: "novo", created_at: new Date(t).toISOString(), lead: { id: `l-${n}`, name: `L${n}` } });
    }
    if (!solto) t -= 1000;
  }
  return rows;
}

function keysetRpc(massa: FakeRow[]) {
  const ordenada = [...massa].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1,
  );
  return (fn: string, params: Record<string, unknown>) => {
    if (fn === "get_pipeline_stage_counts_by_id") {
      return Promise.resolve({ data: [{ stage_id: "s-a", stage_key: "novo", cnt: massa.length }], error: null });
    }
    if (fn !== "get_pipeline_page" || params.p_stage_id !== "novo") return Promise.resolve({ data: [], error: null });
    const c = params.p_cursor as string | null;
    const cid = params.p_cursor_id as string | null;
    const filtrada = ordenada.filter(
      (r) => c == null || r.created_at < c || (cid != null && r.created_at === c && r.id < cid),
    );
    return Promise.resolve({ data: filtrada.slice(0, params.p_page_size as number), error: null });
  };
}

describe("usePaginatedFunil — empate de created_at na borda da página", () => {
  it("rolando a coluna até o fim, todos os cards aparecem uma vez só", async () => {
    const massa = massaComEmpates();
    rpc.mockImplementation(keysetRpc(massa));

    const { result } = renderHook(() => usePaginatedFunil(PIPELINE_ID, [{ stage_key: "novo" }]), { wrapper });
    await waitFor(() => expect(result.current.stageData["novo"]?.items).toHaveLength(PAGE_SIZE));

    for (let guarda = 0; guarda < 20 && result.current.stageData["novo"].hasMore; guarda++) {
      const antes = result.current.stageData["novo"].items.length;
      await act(async () => result.current.stageData["novo"].fetchMore());
      await waitFor(() => {
        const col = result.current.stageData["novo"];
        expect(col.isFetchingMore || col.items.length > antes || !col.hasMore).toBe(true);
        expect(col.isFetchingMore).toBe(false);
      });
    }

    const ids = result.current.stageData["novo"].items.map((e) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(massa.length);
    expect(ids).toHaveLength(massa.length);
    expect(result.current.stageData["novo"].totalCount).toBe(massa.length);

    // Toda página depois da primeira carrega o par completo do cursor.
    const paginas = rpc.mock.calls.filter(([fn]) => fn === "get_pipeline_page").map(([, p]) => p);
    expect(paginas[0]).toMatchObject({ p_cursor: null, p_cursor_id: null });
    for (const p of paginas.slice(1)) {
      expect(typeof p.p_cursor).toBe("string");
      expect(typeof p.p_cursor_id).toBe("string");
    }
  });

  it("“selecionar todos da etapa” (fetchStageEntryRefs) alcança os empatados", async () => {
    const massa = massaComEmpates();
    rpc.mockImplementation(keysetRpc(massa));

    const { refs, truncated } = await fetchStageEntryRefs({
      pipelineId: PIPELINE_ID,
      stageKey: "novo",
      filterParams: {} as never,
      pageSize: PAGE_SIZE,
    });

    expect(truncated).toBe(false);
    expect(new Set(refs.map((r) => r.entryId)).size).toBe(massa.length);
    expect(refs).toHaveLength(massa.length);
  });

  it("controle: com o cursor só de created_at (contrato antigo) a mesma massa perdia cards", async () => {
    const massa = massaComEmpates();
    const fake = keysetRpc(massa);
    let cursor: string | null = null;
    const vistos: string[] = [];
    for (;;) {
      const { data } = await fake("get_pipeline_page", { p_stage_id: "novo", p_page_size: PAGE_SIZE, p_cursor: cursor, p_cursor_id: null });
      vistos.push(...data.map((r) => (r as FakeRow).id));
      if (data.length < PAGE_SIZE) break;
      cursor = (data[data.length - 1] as FakeRow).created_at;
    }
    expect(vistos.length).toBeLessThan(massa.length);
  });
});

// ── Quadro numa chamada (get_pipeline_board, migration 20280123000000) ──────
//
// O dublê do quadro é DERIVADO do mesmo dublê de get_pipeline_page
// (`keysetRpc`): a 1ª página de cada coluna no quadro é, por construção, a 1ª
// página da RPC por coluna. A prova de equivalência no banco é o pgTAP
// `funil_quadro_numa_chamada_test.sql`; aqui o que se prova é a HIDRATAÇÃO.
function quadroRpc(massa: FakeRow[], opcoes: { ausente?: boolean } = {}) {
  const porColuna = keysetRpc(massa);
  return async (fn: string, params: Record<string, unknown>) => {
    if (fn === "get_pipeline_board") {
      if (opcoes.ausente) {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      }
      const keys = params.p_stage_keys as string[];
      const columns: Record<string, unknown[]> = {};
      for (const k of keys) {
        const { data } = await porColuna("get_pipeline_page", { p_stage_id: k, p_page_size: params.p_page_size, p_cursor: null, p_cursor_id: null });
        columns[k] = data;
      }
      return {
        data: {
          counts: [
            { stage_id: "s-a", stage_key: "novo", cnt: massa.length - 1 },
            { stage_id: null, stage_key: "novo", cnt: 1 },
          ],
          columns,
        },
        error: null,
      };
    }
    return porColuna(fn, params);
  };
}

describe("usePaginatedFunil — quadro numa chamada", () => {
  it("abre com UMA ida: nenhuma página por coluna, nenhuma contagem avulsa", async () => {
    const massa = massaComEmpates();
    rpc.mockImplementation(quadroRpc(massa));

    const { result } = renderHook(
      () => usePaginatedFunil(PIPELINE_ID, [{ stage_key: "novo" }, { stage_key: "ganho" }]),
      { wrapper },
    );
    await waitFor(() => expect(result.current.stageData["novo"]?.items).toHaveLength(PAGE_SIZE));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const nomes = rpc.mock.calls.map(([fn]) => fn);
    expect(nomes.filter((n) => n === "get_pipeline_board")).toHaveLength(1);
    expect(nomes).not.toContain("get_pipeline_page");
    expect(nomes).not.toContain("get_pipeline_stage_counts_by_id");

    // Pedido do quadro: mesmas etapas, mesmo PAGE_SIZE, funil por id.
    const [, args] = rpc.mock.calls.find(([fn]) => fn === "get_pipeline_board")!;
    expect(args).toMatchObject({ p_pipeline_id: PIPELINE_ID, p_stage_keys: ["novo", "ganho"], p_page_size: PAGE_SIZE, p_org_id: "org-1" });

    // Ordem da coluna = ordem da RPC por coluna; contagem soma a linha fantasma.
    const esperado = (await keysetRpc(massa)("get_pipeline_page", { p_stage_id: "novo", p_page_size: PAGE_SIZE, p_cursor: null, p_cursor_id: null })).data;
    expect(result.current.stageData["novo"].items.map((e) => (e as { id: string }).id)).toEqual(
      esperado.map((r) => (r as FakeRow).id),
    );
    expect(result.current.stageData["novo"].totalCount).toBe(massa.length);
    expect(result.current.stageData["novo"].hasMore).toBe(true);
    expect(result.current.stageData["ganho"].items).toEqual([]);
    expect(result.current.stageData["ganho"].hasMore).toBe(false);
  });

  it("“carregar mais” depois do quadro segue em get_pipeline_page com o cursor composto da última linha", async () => {
    const massa = massaComEmpates();
    rpc.mockImplementation(quadroRpc(massa));

    const { result } = renderHook(() => usePaginatedFunil(PIPELINE_ID, [{ stage_key: "novo" }]), { wrapper });
    await waitFor(() => expect(result.current.stageData["novo"]?.items).toHaveLength(PAGE_SIZE));
    const ultima = result.current.stageData["novo"].items[PAGE_SIZE - 1] as { id: string; created_at: string };

    await act(async () => result.current.stageData["novo"].fetchMore());
    await waitFor(() => expect(result.current.stageData["novo"].items).toHaveLength(2 * PAGE_SIZE));

    const paginas = rpc.mock.calls.filter(([fn]) => fn === "get_pipeline_page").map(([, p]) => p);
    expect(paginas).toHaveLength(1);
    expect(paginas[0]).toMatchObject({ p_cursor: ultima.created_at, p_cursor_id: ultima.id, p_stage_id: "novo" });
  });

  it("quadro ausente (PGRST202): a tela cai nas páginas por coluna, sem erro", async () => {
    const massa = massaComEmpates();
    rpc.mockImplementation(quadroRpc(massa, { ausente: true }));

    const { result } = renderHook(() => usePaginatedFunil(PIPELINE_ID, [{ stage_key: "novo" }]), { wrapper });
    await waitFor(() => expect(result.current.stageData["novo"]?.items).toHaveLength(PAGE_SIZE));
    const nomes = rpc.mock.calls.map(([fn]) => fn);
    expect(nomes).toContain("get_pipeline_board");
    expect(nomes).toContain("get_pipeline_page");
    expect(nomes).toContain("get_pipeline_stage_counts_by_id");
  });

  it("enquanto o quadro não volta, a coluna fica em carregamento (não 'vazia')", async () => {
    let soltar: (v: unknown) => void = () => {};
    rpc.mockImplementation((fn: string) =>
      fn === "get_pipeline_board" ? new Promise((r) => { soltar = r; }) : Promise.resolve({ data: [], error: null }),
    );
    const { result } = renderHook(() => usePaginatedFunil(PIPELINE_ID, [{ stage_key: "novo" }]), { wrapper });
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === "get_pipeline_board")).toBe(true));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.stageData["novo"].isLoading).toBe(true);
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(["get_pipeline_board"]);
    soltar({ data: { counts: [], columns: { novo: [] } }, error: null });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(["get_pipeline_board"]);
  });
});
