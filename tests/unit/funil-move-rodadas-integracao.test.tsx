/* eslint-disable @typescript-eslint/no-explicit-any -- harness de integração: dublês de borda (cliente Supabase encadeável, modais stub) são `any` por natureza. */
/**
 * Rodadas de busca de um move no `/funil` — integração (portado do harness do
 * QA, volta 1).
 *
 * Board real (`usePaginatedFunil`, 14 colunas), cabeçalho real
 * (`useFunilMetrics`) e move real (`useMoverCardNoFunil`) sobre UM QueryClient
 * real. Só a borda é dublada: o cliente Supabase (banco em memória que responde
 * `get_pipeline_page`/contagens a partir do estado atual) e o canal Realtime
 * (o handler é capturado e o teste emite o evento). Relógio falso: janelas de
 * segundos passam em microssegundos.
 *
 * Números de referência (main 566880b3e, medidos pelo QA): move = 14 colunas +
 * 1 contagem, eco = +14 +1; custom 28 +2 +14 +1; mount = 2 contagens; rajada de
 * 11 eventos = 14 + 1. Aqui: move = 2 + 1, eco = 0, mount = 1, rajada = só as
 * colunas tocadas + 1.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = { id: string; pipeline_id: string; stage_key: string; lead_id: string; created_at: string };

const h = vi.hoisted(() => ({
  state: {
    db: new Map<string, any>(),
    page: [] as string[],
    counts: 0,
    desfecho: 0,
    gate: null as Promise<void> | null,
    falharUpdate: false,
    handlers: [] as Array<(p: unknown) => void>,
  },
}));
const S = h.state;

vi.mock("@/integrations/supabase/client", () => {
  const stageKeyDoId = (id: string) => id.replace(/^id-/, "");
  async function escrever(id: string, patch: Record<string, unknown>) {
    if (S.gate) await S.gate;
    if (S.falharUpdate) return { data: null, error: { message: "RLS negou" } };
    const row = S.db.get(id);
    if (!row) return { data: null, error: { message: "não achou" } };
    if (typeof patch.stage_key === "string") row.stage_key = patch.stage_key;
    if (typeof patch.stage_id === "string") row.stage_key = stageKeyDoId(patch.stage_id);
    return { data: { ...row }, error: null };
  }
  async function rpc(name: string, args: Record<string, any>) {
    if (name === "get_pipeline_page") {
      S.page.push(args.p_stage_id);
      const rows = [...S.db.values()].filter(
        (r) => r.pipeline_id === args.p_pipeline_id && r.stage_key === args.p_stage_id,
      );
      return { data: rows.map((r) => ({ ...r })), error: null };
    }
    if (name === "get_pipeline_stage_counts_by_id") {
      S.counts++;
      const m: Record<string, number> = {};
      for (const r of S.db.values()) if (r.pipeline_id === args.p_pipeline_id) m[r.stage_key] = (m[r.stage_key] ?? 0) + 1;
      return { data: Object.entries(m).map(([stage_key, cnt]) => ({ stage_key, cnt })), error: null };
    }
    if (name === "get_funil_desfecho_counts") {
      S.desfecho++;
      return { data: [], error: null };
    }
    if (name === "fn_entrada_custom_atualizar") {
      const r = await escrever(args.p_entry_id, args.p_patch);
      return { data: null, error: r.error };
    }
    return { data: null, error: { message: `RPC sem dublê: ${name}` } };
  }
  function from(table: string) {
    const st: { op: string; patch: Record<string, unknown> | null; f: Record<string, unknown> } = { op: "select", patch: null, f: {} };
    const resolver = async () => {
      if (table === "pipeline_entries" && st.op === "update") return escrever(st.f.id as string, st.patch!);
      if (table === "pipeline_entries") return { data: { ...S.db.get(st.f.id as string) }, error: null };
      if (table === "pipeline_stages") {
        return {
          data: {
            stage_key: stageKeyDoId(String(st.f.id)),
            is_final_positive: false,
            target_pipeline_id: null,
            target_stage_id: null,
            target_pipe_type: null,
            target_stage_key: null,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => ((st.f[c] = v), b),
      in: () => b,
      order: () => b,
      limit: () => b,
      single: () => b,
      maybeSingle: () => b,
      update: (p: Record<string, unknown>) => ((st.op = "update"), (st.patch = p), b),
      insert: () => ((st.op = "insert"), b),
      then: (ok: any, ko: any) => resolver().then(ok, ko),
    };
    return b;
  }
  return {
    supabase: {
      rpc: (n: string, a: Record<string, unknown>) => rpc(n, a),
      from,
      auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
    },
  };
});

vi.mock("@/modules/identity", async (orig) => ({
  ...(await orig<typeof import("@/modules/identity")>()),
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));
vi.mock("@/shared/realtime/realtime-org-context", async (orig) => ({
  ...(await orig<typeof import("@/shared/realtime/realtime-org-context")>()),
  useRealtimeOrgId: () => "org-1",
}));
vi.mock("@/shared/realtime/useRealtimeChannel", async (orig) => ({
  ...(await orig<typeof import("@/shared/realtime/useRealtimeChannel")>()),
  useRealtimeChannel: (o: { table: string; onEvent: (p: unknown) => void; enabled?: boolean }) => {
    if (o.table === "pipeline_entries" && o.enabled !== false) S.handlers.push(o.onEvent);
    return { state: "joined", diagnostics: [] };
  },
}));
const PL = "pl-1";
const STAGES = Array.from({ length: 14 }, (_, i) => ({
  id: `id-s${i}`,
  stage_key: `s${i}`,
  stage_role: i === 12 ? "won" : i === 13 ? "lost" : "open",
}));
vi.mock("@/modules/pipelines/hooks/model/usePipelines", () => ({
  usePipelines: () => ({ data: [{ id: "pl-1", slug: "meu-funil", type: "custom", name: "Meu" }] }),
}));
vi.mock("@/modules/pipelines/hooks/model/useStagesDoFunil", () => ({
  useStagesDoFunil: () => ({ data: STAGES, isLoading: false }),
}));
vi.mock("@/modules/pipelines/hooks/config/usePipeMetrics", () => ({
  usePipeWhatsappMetrics: () => ({ data: undefined, isLoading: false }),
  usePipeConfirmacaoMetrics: () => ({ data: undefined, isLoading: false }),
  usePipePropostasMetrics: () => ({ data: undefined, isLoading: false }),
}));

import { usePaginatedFunil, useMoverCardNoFunil } from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import { useFunilMetrics } from "@/modules/pipelines/hooks/config/useFunilMetrics";

import { __limparEcosProprios } from "@/modules/pipelines/lib/funil-move-cache";

/** Avança o relógio falso (e deixa promessas/notificações do React Query correrem). */
const sleep = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function semearBanco() {
  S.db.clear();
  let n = 0;
  for (let i = 0; i < 14; i++) {
    for (let j = 0; j < 3; j++) {
      const id = `e-${i}-${j}`;
      const row: Row = { id, pipeline_id: PL, stage_key: `s${i}`, lead_id: `l-${i}-${j}`, created_at: `2026-01-01T00:${String(n++).padStart(2, "0")}:00Z` };
      S.db.set(id, row);
    }
  }
  S.db.set("e-outro", { id: "e-outro", pipeline_id: "pl-2", stage_key: "x", lead_id: "l-x", created_at: "2026-01-01T00:00:00Z" });
}
function zerar() {
  S.page = [];
  S.counts = 0;
  S.desfecho = 0;
}
function fotografar() {
  return { get_pipeline_page: S.page.length, colunas: [...new Set(S.page)].sort(), counts: S.counts, desfecho: S.desfecho };
}
function emitir(p: unknown) {
  const vivo = S.handlers[S.handlers.length - 1];
  if (!vivo) throw new Error("canal não montado");
  vivo(p);
}

