/**
 * useRealtimeFallback — decisão de fallback (pura) + `useReconcileInterval`.
 *
 * Contrato (incidente OOM 2026-10-05):
 *   - não saudável = tudo que não é "joined", INCLUSIVE "errored" (antes ficava
 *     de fora e o canal errored nunca entrava em fallback);
 *   - o intervalo vem de `reconcilePolicy.ts` — pisos 120 s / 300 s saudável;
 *   - sem tick periódico: canal saudável não re-renderiza ninguém.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  shouldFallback,
  useReconcileInterval,
  useWhatsAppRealtimeFallback,
  FALLBACK_THRESHOLD_MS,
} from "@/modules/communication/hooks/chat/useRealtimeFallback";
import {
  JITTER_MAX_FRACAO,
  PISO_FALLBACK_MS,
  PISO_SAUDAVEL_MS,
} from "@/modules/communication/hooks/chat/reconcilePolicy";
import { setChannelState, type RealtimeChannelState } from "@/lib/realtimeStatusStore";
import { whatsAppRealtimeStatusKey } from "@/shared/realtime/useRealtimeChannelStatus";

const T0 = 1_000_000;
const CLOSED = false;

const NAO_SAUDAVEIS: RealtimeChannelState[] = [
  "offline",
  "reconnecting",
  "joining",
  "unknown",
  "errored",
];

describe("shouldFallback", () => {
  it("returns false when channel is joined regardless of duration", () => {
    expect(shouldFallback("joined", CLOSED, T0, T0)).toBe(false);
    expect(shouldFallback("joined", CLOSED, T0, T0 + 10 * 60_000)).toBe(false);
  });

  it("polls immediately when the circuit breaker is open", () => {
    expect(shouldFallback("reconnecting", true, T0, T0)).toBe(true);
    expect(shouldFallback("polling", CLOSED, T0, T0)).toBe(true);
  });

  it("returns false during grace window for every non-healthy state", () => {
    const justUnder = T0 + FALLBACK_THRESHOLD_MS - 1;
    for (const st of NAO_SAUDAVEIS) {
      expect(shouldFallback(st, CLOSED, T0, justUnder)).toBe(false);
    }
  });

  it("returns true once threshold elapsed for every non-healthy state — inclusive errored", () => {
    const exactly = T0 + FALLBACK_THRESHOLD_MS;
    for (const st of NAO_SAUDAVEIS) {
      expect(shouldFallback(st, CLOSED, T0, exactly)).toBe(true);
    }
  });

  it("respects custom threshold", () => {
    expect(shouldFallback("offline", CLOSED, T0, T0 + 5_000, 10_000)).toBe(false);
    expect(shouldFallback("offline", CLOSED, T0, T0 + 10_000, 10_000)).toBe(true);
  });
});

let seq = 0;
const novaOrg = () => `org-fallback-${++seq}-${Math.random()}`;

function queryCom(dataUpdatedAt: number) {
  return { state: { dataUpdatedAt } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconcileInterval", () => {
  it("canal joined: thread ≥ 120 s, lista ≥ 300 s, teto +25%", () => {
    const org = novaOrg();
    setChannelState(whatsAppRealtimeStatusKey(org), "joined");
    const thread = renderHook(() => useReconcileInterval("thread", org));
    const lista = renderHook(() => useReconcileInterval("lista", org));
    for (let i = 0; i < 50; i++) {
      const q = queryCom(T0 + i * 1_234);
      const t = thread.result.current(q);
      const l = lista.result.current(q);
      expect(t).toBeGreaterThanOrEqual(PISO_SAUDAVEL_MS.thread);
      expect(t).toBeLessThanOrEqual(PISO_SAUDAVEL_MS.thread * (1 + JITTER_MAX_FRACAO));
      expect(l).toBeGreaterThanOrEqual(PISO_SAUDAVEL_MS.lista);
    }
  });

  it("mesmo dataUpdatedAt → mesmo valor (não reinicia o timer do TanStack)", () => {
    const org = novaOrg();
    setChannelState(whatsAppRealtimeStatusKey(org), "joined");
    const { result } = renderHook(() => useReconcileInterval("thread", org));
    expect(result.current(queryCom(T0))).toBe(result.current(queryCom(T0)));
  });

  it("canal errored: entra em fallback após 10 s sem tick, e o degrau inicial é 30 s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const org = novaOrg();
    const key = whatsAppRealtimeStatusKey(org);
    setChannelState(key, "joined");
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useReconcileInterval("thread", org);
    });
    act(() => {
      setChannelState(key, "errored", "CHANNEL_ERROR");
    });
    // carência: ainda no intervalo saudável
    expect(result.current(queryCom(T0))).toBeGreaterThanOrEqual(PISO_SAUDAVEL_MS.thread);
    act(() => {
      vi.advanceTimersByTime(FALLBACK_THRESHOLD_MS);
    });
    const v = result.current(queryCom(T0));
    expect(v).toBeGreaterThanOrEqual(PISO_FALLBACK_MS.thread);
    expect(v).toBeLessThanOrEqual(PISO_FALLBACK_MS.thread * (1 + JITTER_MAX_FRACAO));
    const rendersNoFallback = renders;
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(renders).toBe(rendersNoFallback); // nenhum timer agendado depois de entrar
  });

  it("circuito aberto (polling) entra em fallback na hora", () => {
    const org = novaOrg();
    setChannelState(whatsAppRealtimeStatusKey(org), "polling", "breaker");
    const { result } = renderHook(() => useReconcileInterval("lista", org));
    const v = result.current(queryCom(T0));
    expect(v).toBeGreaterThanOrEqual(PISO_FALLBACK_MS.lista);
    expect(v).toBeLessThan(PISO_SAUDAVEL_MS.lista);
  });

  it("canal saudável: nenhum re-render em 10 min (tick de 5 s removido)", () => {
    vi.useFakeTimers();
    const org = novaOrg();
    setChannelState(whatsAppRealtimeStatusKey(org), "joined");
    let renders = 0;
    renderHook(() => {
      renders++;
      return useReconcileInterval("thread", org);
    });
    const inicial = renders;
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(renders).toBe(inicial);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useWhatsAppRealtimeFallback (compat)", () => {
  it("errored após o limiar → shouldPoll true, modo polling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const org = novaOrg();
    const key = whatsAppRealtimeStatusKey(org);
    setChannelState(key, "joined");
    const { result } = renderHook(() => useWhatsAppRealtimeFallback(org));
    expect(result.current.mode).toBe("realtime");
    act(() => {
      setChannelState(key, "errored", "TIMED_OUT");
    });
    expect(result.current.shouldPoll).toBe(false);
    act(() => {
      vi.advanceTimersByTime(FALLBACK_THRESHOLD_MS);
    });
    expect(result.current.shouldPoll).toBe(true);
    expect(result.current.mode).toBe("polling");
    expect(result.current.reason).toBe("TIMED_OUT");
  });

  it("sem org → offline, sem poll", () => {
    const { result } = renderHook(() => useWhatsAppRealtimeFallback(null));
    expect(result.current).toEqual({ shouldPoll: false, mode: "offline", reason: null });
  });
});
