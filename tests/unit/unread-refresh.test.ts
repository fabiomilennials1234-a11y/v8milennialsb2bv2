/**
 * Contagens de não-lidas: por EVENTO, com teto de vazão (incidente 2026-10-02).
 *
 * O badge global e o ponto por caixa pollavam a cada 60 s em toda aba, e cada
 * chamada custava até 14 s no banco. O contrato que substitui aquilo:
 *   - rajada de mensagens → no máximo 1 releitura a cada 20 s por aba;
 *   - a última mensagem da rajada nunca fica sem releitura (borda de fuga);
 *   - aba escondida não consulta — só marca como velho;
 *   - nenhuma das duas queries volta a ter `refetchInterval` ≤ 60 s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  criarThrottle,
  pedirAtualizacaoDeNaoLidas,
  NAO_LIDAS_POR_CAIXA_QUERY_ROOT,
  UNREAD_FALLBACK_POLL_MS,
  UNREAD_REFRESH_MIN_INTERVAL_MS,
  UNREAD_STALE_TIME_MS,
  UNREAD_TOTAL_QUERY_ROOT,
  type Relogio,
} from "@/modules/communication/hooks/chat/unreadRefresh";

/** Relógio manual: tempo e timers sob controle do teste, sem fake timers globais. */
function relogioManual() {
  let agora = 1_000_000;
  let fila: { quando: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const relogio: Relogio = {
    now: () => agora,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      fila.push({ quando: agora + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => {
      fila = fila.filter((t) => t.id !== h);
    },
  };
  const avancar = (ms: number) => {
    agora += ms;
    const vencidos = fila.filter((t) => t.quando <= agora);
    fila = fila.filter((t) => t.quando > agora);
    vencidos.forEach((t) => t.fn());
  };
  return { relogio, avancar, timersVivos: () => fila.length };
}

describe("criarThrottle — borda dupla", () => {
  it("primeiro pedido depois de calma dispara JÁ", () => {
    const { relogio } = relogioManual();
    const fn = vi.fn();
    criarThrottle(fn, 20_000, relogio).request();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rajada de 200 mensagens em 10 s vira 2 execuções: ataque + uma fuga", () => {
    const { relogio, avancar, timersVivos } = relogioManual();
    const fn = vi.fn();
    const t = criarThrottle(fn, 20_000, relogio);
    for (let i = 0; i < 200; i++) {
      t.request();
      avancar(50);
    }
    expect(fn).toHaveBeenCalledTimes(1);
    expect(timersVivos()).toBe(1); // nunca mais de um timer vivo
    avancar(20_000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(timersVivos()).toBe(0);
  });

  it("execuções nunca ficam a menos do intervalo uma da outra, sob carga contínua", () => {
    const { relogio, avancar } = relogioManual();
    const instantes: number[] = [];
    const t = criarThrottle(() => instantes.push(relogio.now()), 20_000, relogio);
    for (let i = 0; i < 600; i++) {
      t.request();
      avancar(500); // 1 mensagem a cada 0,5 s por 5 min
    }
    avancar(20_000);
    for (let i = 1; i < instantes.length; i++) {
      expect(instantes[i] - instantes[i - 1]).toBeGreaterThanOrEqual(20_000);
    }
    // 5 min / 20 s ≈ 15 releituras — contra 600 se fosse por mensagem.
    expect(instantes.length).toBeLessThanOrEqual(17);
  });

  it("pedido no meio da janela é atendido por uma execução POSTERIOR a ele", () => {
    const { relogio, avancar } = relogioManual();
    const fn = vi.fn();
    const t = criarThrottle(fn, 20_000, relogio);
    t.request(); // dispara
    avancar(5_000);
    t.request(); // agenda fuga
    expect(fn).toHaveBeenCalledTimes(1);
    avancar(14_999);
    expect(fn).toHaveBeenCalledTimes(1);
    avancar(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel descarta a fuga agendada", () => {
    const { relogio, avancar } = relogioManual();
    const fn = vi.fn();
    const t = criarThrottle(fn, 20_000, relogio);
    t.request();
    t.request();
    t.cancel();
    avancar(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("pedirAtualizacaoDeNaoLidas", () => {
  let visibilidade: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilidade = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilidade);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const raizesInvalidadas = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => {
      const filtro = c[0] as { queryKey: unknown[]; refetchType: string };
      return [filtro.queryKey[0], filtro.refetchType];
    });

  it("invalida as DUAS contagens, uma vez por rajada, com teto por QueryClient", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    for (let i = 0; i < 50; i++) pedirAtualizacaoDeNaoLidas(qc);
    expect(raizesInvalidadas(spy)).toEqual([
      [UNREAD_TOTAL_QUERY_ROOT, "active"],
      [NAO_LIDAS_POR_CAIXA_QUERY_ROOT, "active"],
    ]);
    vi.advanceTimersByTime(UNREAD_REFRESH_MIN_INTERVAL_MS);
    expect(spy).toHaveBeenCalledTimes(4); // a fuga da rajada, e só ela
  });

  it("aba escondida: só marca como velho, não consulta", () => {
    visibilidade = "hidden";
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    pedirAtualizacaoDeNaoLidas(qc);
    expect(raizesInvalidadas(spy)).toEqual([
      [UNREAD_TOTAL_QUERY_ROOT, "none"],
      [NAO_LIDAS_POR_CAIXA_QUERY_ROOT, "none"],
    ]);
  });

  it("cada aba (QueryClient) tem a sua janela", () => {
    const a = new QueryClient();
    const b = new QueryClient();
    const spyA = vi.spyOn(a, "invalidateQueries");
    const spyB = vi.spyOn(b, "invalidateQueries");
    pedirAtualizacaoDeNaoLidas(a);
    pedirAtualizacaoDeNaoLidas(b);
    expect(spyA).toHaveBeenCalledTimes(2);
    expect(spyB).toHaveBeenCalledTimes(2);
  });
});

describe("constantes do contrato", () => {
  it("teto de 1 releitura entre 15 e 30 s por aba", () => {
    expect(UNREAD_REFRESH_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
    expect(UNREAD_REFRESH_MIN_INTERVAL_MS).toBeLessThanOrEqual(30_000);
  });

  it("fallback nunca abaixo de 5 min — o polling de 60 s não volta", () => {
    expect(UNREAD_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("staleTime limita o refetch de foco a 1 por janela", () => {
    expect(UNREAD_STALE_TIME_MS).toBeGreaterThanOrEqual(UNREAD_REFRESH_MIN_INTERVAL_MS);
  });
});