async function montar(type: "system" | "custom") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const r = renderHook(
    () => ({
      board: usePaginatedFunil(PL, STAGES as any),
      header: useFunilMetrics(PL, null),
      mover: useMoverCardNoFunil({ id: PL, type }),
    }),
    { wrapper },
  );
  await waitFor(() => expect(r.result.current.board.isLoading).toBe(false), { timeout: 5000 });
  await waitFor(() => expect(r.result.current.header.generic).not.toBeNull());
  await act(async () => {
    await sleep(50);
  });
  return { qc, r };
}
async function assentar(qc: QueryClient, ms = 150) {
  await act(async () => {
    await sleep(ms);
  });
  await waitFor(() => expect(qc.isFetching()).toBe(0), { timeout: 8000 });
}
const ids = (r: any, s: string): string[] => (r.result.current.board.stageData[s]?.items ?? []).map((e: { id: string }) => e.id);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  __limparEcosProprios();
  semearBanco();
  zerar();
  S.gate = null;
  S.falharUpdate = false;
  S.handlers = [];
});
afterEach(() => {
  vi.useRealTimers();
});

/** Evento UPDATE com a linha atual do banco (como o Postgres ecoaria). */
const ecoDe = (id: string) => ({ eventType: "UPDATE", new: { ...S.db.get(id) }, old: { id } });

