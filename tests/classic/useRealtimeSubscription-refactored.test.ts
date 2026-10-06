/**
 * Interface CLÁSSICA — cópia de `tests/unit/useRealtimeSubscription-refactored.test.ts` com `@` → `classic/src`
 * (`vitest.classic.config.ts`). Port de 2026-10-05: agendador de invalidações (frescor só com resultado, espera por evento, ciclo de vida) e alvos compostos.
 * Mantenha as duas cópias iguais abaixo deste bloco.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { InfiniteQueryObserver, QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";

// ─── Mock useRealtimeChannel ─────────────────────────────────────────────────

const mockUseRealtimeChannel = vi.hoisted(() => vi.fn());

vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: mockUseRealtimeChannel,
}));

// ─── Mock realtime org context ───────────────────────────────────────────────
// O hook lê o org-id de @/shared/realtime/realtime-org-context (slice 9.1b),
// não mais de @/modules/identity. Mockamos a fonte para fornecer o org-id.

const mockOrgId = "org-123-abc";
vi.mock("@/shared/realtime/realtime-org-context", () => ({
  useRealtimeOrgId: () => mockOrgId,
}));

// ─── TanStack Query: o REAL, com espiões ─────────────────────────────────────
// O dublê antigo (objeto com dois métodos) não tinha cache: não dava para
// provar coalescência, `isFetching` nem prefixo. Dublê por spread do real —
// um export novo do pacote não quebra este arquivo.

const qcRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const real = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...real, useQueryClient: () => qcRef.current };
});

// ─── Import after mocks ─────────────────────────────────────────────────────

import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { RealtimeHandlers } from "@/shared/realtime/useRealtimeSubscription";
import {
  invalidateOnceSettled,
  lastRealtimeDelivery,
  recordRealtimeDelivery,
  retainInvalidationScheduler,
} from "@/shared/realtime/invalidation-scheduler";
import type { ChannelStateChange } from "@/shared/realtime/useRealtimeChannel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let qc: QueryClient;
let mockInvalidateQueries: ReturnType<typeof vi.spyOn>;
let mockSetQueriesData: ReturnType<typeof vi.spyOn>;
const unsubscribers: Array<() => void> = [];

/** Uma query ATIVA no cache (com observer), já com dado — como a tela deixa. */
function activeQuery(queryKey: QueryKey, data: unknown = []) {
  const queryFn = vi.fn(async () => data);
  qc.setQueryData(queryKey, data);
  const observer = new QueryObserver(qc, { queryKey, queryFn, staleTime: Infinity });
  unsubscribers.push(observer.subscribe(() => {}));
  return queryFn;
}

function captureOnEvent(callIndex = -1): (payload: unknown) => void {
  const call = mockUseRealtimeChannel.mock.calls.at(callIndex);
  return call?.[0]?.onEvent;
}

/** Chaves invalidadas, na ordem, achatadas para comparar. */
function invalidatedKeys(): string[] {
  return mockInvalidateQueries.mock.calls.map((c: unknown[]) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey));
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

