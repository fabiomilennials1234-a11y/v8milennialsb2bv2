/**
 * Dedup de canal Realtime por (tabela, filtro, evento) por aba — perf S0.
 *
 * Prod 2026-10-06: 551 assinaturas para 286 pares distintos (usuário, tabela,
 * filtro); `pipeline_stages` 111 assinaturas para 18 pares. Contrato:
 *   - N consumidores da mesma chave = 1 `supabase.channel()`, todos recebem o evento;
 *   - refcount: desmontar um não fecha; o último fecha;
 *   - chaves distintas = canais distintos (controle positivo do contador);
 *   - `joinCount` da statusKey sobe 1× por join REAL, não por consumidor
 *     (`chatReconcile` reconcilia 1× por rejoin);
 *   - StrictMode (monta → desmonta → monta) termina com 1 canal vivo.
 *
 * O store de status é o REAL (não mockado): `joinCount` é o contrato.
 */
import { StrictMode, createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (...args: unknown[]) => void;
interface FakeChannel {
  name: string;
  onEvent: Cb | null;
  onStatus: Cb | null;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

const { created, removed } = vi.hoisted(() => ({
  created: [] as FakeChannel[],
  removed: [] as FakeChannel[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn((name: string) => {
      const ch: FakeChannel = {
        name,
        onEvent: null,
        onStatus: null,
        on: vi.fn((_t: string, _cfg: unknown, cb: Cb) => {
          ch.onEvent = cb;
          return ch;
        }),
        subscribe: vi.fn((cb: Cb) => {
          ch.onStatus = cb;
          return ch;
        }),
      };
      created.push(ch);
      return ch;
    }),
    removeChannel: vi.fn((ch: FakeChannel) => {
      removed.push(ch);
    }),
  },
}));

import { supabase } from "@/integrations/supabase/client";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import { realtimeChannelRegistrySnapshot } from "@/shared/realtime/realtimeChannelRegistry";
import { getChannelStatus } from "@/lib/realtimeStatusStore";

let seq = 0;
const uniq = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const live = () => created.filter((c) => !removed.includes(c));
const last = () => created[created.length - 1];
const subscribed = (ch = last()) => act(() => ch.onStatus?.("SUBSCRIBED"));
const failed = (ch = last(), msg = "boom") => act(() => ch.onStatus?.("CHANNEL_ERROR", new Error(msg)));
const emit = (payload: unknown, ch = last()) => act(() => ch.onEvent?.(payload));

beforeEach(() => {
  created.length = 0;
  removed.length = 0;
  vi.mocked(supabase.channel).mockClear();
  vi.mocked(supabase.removeChannel).mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRealtimeChannel — dedup por (tabela, filtro, evento)", () => {
  it("2 hooks com a mesma chave → 1 supabase.channel(); o evento chega aos dois", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => {
      useRealtimeChannel({ table: "pipeline_stages", filter, onEvent: a });
      useRealtimeChannel({ table: "pipeline_stages", filter, onEvent: b });
    });

    expect(supabase.channel).toHaveBeenCalledTimes(1);
    subscribed();
    emit({ eventType: "UPDATE", new: { id: "s1" } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toBe(b.mock.calls[0][0]);
  });

  it("controle positivo: filtros distintos → canais distintos; tabelas distintas → canais distintos", () => {
    const org1 = `organization_id=eq.${uniq("org")}`;
    const org2 = `organization_id=eq.${uniq("org")}`;
    renderHook(() => {
      useRealtimeChannel({ table: "pipeline_stages", filter: org1, onEvent: vi.fn() });
      useRealtimeChannel({ table: "pipeline_stages", filter: org2, onEvent: vi.fn() });
      useRealtimeChannel({ table: "pipelines", filter: org1, onEvent: vi.fn() });
    });
    expect(supabase.channel).toHaveBeenCalledTimes(3);
    expect(live()).toHaveLength(3);
  });

  it("refcount: desmontar um não fecha; o outro segue recebendo; desmontar o último fecha", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    const a = vi.fn();
    const b = vi.fn();
    const ha = renderHook(() => useRealtimeChannel({ table: "leads", filter, onEvent: a }));
    const hb = renderHook(() => useRealtimeChannel({ table: "leads", filter, onEvent: b }));
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    subscribed();
    expect(hb.result.current.state).toBe("joined");

    ha.unmount();
    expect(supabase.removeChannel).not.toHaveBeenCalled();
    emit({ eventType: "INSERT", new: { id: "l1" } });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);

    hb.unmount();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(0);
    expect(realtimeChannelRegistrySnapshot().filter((e) => e.key.includes(filter))).toHaveLength(0);
  });

  it("hook que entra num canal já 'joined' nasce 'joined' sem abrir outro canal", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    renderHook(() => useRealtimeChannel({ table: "notifications", filter, onEvent: vi.fn() }));
    subscribed();
    const late = renderHook(() => useRealtimeChannel({ table: "notifications", filter, onEvent: vi.fn() }));
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    expect(late.result.current.state).toBe("joined");
  });

  it("joinCount sobe 1× por join real, não por consumidor (mesma statusKey)", () => {
    const org = uniq("org");
    const filter = `organization_id=eq.${org}`;
    const statusKey = `wa:${org}`;
    renderHook(() => {
      useRealtimeChannel({ table: "whatsapp_messages", filter, statusKey, onEvent: vi.fn() });
      useRealtimeChannel({ table: "whatsapp_messages", filter, statusKey, onEvent: vi.fn() });
    });
    subscribed();
    expect(getChannelStatus(statusKey).joinCount).toBe(1);

    // queda → backoff 1 s → 1 canal novo (não 2) → rejoin conta 1×
    failed();
    expect(getChannelStatus(statusKey).state).toBe("errored");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(supabase.channel).toHaveBeenCalledTimes(2);
    expect(live()).toHaveLength(1);
    subscribed();
    expect(getChannelStatus(statusKey).joinCount).toBe(2);
  });

  it("consumidor sem statusKey e com statusKey dividem o canal; cada chave conta o seu join 1×", () => {
    const org = uniq("org");
    const filter = `organization_id=eq.${org}`;
    const statusKey = `wa:${org}`;
    renderHook(() => {
      // bolha (sem statusKey) + /chat (com statusKey) — hoje 2 assinaturas
      useRealtimeChannel({ table: "whatsapp_messages", filter, onEvent: vi.fn() });
      useRealtimeChannel({ table: "whatsapp_messages", filter, statusKey, onEvent: vi.fn() });
    });
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    subscribed();
    expect(getChannelStatus(statusKey).joinCount).toBe(1);
    expect(getChannelStatus(`rt_whatsapp_messages_${filter}`).joinCount).toBe(1);
  });

  it("statusKey nova entrando em canal vivo registra o join dela; statusKey já presente não", () => {
    const org = uniq("org");
    const filter = `organization_id=eq.${org}`;
    const k1 = `k1:${org}`;
    const k2 = `k2:${org}`;
    renderHook(() => useRealtimeChannel({ table: "leads", filter, statusKey: k1, onEvent: vi.fn() }));
    subscribed();
    renderHook(() => useRealtimeChannel({ table: "leads", filter, statusKey: k1, onEvent: vi.fn() }));
    expect(getChannelStatus(k1).joinCount).toBe(1);
    renderHook(() => useRealtimeChannel({ table: "leads", filter, statusKey: k2, onEvent: vi.fn() }));
    expect(getChannelStatus(k2).state).toBe("joined");
    expect(getChannelStatus(k2).joinCount).toBe(1);
  });

  it("circuit breaker é do canal: 5 falhas → todos em polling; a sonda abre 1 canal só", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    const { result } = renderHook(() => ({
      a: useRealtimeChannel({ table: "goals", filter, onEvent: vi.fn() }),
      b: useRealtimeChannel({ table: "goals", filter, onEvent: vi.fn() }),
    }));
    for (let i = 0; i < 5; i++) {
      failed(last(), `e${i}`);
      if (i < 4) {
        act(() => {
          vi.advanceTimersByTime(30_000);
        });
      }
    }
    expect(result.current.a.state).toBe("polling");
    expect(result.current.b.state).toBe("polling");
    const before = vi.mocked(supabase.channel).mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(vi.mocked(supabase.channel).mock.calls.length - before).toBe(1);
    expect(live()).toHaveLength(1);
  });

  it("consumidor que lança não rouba o evento dos outros (erro é relançado)", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    const ok = vi.fn();
    renderHook(() => {
      useRealtimeChannel({
        table: "follow_ups",
        filter,
        onEvent: () => {
          throw new Error("consumer bug");
        },
      });
      useRealtimeChannel({ table: "follow_ups", filter, onEvent: ok });
    });
    subscribed();
    expect(() => last().onEvent?.({ eventType: "INSERT" })).toThrow("consumer bug");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("StrictMode (monta → desmonta → monta) termina com 1 canal vivo e 1 consumidor", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { unmount } = renderHook(
      () => useRealtimeChannel({ table: "checklists", filter, onEvent: vi.fn() }),
      { wrapper },
    );
    expect(live()).toHaveLength(1);
    const entry = realtimeChannelRegistrySnapshot().find((e) => e.key.includes(filter));
    expect(entry?.subscribers).toBe(1);
    unmount();
    expect(live()).toHaveLength(0);
  });

  it("callback de geração velha (após reconexão) é ignorado", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    const onEvent = vi.fn();
    const { result } = renderHook(() => useRealtimeChannel({ table: "leads", filter, onEvent }));
    const first = last();
    failed(first);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    const second = last();
    expect(second).not.toBe(first);
    subscribed(second);
    act(() => first.onStatus?.("CHANNEL_ERROR", new Error("late")));
    emit({ eventType: "INSERT" }, first);
    expect(result.current.state).toBe("joined");
    expect(onEvent).not.toHaveBeenCalled();
  });
});