describe("montagem", () => {
  it("board + cabeçalho sem filtro: a contagem roda UMA vez (main: 2)", async () => {
    await montar("system");
    expect(S.counts).toBe(1);
    expect(S.page).toHaveLength(14);
  });
});

describe.each(["system", "custom"] as const)("move %s", (type) => {
  it("card muda antes da resposta; UMA rodada (origem + destino + contagem); eco = 0", async () => {
    const { qc, r } = await montar(type);
    zerar();

    let soltar: () => void = () => {};
    S.gate = new Promise<void>((res) => (soltar = res));
    act(() => {
      r.result.current.mover.mutate({ entryId: "e-0-0", stageId: "id-s1", stageKey: "s1" });
    });
    await act(async () => {
      await sleep(80);
    });
    // Otimismo: escrita ainda pendente e o card já está em s1.
    expect(ids(r, "s0")).not.toContain("e-0-0");
    expect(ids(r, "s1")).toContain("e-0-0");
    expect(r.result.current.board.stageData.s0.totalCount).toBe(2);
    expect(r.result.current.board.stageData.s1.totalCount).toBe(4);

    const g = S.gate;
    S.gate = null;
    soltar();
    await g;
    await waitFor(() => expect(r.result.current.mover.isSuccess).toBe(true));
    await assentar(qc, 4600);
    expect(fotografar()).toMatchObject({ get_pipeline_page: 2, colunas: ["s0", "s1"], counts: 1 });
    zerar();

    act(() => emitir(ecoDe("e-0-0")));
    await assentar(qc, 4600);
    expect(fotografar()).toMatchObject({ get_pipeline_page: 0, counts: 0 });

    expect(ids(r, "s1")).toContain("e-0-0");
    expect(ids(r, "s0")).not.toContain("e-0-0");
    expect(r.result.current.board.stageCounts).toMatchObject({ s0: 2, s1: 4 });
    // Cabeçalho lê a MESMA contagem — atualizado junto com o board.
    expect(r.result.current.header.generic?.byStageKey).toMatchObject({ s0: 2, s1: 4 });
  });

  it("move com erro: card e contagem voltam", async () => {
    const { qc, r } = await montar(type);
    zerar();
    S.falharUpdate = true;
    let p!: Promise<unknown>;
    act(() => {
      p = r.result.current.mover.mutateAsync({ entryId: "e-0-0", stageId: "id-s1", stageKey: "s1" }).catch((e) => e);
    });
    await p;
    await assentar(qc);
    expect(ids(r, "s0")).toContain("e-0-0");
    expect(ids(r, "s1")).not.toContain("e-0-0");
    expect(r.result.current.board.stageCounts).toMatchObject({ s0: 3, s1: 3 });
    expect(r.result.current.mover.isError).toBe(true);
  });
});