const INSERT = (id = "1") => ({ eventType: "INSERT", new: { id }, old: {} });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useRealtimeSubscription (refactored to delegate transport)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setVisibility("visible");
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qcRef.current = qc;
    mockInvalidateQueries = vi.spyOn(qc, "invalidateQueries");
    mockSetQueriesData = vi.spyOn(qc, "setQueriesData");
    mockUseRealtimeChannel.mockReturnValue({ state: "joined", diagnostics: [] });
    activeQuery(["leads"]);
    activeQuery(["pipeline"]);
  });

  afterEach(() => {
    unsubscribers.splice(0).forEach((u) => u());
    qc.clear();
    setVisibility("visible");
    vi.useRealTimers();
  });

  // ─── 1. Calls useRealtimeChannel with correct table and org filter ────────

  describe("transport delegation", () => {
    it("calls useRealtimeChannel with table and org-based filter", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      expect(mockUseRealtimeChannel).toHaveBeenCalledTimes(1);
      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.table).toBe("leads");
      expect(opts.filter).toBe(`organization_id=eq.${mockOrgId}`);
      expect(typeof opts.onEvent).toBe("function");
    });

    it("passes enabled=true when hook is called normally", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.enabled).toBe(true);
    });

    it("repassa enabled=false ao transporte — sem canal aberto", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"], { enabled: false }));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.enabled).toBe(false);
      // O filtro de org não muda por causa do enabled.
      expect(opts.filter).toBe(`organization_id=eq.${mockOrgId}`);
    });

    it("filtro de org idêntico com opções de agendamento (opt-in não mexe em tenancy)", () => {
      renderHook(() =>
        useRealtimeSubscription("leads", [["leads", "list", "org"]], {
          quietMs: 30_000,
          maxWaitMs: 30_000,
          whenHidden: "defer",
        }),
      );

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.filter).toBe(`organization_id=eq.${mockOrgId}`);
    });
  });

  // ─── 2. Tables without org_id get no filter ──────────────────────────────

  describe("TABLES_WITHOUT_ORG_ID", () => {
    it.each(["team_members", "user_roles", "profiles", "master_users", "tags", "blast_plan_recipients", "lead_scores"])(
      "%s gets no org filter",
      (table) => {
        renderHook(() => useRealtimeSubscription(table, [table]));

        const opts = mockUseRealtimeChannel.mock.calls[0][0];
        expect(opts.filter).toBeUndefined();
      },
    );
  });

  // ─── 3. INSERT → query key invalidation ──────────────────────────────────

  describe("INSERT event", () => {
    it("invalidates primary query key after debounce", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent(INSERT());
      });

      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["leads"], refetchType: "active" }),
        expect.anything(),
      );
    });

    it("invalidates secondary query keys after stagger delay", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent(INSERT());
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // First key invalidated
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Secondary key invalidated
      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["pipeline"], refetchType: "active" }),
        expect.anything(),
      );
    });
  });

  // ─── 4. UPDATE → surgical cache update ───────────────────────────────────

  describe("UPDATE event with handler", () => {
    it("applies surgical cache update via setQueriesData", () => {
      const onUpdate = vi.fn((updated: Row, old: Row[]) =>
        old.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onUpdate })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1", name: "Updated" }, old: { id: "1" } });
      });

      expect(mockSetQueriesData).toHaveBeenCalledWith(
        { queryKey: ["leads"] },
        expect.any(Function)
      );
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("surgical update calls handler with correct args", () => {
      const onUpdate = vi.fn((updated: Row, old: Row[]) =>
        old.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onUpdate })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1", name: "New" }, old: { id: "1" } });
      });

      // Extract the updater function and call it
      const updaterFn = mockSetQueriesData.mock.calls[0][1] as (old: unknown) => unknown;
      const result = updaterFn([{ id: "1", name: "Old" }, { id: "2", name: "Keep" }]);

      expect(onUpdate).toHaveBeenCalledWith(
        { id: "1", name: "New" },
        [{ id: "1", name: "Old" }, { id: "2", name: "Keep" }]
      );
      expect(result).toEqual([
        { id: "1", name: "New" },
        { id: "2", name: "Keep" },
      ]);
    });

    it("patch legado num alvo composto atinge só o próprio prefixo", () => {
      type Row = { id: string };
      const onUpdate = vi.fn((u: Row, old: Row[]) => old.map((i) => (i.id === u.id ? { ...i, ...u } : i)));
      renderHook(() =>
        useRealtimeSubscription<Row>("pipeline_entries", [["pipeline_entries", "whatsapp", "org-1"]], { onUpdate }),
      );

      act(() => {
        captureOnEvent()({ eventType: "UPDATE", new: { id: "1" }, old: {} });
      });

      expect(mockSetQueriesData).toHaveBeenCalledWith(
        { queryKey: ["pipeline_entries", "whatsapp", "org-1"] },
        expect.any(Function),
      );
    });

    it("falls back to invalidation when no onUpdate handler", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1" }, old: {} });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockInvalidateQueries).toHaveBeenCalled();
      expect(mockSetQueriesData).not.toHaveBeenCalled();
    });
  });

  // ─── 5. DELETE → surgical removal ────────────────────────────────────────

  describe("DELETE event with handler", () => {
    it("applies surgical cache removal via setQueriesData", () => {
      const onDelete = vi.fn((deleted: Row, old: Row[]) =>
        old.filter((item) => item.id !== deleted.id)
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onDelete })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "DELETE", new: {}, old: { id: "1" } });
      });

      expect(mockSetQueriesData).toHaveBeenCalledWith(
        { queryKey: ["leads"] },
        expect.any(Function)
      );
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("falls back to invalidation when no onDelete handler", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "DELETE", new: {}, old: { id: "1" } });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockInvalidateQueries).toHaveBeenCalled();
      expect(mockSetQueriesData).not.toHaveBeenCalled();
    });
  });

  // ─── 6. Public interface unchanged ────────────────────────────────────────

  describe("public interface", () => {
    it("accepts (table, queryKeys) — no handlers", () => {
      // Must not throw
      const { result } = renderHook(() =>
        useRealtimeSubscription("leads", ["leads"])
      );
      expect(result.current).toBeUndefined(); // void return
    });

    it("accepts (table, queryKeys, handlers)", () => {
      const handlers: RealtimeHandlers = {
        onUpdate: (r, old) => old,
        onDelete: (r, old) => old,
      };
      const { result } = renderHook(() =>
        useRealtimeSubscription("leads", ["leads", "pipeline"], handlers)
      );
      expect(result.current).toBeUndefined(); // void return
    });
  });

  // ─── 7. Debounce: rapid events coalesced ──────────────────────────────────

  describe("debounce behavior", () => {
    it("multiple INSERT events within 2s produce single invalidation", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent(INSERT("1"));
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        onEvent(INSERT("2"));
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        onEvent(INSERT("3"));
      });

      // Not yet fired
      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      // Wait full debounce from last event
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Single invalidation
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    });

    it("surgical updates are NOT debounced (immediate)", () => {
      const onUpdate = vi.fn((u: Row, old: Row[]) =>
        old.map((i) => (i.id === u.id ? { ...i, ...u } : i))
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onUpdate })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1", v: 1 }, old: {} });
      });
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "2", v: 2 }, old: {} });
      });

      // Both applied immediately — no debounce
      expect(mockSetQueriesData).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 8. NÃO-REGRESSÃO: sem opt-in, a sequência temporal é a de antes ──────
  //
  // DO-1: 50 callers não-alvo (inclusive os hooks do chat, que outra sessão
  // está reescrevendo) não podem mudar de comportamento por baixo. Estes casos
  // passam no código antigo E no novo — é o contrato.

  describe("defaults preservam a sequência de hoje (debounce 2 s, stagger 2 s, aba oculta refaz)", () => {
    it("evento único: alvo 0 em t+2s, seguidores em t+4s, nada antes", () => {
      activeQuery(["third"]);
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline", "third"]));

      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(1999));
      expect(invalidatedKeys()).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      expect(invalidatedKeys()).toEqual(['["leads"]']);
      act(() => vi.advanceTimersByTime(1999));
      expect(invalidatedKeys()).toEqual(['["leads"]']);
      act(() => vi.advanceTimersByTime(1));
      expect(invalidatedKeys()).toEqual(['["leads"]', '["pipeline"]', '["third"]']);
    });

    it("rajada contínua (< 2 s entre eventos) segura tudo até o silêncio — sem teto por padrão", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));
      const onEvent = captureOnEvent();

      for (let i = 0; i < 30; i++) {
        act(() => onEvent(INSERT(String(i))));
        act(() => vi.advanceTimersByTime(1500));
      }
      // 45 s de eventos e nenhuma invalidação: debounce puro, como hoje.
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(500));
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    });

    it("eventos a cada 3 s: alvo 0 a cada ciclo; seguidor cobre todo evento no mesmo prazo de hoje (sem inanição)", async () => {
      const fetchedAt = { leads: [] as number[], pipeline: [] as number[] };
      for (const name of ["leads", "pipeline"] as const) {
        qc.removeQueries({ queryKey: [name] });
        const observer = new QueryObserver(qc, {
          queryKey: [name],
          queryFn: async () => {
            fetchedAt[name].push(Date.now());
            return [];
          },
          staleTime: Infinity,
        });
        unsubscribers.push(observer.subscribe(() => {}));
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const start = Date.now();
      fetchedAt.leads.length = 0;
      fetchedAt.pipeline.length = 0;

      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"]));
      const onEvent = captureOnEvent();

      // Eventos em t=0,3,6. Hoje: alvo 0 em 2,5,8; seguidor em 4,7,10.
      const events: number[] = [];
      for (let i = 0; i < 3; i++) {
        events.push(Date.now() - start);
        act(() => onEvent(INSERT(String(i))));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });

      expect(fetchedAt.leads.map((t) => t - start)).toEqual([2000, 5000, 8000]);
      // O seguidor pode pular um disparo cujo evento um fetch anterior já
      // cobriu (o de t=4 começou depois do evento de t=3) — nunca atrasar:
      // todo evento ganha um fetch do seguidor em até 4 s, como hoje.
      const follower = fetchedAt.pipeline.map((t) => t - start);
      for (const e of events) {
        expect(follower.some((t) => t > e && t <= e + 4000), `evento em ${e}`).toBe(true);
      }
    });

    it("aba oculta NÃO adia por padrão: invalida e refaz como hoje", () => {
      const queryFn = activeQuery(["hidden-target"]);
      renderHook(() => useRealtimeSubscription("leads", ["hidden-target"]));

      setVisibility("hidden");
      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(2000));

      expect(invalidatedKeys()).toEqual(['["hidden-target"]']);
      expect(queryFn).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 9. Alvos compostos: prefixo de verdade ─────────────────────────────

  describe("alvo composto invalida só o próprio prefixo", () => {
    it("[[a, b, c]] atinge a, b, c — e não os irmãos de a", () => {
      const whatsapp = activeQuery(["pipeline_entries", "whatsapp", "org-1", "p1"]);
      const propostas = activeQuery(["pipeline_entries", "propostas", "org-1", "p2"]);

      renderHook(() =>
        useRealtimeSubscription("pipeline_entries", [["pipeline_entries", "whatsapp", "org-1"]]),
      );
      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(4000));

      expect(whatsapp).toHaveBeenCalledTimes(1);
      expect(propostas).not.toHaveBeenCalled();
      expect(invalidatedKeys()).toEqual(['["pipeline_entries","whatsapp","org-1"]']);
    });

    it("lista de prefixos invalida cada um (o 2º no stagger)", () => {
      const a = activeQuery(["a", 1, "x"]);
      const b = activeQuery(["b", 2]);
      const other = activeQuery(["a", 2]);

      renderHook(() => useRealtimeSubscription("t", [["a", 1], ["b", 2]]));
      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(2000));
      expect(invalidatedKeys()).toEqual(['["a",1]']);
      act(() => vi.advanceTimersByTime(2000));
      expect(invalidatedKeys()).toEqual(['["a",1]', '["b",2]']);

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
    });

    it("string s ≡ [s]: lista plana de strings continua sendo N alvos de 1 segmento", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"]));
      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(4000));
      expect(invalidatedKeys()).toEqual(['["leads"]', '["pipeline"]']);
    });
  });

  // ─── 10. Coalescência e cancelRefetch ─────────────────────────────────────

  describe("coalescência entre instâncias + cancelRefetch:false", () => {
    it("2 instâncias com o mesmo alvo e o mesmo evento → 1 invalidação", () => {
      const queryFn = activeQuery(["shared"]);
      renderHook(() => useRealtimeSubscription("leads", ["shared"]));
      renderHook(() => useRealtimeSubscription("leads", ["shared"]));
      const first = captureOnEvent(0);
      const second = captureOnEvent(1);

      // O mesmo evento chega pelos dois canais.
      act(() => {
        first(INSERT());
        second(INSERT());
      });
      act(() => vi.advanceTimersByTime(2000));

      expect(invalidatedKeys()).toEqual(['["shared"]']);
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("evento já coberto por um refetch posterior não refaz de novo", () => {
      const queryFn = activeQuery(["shared"]);
      renderHook(() => useRealtimeSubscription("a", ["shared"]));
      renderHook(() => useRealtimeSubscription("b", ["shared"]));

      act(() => captureOnEvent(0)(INSERT("1"))); // t=0  → dispara t=2
      act(() => vi.advanceTimersByTime(1000));
      act(() => captureOnEvent(1)(INSERT("2"))); // t=1  → dispararia t=3
      act(() => vi.advanceTimersByTime(4000));

      // O refetch de t=2 começou depois do evento de t=1: um basta.
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("nunca cancela fetch em voo (cancelRefetch:false)", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));
      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(2000));

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
      expect(mockInvalidateQueries.mock.calls[0][1]).toEqual({ cancelRefetch: false });
    });

    it("alvo buscando no disparo → espera o fim desse fetch (evento do QueryCache) e invalida logo depois", async () => {
      let release!: (v: unknown) => void;
      const slow = vi.fn(() => new Promise((r) => { release = r; }));
      const key = ["slow"];
      const observer = new QueryObserver(qc, { queryKey: key, queryFn: slow, staleTime: Infinity });
      unsubscribers.push(observer.subscribe(() => {}));
      expect(slow).toHaveBeenCalledTimes(1); // fetch inicial em voo

      renderHook(() => useRealtimeSubscription("t", [key]));
      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(2000));
      // Em voo: nada de invalidar (cancelaria, ou deduplicaria contra o retrato velho).
      expect(invalidatedKeys()).toEqual([]);

      await act(async () => {
        release([]);
        await vi.advanceTimersByTimeAsync(0);
      });
      // Sem esperar outro debounce: o fim do fetch é o gatilho.
      expect(invalidatedKeys()).toEqual(['["slow"]']);
      expect(slow).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 10b. Frescor só com resultado; espera por evento; ciclo de vida ──────

  describe("frescor = resultado que chegou, não fetch que começou", () => {
    it("fetchNextPage depois do evento não conta: as páginas do cache continuam velhas e o refetch vem", async () => {
      const key = ["infinite"];
      const pages = vi.fn(async ({ pageParam }: { pageParam: number }) => ({ page: pageParam }));
      renderHook(() => useRealtimeSubscription("t", [key]));
      const observer = new InfiniteQueryObserver(qc, {
        queryKey: key,
        queryFn: pages,
        initialPageParam: 0,
        getNextPageParam: (last: { page: number }) => last.page + 1,
        staleTime: Infinity,
      });
      unsubscribers.push(observer.subscribe(() => {}));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(pages).toHaveBeenCalledTimes(1);

      act(() => captureOnEvent()(INSERT()));
      await act(async () => {
        await observer.fetchNextPage(); // só a página 1 — a 0 segue com o retrato de antes
      });
      expect(pages.mock.calls.map(([c]) => c.pageParam)).toEqual([0, 1]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(invalidatedKeys()).toEqual(['["infinite"]']);
      // O refetch do infinite rebusca as duas páginas.
      expect(pages.mock.calls.map(([c]) => c.pageParam)).toEqual([0, 1, 0, 1]);
    });

    it("fetch cancelado com revert depois do evento não conta: o cache voltou ao retrato de antes", async () => {
      const key = ["cancelled"];
      let call = 0;
      const queryFn = vi.fn(() => {
        call += 1;
        return call === 2 ? new Promise<number[]>(() => {}) : Promise.resolve([call]);
      });
      renderHook(() => useRealtimeSubscription("t", [key]));
      const observer = new QueryObserver(qc, { queryKey: key, queryFn, staleTime: Infinity });
      unsubscribers.push(observer.subscribe(() => {}));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => captureOnEvent()(INSERT()));
      void observer.refetch(); // começa DEPOIS do evento…
      await act(async () => {
        await qc.cancelQueries({ queryKey: key }); // …e é cancelado com revert (padrão)
      });
      expect(qc.getQueryState(key)?.fetchStatus).toBe("idle");
      expect(qc.getQueryData(key)).toEqual([1]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(invalidatedKeys()).toEqual(['["cancelled"]']);
      expect(queryFn).toHaveBeenCalledTimes(3);
    });

    it("fetch que falha depois do evento não conta", async () => {
      const key = ["failed"];
      let call = 0;
      const queryFn = vi.fn(async () => {
        call += 1;
        if (call === 2) throw new Error("timeout");
        return [call];
      });
      renderHook(() => useRealtimeSubscription("t", [key]));
      const observer = new QueryObserver(qc, { queryKey: key, queryFn, staleTime: Infinity });
      unsubscribers.push(observer.subscribe(() => {}));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => captureOnEvent()(INSERT()));
      await act(async () => {
        await observer.refetch(); // começa depois do evento e falha
      });
      expect(qc.getQueryState(key)?.status).toBe("error");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(queryFn).toHaveBeenCalledTimes(3);
    });

    it("setQueryData com fetch em voo não conta (não é retrato do banco)", async () => {
      const key = ["patched"];
      let call = 0;
      const queryFn = vi.fn(() => {
        call += 1;
        return call === 2 ? new Promise<string[]>(() => {}) : Promise.resolve([`r${call}`]);
      });
      renderHook(() => useRealtimeSubscription("t", [key]));
      const observer = new QueryObserver(qc, { queryKey: key, queryFn, staleTime: Infinity });
      unsubscribers.push(observer.subscribe(() => {}));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => captureOnEvent()(INSERT()));
      void observer.refetch(); // começa depois do evento…
      act(() => {
        qc.setQueryData(key, ["patch local"]); // …um patch grava durante o voo…
      });
      await act(async () => {
        await qc.cancelQueries({ queryKey: key }); // …e o resultado nunca chega
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(queryFn).toHaveBeenCalledTimes(3);
    });
  });

  describe("fetch em voo: espera por evento, não por relógio", () => {
    it("quietMs de 30 s: o refetch sai no instante em que o fetch em voo termina — não 30 s depois", async () => {
      let release!: (v: unknown) => void;
      const calledAt: number[] = [];
      const slow = vi.fn(() => {
        calledAt.push(Date.now());
        return new Promise((r) => { release = r; });
      });
      const key = ["slow30"];
      renderHook(() => useRealtimeSubscription("t", [key], { quietMs: 30_000 }));
      const observer = new QueryObserver(qc, { queryKey: key, queryFn: slow, staleTime: Infinity });
      unsubscribers.push(observer.subscribe(() => {})); // começou ANTES do evento

      act(() => captureOnEvent()(INSERT()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000); // disparo: alvo buscando
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(slow).toHaveBeenCalledTimes(1);

      const endedAt = Date.now();
      await act(async () => {
        release([]);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(slow).toHaveBeenCalledTimes(2);
      expect(calledAt[1] - endedAt).toBe(0);
    });

    it("sem vazamento: o QueryCache só tem ouvinte enquanto há hook montado ou pedido pendente", async () => {
      const cache = qc.getQueryCache();
      expect(cache.hasListeners()).toBe(false);

      let release!: (v: unknown) => void;
      const slow = vi.fn(() => new Promise((r) => { release = r; }));
      const key = ["leak"];
      const first = renderHook(() => useRealtimeSubscription("t", [key]));
      const second = renderHook(() => useRealtimeSubscription("u", [key]));
      expect(cache.hasListeners()).toBe(true);
      const observer = new QueryObserver(qc, { queryKey: key, queryFn: slow, staleTime: Infinity });
      unsubscribers.push(observer.subscribe(() => {}));

      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(2000)); // pedido esperando o fetch em voo
      first.unmount();
      second.unmount();
      // Ninguém montado, mas o pedido ainda não foi servido: drena antes de soltar.
      expect(cache.hasListeners()).toBe(true);

      await act(async () => {
        release([]);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(slow).toHaveBeenCalledTimes(2);
      expect(cache.hasListeners()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("desmontar com debounce pendente: o disparo acontece (como sempre) e depois solta o cache", () => {
      const queryFn = activeQuery(["late"]);
      const hook = renderHook(() => useRealtimeSubscription("t", ["late"]));
      act(() => captureOnEvent()(INSERT()));
      hook.unmount();
      expect(qc.getQueryCache().hasListeners()).toBe(false);

      act(() => vi.advanceTimersByTime(2000));
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(qc.getQueryCache().hasListeners()).toBe(false);
    });

    it("invalidateOnceSettled: página ociosa buscando só é marcada DEPOIS que o fetch dela termina", async () => {
      let release!: (v: unknown) => void;
      const slow = vi.fn(() => new Promise((r) => { release = r; }));
      const key = ["idle-page"];
      const observer = new QueryObserver(qc, { queryKey: key, queryFn: slow, staleTime: Infinity });
      const unsubscribe = observer.subscribe(() => {}); // fetch em voo…
      unsubscribe(); // …e a página sai da tela (o fetch continua)

      act(() => invalidateOnceSettled(qc, key));
      expect(qc.getQueryState(key)?.isInvalidated).toBe(false);

      await act(async () => {
        release(["retrato de antes"]);
        await vi.advanceTimersByTimeAsync(0);
      });
      // Chegou, e só então ficou marcada: voltar a ela busca de novo.
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
      expect(slow).toHaveBeenCalledTimes(1);
      expect(qc.getQueryCache().hasListeners()).toBe(false);
    });
  });

  // ─── 11. Opt-in: maxWaitMs, whenHidden:"defer", minAgeMs ──────────────────

  describe("opt-in", () => {
    it("maxWaitMs põe teto na rajada contínua", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"], { quietMs: 2000, maxWaitMs: 5000 }));
      const onEvent = captureOnEvent();

      for (let i = 0; i < 8; i++) {
        act(() => onEvent(INSERT(String(i))));
        act(() => vi.advanceTimersByTime(1000));
      }
      // Eventos a cada 1 s por 8 s: debounce puro nunca dispararia; o teto
      // dispara aos 5 s.
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    });

    it('whenHidden:"defer" segura com a aba oculta e dispara uma vez ao voltar', () => {
      const queryFn = activeQuery(["deferred"]);
      renderHook(() => useRealtimeSubscription("leads", ["deferred"], { whenHidden: "defer" }));

      setVisibility("hidden");
      for (let i = 0; i < 5; i++) {
        act(() => captureOnEvent()(INSERT(String(i))));
        act(() => vi.advanceTimersByTime(10_000));
      }
      expect(queryFn).not.toHaveBeenCalled();

      act(() => setVisibility("visible"));
      expect(queryFn).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(60_000));
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("minAgeMs: alvo jovem espera completar a idade; um refetch, não zero", () => {
      const queryFn = activeQuery(["young"]);
      renderHook(() => useRealtimeSubscription("leads", [{ queryKey: ["young"], minAgeMs: 60_000 }]));

      act(() => vi.advanceTimersByTime(10_000)); // dado com 10 s
      act(() => captureOnEvent()(INSERT()));
      act(() => vi.advanceTimersByTime(2000)); // disparo em t=12 s: jovem
      expect(queryFn).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(47_999)); // t=59,999 s
      expect(queryFn).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1)); // t=60 s
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("onEvent decide: skip não agenda nada; subconjunto agenda só o pedido", () => {
      const a = activeQuery(["a"]);
      const b = activeQuery(["b"]);
      const decisions: Array<"skip" | { invalidate: string[] }> = ["skip", { invalidate: ["b"] }];
      renderHook(() =>
        useRealtimeSubscription("t", ["a", "b"], { onEvent: () => decisions.shift()! }),
      );

      act(() => captureOnEvent()(INSERT("1")));
      act(() => vi.advanceTimersByTime(10_000));
      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      act(() => captureOnEvent()(INSERT("2")));
      act(() => vi.advanceTimersByTime(10_000));
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });
  });
  // ─── 12. Opt-in: catchUpOnSubscribe (recuperação no SUBSCRIBED) ───────────
  // O transporte é dublado: cada `renderHook` aqui é um canal físico próprio
  // (o caso "mesma chave lógica, canais físicos distintos"). O canal
  // compartilhado de verdade está em `realtime-catchup-transporte-real`.

  describe("catchUpOnSubscribe — recuperação no SUBSCRIBED", () => {
    type Transport = (change: ChannelStateChange) => void;
    /** `onStateChange` que a instância recém-montada passou ao transporte. */
    const transport = (): Transport => mockUseRealtimeChannel.mock.calls.at(-1)?.[0]?.onStateChange;
    /** A instância entra no canal e o encontra em `state` (1ª transição, dentro do acquire). */
    const enter = (t: Transport, state: ChannelStateChange["state"], failureCount = 0) =>
      act(() => t({ state, failureCount, initial: true }));
    const goTo = (t: Transport, ...states: Array<ChannelStateChange["state"]>) => {
      for (const state of states) act(() => t({ state, failureCount: state === "joined" ? 0 : 1, initial: false }));
    };

    it("padrão (sem opt-in): outro canal recebe no vão, entra, cai e volta — nenhuma invalidação (DO-1)", () => {
      renderHook(() => useRealtimeSubscription("leads", [["sibling"]]));
      const deliverToSibling = captureOnEvent();
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"]));
      const t = transport();
      enter(t, "joining");
      act(() => deliverToSibling(INSERT()));
      goTo(t, "joined", "errored", "joining", "joined", "polling", "joining", "joined");
      act(() => vi.advanceTimersByTime(120_000));
      expect(invalidatedKeys()).not.toContain('["leads"]');
      expect(invalidatedKeys()).not.toContain('["pipeline"]');
    });

    it("1º join sem entrega a ninguém no vão → 0 invalidação", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"], { catchUpOnSubscribe: true }));
      const t = transport();
      enter(t, "joining");
      goTo(t, "joined");
      act(() => vi.advanceTimersByTime(120_000));
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("outro canal físico da mesma chave recebeu evento enquanto este entrava → agenda os alvos como um evento (alvo 0 no quietMs, seguidores no stagger)", () => {
      renderHook(() => useRealtimeSubscription("leads", [["sibling"]]));
      const deliverToSibling = captureOnEvent();
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"], { catchUpOnSubscribe: true }));
      const t = transport();
      enter(t, "joining");
      act(() => deliverToSibling(INSERT()));
      goTo(t, "joined");

      act(() => vi.advanceTimersByTime(1_999));
      expect(invalidatedKeys()).not.toContain('["leads"]');
      act(() => vi.advanceTimersByTime(1));
      expect(invalidatedKeys()).toContain('["leads"]');
      expect(invalidatedKeys()).not.toContain('["pipeline"]');
      act(() => vi.advanceTimersByTime(2_000));
      expect(invalidatedKeys()).toContain('["pipeline"]');
    });

    it("entrega a outro canal ANTES de este entrar → 0 (já estava no retrato da montagem)", () => {
      renderHook(() => useRealtimeSubscription("leads", [["sibling"]]));
      act(() => captureOnEvent()(INSERT()));
      renderHook(() => useRealtimeSubscription("leads", ["leads"], { catchUpOnSubscribe: true }));
      const t = transport();
      enter(t, "joining");
      goTo(t, "joined");
      act(() => vi.advanceTimersByTime(120_000));
      expect(invalidatedKeys()).not.toContain('["leads"]');
    });

    it("entrega em OUTRA tabela não conta", () => {
      renderHook(() => useRealtimeSubscription("deals", [["sibling"]]));
      const deliverToOtherTable = captureOnEvent();
      renderHook(() => useRealtimeSubscription("leads", ["leads"], { catchUpOnSubscribe: true }));
      const t = transport();
      enter(t, "joining");
      act(() => deliverToOtherTable(INSERT()));
      goTo(t, "joined");
      act(() => vi.advanceTimersByTime(120_000));
      expect(invalidatedKeys()).not.toContain('["leads"]');
    });

    it("entra num canal JÁ joined (outra instância abriu) → 0, mesmo com entrega no mesmo instante", () => {
      renderHook(() => useRealtimeSubscription("leads", [["sibling"]]));
      const deliverToSibling = captureOnEvent();
      renderHook(() => useRealtimeSubscription("leads", ["leads"], { catchUpOnSubscribe: true }));
      const t = transport();
      enter(t, "joined");
      act(() => deliverToSibling(INSERT()));
      goTo(t, "joined");
      act(() => vi.advanceTimersByTime(120_000));
      expect(invalidatedKeys()).not.toContain('["leads"]');
    });

    for (const [found, failures] of [["errored", 1], ["polling", 5], ["joining", 2]] as const) {
      it(`entra num canal CAÍDO (${found}, ${failures} falha(s)) → no SUBSCRIBED agenda os alvos uma vez`, () => {
        renderHook(() => useRealtimeSubscription("leads", ["leads"], { catchUpOnSubscribe: true }));
        const t = transport();
        enter(t, found, failures);
        goTo(t, "joining");
        act(() => vi.advanceTimersByTime(10_000));
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
        goTo(t, "joined", "joined");
        act(() => vi.advanceTimersByTime(2_000));
        expect(invalidatedKeys()).toEqual(['["leads"]']);
        act(() => vi.advanceTimersByTime(120_000));
        expect(invalidatedKeys()).toEqual(['["leads"]']);
      });
    }

    for (const fall of [["errored", "joining"], ["polling", "joining"], ["errored"]] as const) {
      it(`cai (${fall.join(" → ")}) e volta → agenda os alvos UMA vez; joined repetido não reagenda`, () => {
        renderHook(() => useRealtimeSubscription("leads", ["leads"], { catchUpOnSubscribe: true }));
        const t = transport();
        enter(t, "joining");
        goTo(t, "joined");
        act(() => vi.advanceTimersByTime(10_000));
        expect(mockInvalidateQueries).not.toHaveBeenCalled();

        goTo(t, ...fall, "joined", "joined");
        act(() => vi.advanceTimersByTime(2_000));
        expect(invalidatedKeys()).toEqual(['["leads"]']);
        act(() => vi.advanceTimersByTime(120_000));
        expect(invalidatedKeys()).toEqual(['["leads"]']);
      });
    }

    // 1º join que falha: entrou `joining` sem falha e o canal cai ANTES do
    // SUBSCRIBED. O que entrou no vão não chegou a canal nenhum — nenhuma
    // entrega para comparar —, então agenda como volta de queda.
    for (const fall of [["errored", "joining"], ["polling", "joining"], ["errored", "joining", "errored", "joining"]] as const) {
      it(`1º join falha (joining → ${fall.join(" → ")} → joined) → agenda os alvos UMA vez, sem entrega no vão`, () => {
        renderHook(() => useRealtimeSubscription("leads", ["leads"], { catchUpOnSubscribe: true }));
        const t = transport();
        enter(t, "joining");
        goTo(t, ...fall);
        act(() => vi.advanceTimersByTime(10_000));
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
        goTo(t, "joined", "joined");
        act(() => vi.advanceTimersByTime(2_000));
        expect(invalidatedKeys()).toEqual(['["leads"]']);
        act(() => vi.advanceTimersByTime(120_000));
        expect(invalidatedKeys()).toEqual(['["leads"]']);
      });
    }

    it("canal compartilhado volta de queda com 3 instâncias no mesmo alvo → 1 busca (coalescida), não 3", async () => {
      const queryFn = vi.fn(async () => [{ id: "x" }]);
      const observer = new QueryObserver(qc, { queryKey: ["shared"], queryFn, staleTime: Infinity });
      unsubscribers.push(observer.subscribe(() => {}));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      queryFn.mockClear();
      const ts: Transport[] = [];
      for (let i = 0; i < 3; i++) {
        renderHook(() => useRealtimeSubscription("leads", [["shared"]], { catchUpOnSubscribe: true }));
        ts.push(transport());
        enter(ts[i], "joined");
      }
      // O registry notifica os 3 assinantes do canal, na mesma volta.
      for (const state of ["errored", "joining", "joined"] as const) {
        act(() => { for (const t of ts) t({ state, failureCount: state === "joined" ? 0 : 1, initial: false }); });
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("canal desligado (enabled=false) → nada, por mais que o estado mude", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"], { catchUpOnSubscribe: true, enabled: false }));
      const t = transport();
      enter(t, "joining");
      goTo(t, "joined", "errored", "joined");
      act(() => vi.advanceTimersByTime(120_000));
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });
  });

  // ─── 13. Entrega do canal compartilhado: 1 evento = 1 registro ────────────

  describe("recordRealtimeDelivery — o mesmo evento entregue a N instâncias", () => {
    it("mesmo objeto → mesma sequência e um registro só; objeto novo → sequência nova", () => {
      const release = retainInvalidationScheduler(qc);
      const evt = INSERT();
      const first = recordRealtimeDelivery(qc, "leads|*", evt);
      expect(recordRealtimeDelivery(qc, "leads|*", evt)).toBe(first);
      expect(recordRealtimeDelivery(qc, "leads|*", evt)).toBe(first);
      expect(lastRealtimeDelivery(qc, "leads|*")).toBe(first);
      const next = recordRealtimeDelivery(qc, "leads|*", INSERT());
      expect(next).toBeGreaterThan(first);
      expect(lastRealtimeDelivery(qc, "leads|*")).toBe(next);
      release();
    });

    it("duas instâncias recebem o MESMO payload (fan-out) → o alvo comum é refeito 1 vez", async () => {
      const queryFn = activeQuery(["fanout"]);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      renderHook(() => useRealtimeSubscription("leads", [["fanout"]]));
      const a = captureOnEvent();
      renderHook(() => useRealtimeSubscription("leads", [["fanout"]]));
      const b = captureOnEvent();
      const payload = INSERT();
      act(() => { a(payload); b(payload); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(invalidatedKeys().filter((k) => k === '["fanout"]')).toHaveLength(1);
    });
  });
});