describe("Realtime de OUTRO usuário", () => {
  it("rajada: 8 moves + INSERT de automação + saída de funil + outro funil → 1 lote só das colunas tocadas", async () => {
    const { qc, r } = await montar("system");
    zerar();
    await act(async () => {
      for (let j = 0; j < 3; j++) {
        const pares: Array<[string, string]> = [["e-2-" + j, "s3"], ["e-4-" + j, "s5"]];
        if (j < 2) pares.push(["e-6-" + j, "s7"]);
        for (const [id, to] of pares) {
          S.db.get(id).stage_key = to;
          emitir(ecoDe(id));
          await sleep(20);
        }
      }
      S.db.set("e-auto", { id: "e-auto", pipeline_id: PL, stage_key: "s9", lead_id: "l-auto", created_at: "2026-02-01T00:00:00Z" });
      emitir({ eventType: "INSERT", new: { ...S.db.get("e-auto") }, old: {} });
      Object.assign(S.db.get("e-10-0"), { pipeline_id: "pl-2", stage_key: "x" });
      emitir(ecoDe("e-10-0"));
      emitir({ eventType: "UPDATE", new: { id: "e-outro", pipeline_id: "pl-2", stage_key: "y" }, old: { id: "e-outro" } });
    });
    await assentar(qc, 4600);
    // main: 14 colunas + 1 contagem. Aqui: as 8 colunas tocadas, uma vez cada.
    expect(fotografar()).toMatchObject({
      get_pipeline_page: 8,
      colunas: ["s10", "s2", "s3", "s4", "s5", "s6", "s7", "s9"],
      counts: 1,
    });
    expect(ids(r, "s9")).toContain("e-auto"); // lead criado por automação aparece
    expect(ids(r, "s10")).not.toContain("e-10-0"); // card que saiu do funil some
    expect(ids(r, "s3")).toHaveLength(6);
    expect(ids(r, "s2")).toHaveLength(0);
    expect(r.result.current.board.stageCounts).toMatchObject({ s3: 6, s9: 4, s10: 2 });
  });

  it("evento SÓ de outro funil da org: 0 buscas (main: 14 + 1)", async () => {
    const { qc } = await montar("system");
    zerar();
    act(() => emitir({ eventType: "UPDATE", new: { id: "e-outro", pipeline_id: "pl-2", stage_key: "y" }, old: { id: "e-outro" } }));
    await assentar(qc, 4600);
    expect(fotografar()).toMatchObject({ get_pipeline_page: 0, counts: 0 });
  });
});

describe("telas vizinhas e eco", () => {
  it("painéis abertos DEPOIS do move buscam dado novo (marcados velhos, sem busca no move)", async () => {
    const { qc, r } = await montar("system");
    const chaves: unknown[][] = [
      ["leads-deals", "org-1", ["l-0-0"]],
      ["leads-sales-metrics", "org-1", ["l-0-0"]],
      ["deal-card-extras", "e-0-0", PL, "s0"],
      ["lead-pipes", "l-0-0"],
      ["lead-timeline", "l-0-0", {}, 0],
    ];
    for (const k of chaves) qc.setQueryData(k, { velho: true });
    await act(async () => {
      await r.result.current.mover.mutateAsync({ entryId: "e-0-0", stageId: "id-s1", stageKey: "s1" });
    });
    await assentar(qc);
    const buscas: Record<string, number> = {};
    const { useQuery } = await import("@tanstack/react-query");
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(
      () =>
        chaves.map((k) =>
          useQuery({
            queryKey: k,
            staleTime: 60_000,
            queryFn: async () => {
              buscas[String(k[0])] = (buscas[String(k[0])] ?? 0) + 1;
              return { velho: false };
            },
          }),
        ),
      { wrapper },
    );
    await assentar(qc);
    expect(buscas).toEqual({
      "leads-deals": 1,
      "leads-sales-metrics": 1,
      "deal-card-extras": 1,
      "lead-pipes": 1,
      "lead-timeline": 1,
    });
  });

  it("R1: meu move s0→s1; outro usuário s1→s2→s1 em < 10 s — card termina em s1, badges certos", async () => {
    const { qc, r } = await montar("system");
    await act(async () => {
      await r.result.current.mover.mutateAsync({ entryId: "e-0-0", stageId: "id-s1", stageKey: "s1" });
    });
    await assentar(qc);
    act(() => emitir(ecoDe("e-0-0"))); // meu eco
    await assentar(qc, 1200);

    S.db.get("e-0-0").stage_key = "s2";
    act(() => emitir(ecoDe("e-0-0")));
    await assentar(qc, 1200);
    expect(ids(r, "s2")).toContain("e-0-0");

    zerar();
    S.db.get("e-0-0").stage_key = "s1";
    act(() => emitir(ecoDe("e-0-0")));
    await assentar(qc, 1200);
    expect(fotografar().get_pipeline_page).toBeGreaterThan(0);
    expect(ids(r, "s1")).toContain("e-0-0");
    expect(ids(r, "s2")).not.toContain("e-0-0");
    expect(r.result.current.board.stageCounts).toMatchObject({ s1: 4, s2: 3 });
  });
});
