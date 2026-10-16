import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aviso } from "../lib/aviso-stream";
import { useAvisos } from "./useAvisos";

const mocks = vi.hoisted(() => ({
  rows: [] as Aviso[], org: "org-a", user: "user-a", tocar: vi.fn(), cartao: vi.fn(),
  realtime: vi.fn(), estado: "polling" as string, consultas: 0, atraso: 0,
}));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: mocks.user } }),
  useOrganization: () => ({ organizationId: mocks.org, isReady: true }),
}));
vi.mock("./usePreferenciasDeAviso", async () => {
  const { resolverPreferencias } = await import("../lib/preferencias-de-aviso");
  return { usePreferenciasDeAviso: () => ({ preferencias: resolverPreferencias(null) }) };
});
vi.mock("./usePresenca", () => ({ usePresenca: vi.fn() }));
vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (options: unknown) => { mocks.realtime(options); return { state: mocks.estado }; },
}));
vi.mock("../lib/motor-de-som", () => ({ motorDeSom: {
  tocar: mocks.tocar, destravarNoPrimeiroGesto: () => () => {},
} }));
vi.mock("../lib/cartoes-store", () => ({ mostrarCartao: mocks.cartao, reiniciarCartoes: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  mocks.consultas++;
  const filters: Record<string, string> = {};
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { filters[key] = value; return query; },
    order: () => query, limit: () => query,
    // A fotografia é tirada na chamada; com `atraso`, a resposta chega depois
    // (é assim que a corrida "join com a 1ª consulta em voo" aparece).
    then: (resolve: (result: { data: Aviso[]; error: null }) => unknown) => {
      const data = mocks.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key as keyof Aviso] === value));
      if (!mocks.atraso) return Promise.resolve(resolve({ data, error: null }));
      return new Promise((r) => setTimeout(r, mocks.atraso)).then(() => resolve({ data, error: null }));
    },
  };
  return query;
} } }));

const aviso = (id: string, changes: Partial<Aviso> = {}): Aviso => ({
  id, organization_id: "org-a", user_id: "user-a", type: "lead_message", title: "Novo aviso",
  description: null, link: "/agenda", lead_id: null, entity_id: null, group_key: id,
  event_count: 1, last_event_at: new Date().toISOString(), created_at: new Date().toISOString(),
  read_at: null, ...changes,
});
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = []; mocks.org = "org-a"; mocks.user = "user-a";
  mocks.estado = "polling"; mocks.consultas = 0; mocks.atraso = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const atualizar = () => act(async () => { await client.invalidateQueries({ queryKey: ["avisos"] }); });

describe("entrega de avisos", () => {
  it("recupera som e mensagem por consulta quando o realtime cai, sem repetir histórico ou leitura", async () => {
    mocks.rows = [aviso("antigo")];
    const { result } = renderHook(() => useAvisos({ entregar: true }), { wrapper });
    await waitFor(() => expect(result.current.avisos).toHaveLength(1));
    expect(mocks.tocar).not.toHaveBeenCalled();
    mocks.rows = [aviso("novo"), ...mocks.rows];
    await atualizar();
    await waitFor(() => expect(mocks.tocar).toHaveBeenCalledTimes(1));
    expect(mocks.cartao).toHaveBeenCalledTimes(1);
    await atualizar();
    mocks.rows = mocks.rows.map(row => ({ ...row, read_at: new Date().toISOString() }));
    await atualizar();
    expect(mocks.tocar).toHaveBeenCalledTimes(1);
  });

  it("tempo real e consulta entregam o mesmo aviso uma só vez", async () => {
    const { result } = renderHook(() => useAvisos({ entregar: true }), { wrapper });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    const novo = aviso("novo");
    act(() => mocks.realtime.mock.lastCall![0].onEvent({ eventType: "INSERT", new: novo }));
    await waitFor(() => expect(mocks.tocar).toHaveBeenCalledTimes(1));
    mocks.rows = [novo]; await atualizar();
    expect(mocks.tocar).toHaveBeenCalledTimes(1);
  });

  it("ignora eventos de outra organização ou destinatário e não anuncia histórico ao trocar de org", async () => {
    const { result, rerender } = renderHook(() => useAvisos({ entregar: true }), { wrapper });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    act(() => {
      const onEvent = mocks.realtime.mock.lastCall![0].onEvent;
      onEvent({ eventType: "INSERT", new: aviso("outra-org", { organization_id: "org-b" }) });
      onEvent({ eventType: "INSERT", new: aviso("outro-user", { user_id: "user-b" }) });
    });
    expect(mocks.tocar).not.toHaveBeenCalled();
    mocks.rows = [aviso("historico-b", { organization_id: "org-b" })]; mocks.org = "org-b";
    rerender(); await waitFor(() => expect(result.current.avisos[0]?.id).toBe("historico-b"));
    expect(mocks.tocar).not.toHaveBeenCalled();
  });

  it("os sinos de desktop e celular só leem; apenas o receptor global entrega", async () => {
    const { result } = renderHook(() => useAvisos(), { wrapper });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(mocks.realtime.mock.lastCall![0].enabled).toBe(false);
  });
});

/**
 * Perf onda 1 (F1) — a consulta periódica é rede de segurança, não mecanismo.
 * Canal `joined` → sonda de 5 min; canal fora → 30 s; aba escondida → nada;
 * voltar à aba → relê; canal chegando a `joined` (entrada ou religar) → relê. Relógio falso: o que se mede é quantas vezes o banco
 * foi consultado, não a opção passada ao TanStack.
 */
describe("rede de segurança do sino", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); focusManager.setFocused(undefined); });
  const passar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const montar = async (entregar = true) => {
    const hook = renderHook(() => useAvisos({ entregar }), { wrapper });
    await passar(0);
    expect(mocks.consultas).toBe(1);
    return hook;
  };

  it("canal saudável: só a sonda de 5 min", async () => {
    mocks.estado = "joined";
    await montar();
    await passar(5 * 60_000 - 1_000);
    expect(mocks.consultas).toBe(1);
    await passar(1_000);
    expect(mocks.consultas).toBe(2);
  });

  it("canal degradado: consulta a cada 30 s; volta a parar quando o canal sobe", async () => {
    mocks.estado = "errored";
    const { rerender } = await montar();
    await passar(30_000);
    expect(mocks.consultas).toBe(2);
    await passar(30_000);
    expect(mocks.consultas).toBe(3);
    mocks.estado = "joined"; rerender();
    await passar(4 * 60_000);
    expect(mocks.consultas).toBe(3);
  });

  it("aba escondida nunca consulta, nem com o canal fora", async () => {
    mocks.estado = "polling";
    await montar();
    act(() => focusManager.setFocused(false));
    await passar(2 * 60_000);
    expect(mocks.consultas).toBe(1);
  });

  it("voltar à aba relê na hora, mesmo dentro do staleTime e com o canal saudável", async () => {
    mocks.estado = "joined";
    await montar();
    act(() => focusManager.setFocused(false));
    await passar(10_000);
    act(() => focusManager.setFocused(true));
    await passar(0);
    expect(mocks.consultas).toBe(2);
  });

  it("controle: o sino que só lê não relê ao voltar à aba", async () => {
    await montar(false);
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await passar(60_000);
    expect(mocks.consultas).toBe(1);
  });

  it("canal que cai e volta relê uma vez ao religar", async () => {
    mocks.estado = "joined";
    await montar();
    const { onStateChange } = mocks.realtime.mock.lastCall![0];
    act(() => onStateChange({ state: "joined", failureCount: 0, initial: true }));
    await passar(0);
    expect(mocks.consultas).toBe(1);
    act(() => onStateChange({ state: "errored", failureCount: 1, initial: false }));
    act(() => onStateChange({ state: "joined", failureCount: 0, initial: false }));
    await passar(0);
    expect(mocks.consultas).toBe(2);
    // Um `joined` sem queda antes não relê.
    act(() => onStateChange({ state: "joined", failureCount: 0, initial: false }));
    await passar(0);
    expect(mocks.consultas).toBe(2);
  });

  it("join inicial relê: aviso gravado entre a fotografia e o 1º joined não se perde", async () => {
    mocks.estado = "joining";
    mocks.rows = [aviso("historico")];
    await montar();
    const { onStateChange } = mocks.realtime.mock.lastCall![0];
    act(() => onStateChange({ state: "joining", failureCount: 0, initial: true }));
    // Gravado depois da consulta da montagem e antes do canal subir.
    mocks.rows = [aviso("na-janela"), ...mocks.rows];
    mocks.estado = "joined";
    act(() => onStateChange({ state: "joined", failureCount: 0, initial: false }));
    await passar(0);
    expect(mocks.consultas).toBe(2);
    expect(mocks.tocar).toHaveBeenCalledTimes(1);
    expect(mocks.cartao.mock.lastCall![0].id).toBe("na-janela");
  });

  it("controle: entrar num canal já joined (aberto por outra instância) não relê", async () => {
    mocks.estado = "joined";
    await montar();
    const { onStateChange } = mocks.realtime.mock.lastCall![0];
    act(() => onStateChange({ state: "joined", failureCount: 0, initial: true }));
    await passar(0);
    expect(mocks.consultas).toBe(1);
  });
});

/**
 * Corrida do join inicial (QA, volta 2): o `joined` chega com a 1ª consulta
 * ainda em voo. A fotografia dela é anterior ao aviso gravado na janela; a
 * releitura tem que vir DEPOIS dela, não ser engolida por ela. Defaults de
 * produção do QueryClient (`App.tsx`).
 */
describe("join inicial com a 1ª consulta em voo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    client = new QueryClient({ defaultOptions: { queries: {
      retry: 1, staleTime: 300_000, gcTime: 1_800_000, refetchOnWindowFocus: false, refetchOnReconnect: true,
    } } });
  });
  afterEach(() => { vi.useRealTimers(); });
  // Um `act` só adiaria os efeitos do React para o fim do intervalo inteiro —
  // em passos de 50 ms cada resposta é renderizada quando chega, como no browser.
  const passar = async (ms: number) => {
    for (let feito = 0; feito < ms; feito += 50) {
      await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(50, ms - feito)); });
    }
    if (ms === 0) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  };

  for (const [atraso, joinEm] of [[50, 200], [500, 200], [1000, 300]] as const) {
    it(`1ª consulta de ${atraso} ms, joined em ${joinEm} ms, aviso gravado em 100 ms → som em até 2 s`, async () => {
      mocks.estado = "joining"; mocks.atraso = atraso; mocks.rows = [aviso("historico")];
      renderHook(() => useAvisos({ entregar: true }), { wrapper });
      await passar(0);
      const { onStateChange } = mocks.realtime.mock.lastCall![0];
      act(() => onStateChange({ state: "joining", failureCount: 0, initial: true }));
      await passar(100);
      mocks.rows = [aviso("na-janela"), ...mocks.rows];
      await passar(joinEm - 100);
      mocks.estado = "joined";
      act(() => onStateChange({ state: "joined", failureCount: 0, initial: false }));
      await passar(2_000);
      expect(mocks.consultas).toBe(2);
      expect(mocks.tocar).toHaveBeenCalledTimes(1);
      expect(mocks.cartao.mock.calls.map(([a]) => a.id)).toEqual(["na-janela"]);
      // Nada de releitura em laço nem som repetido depois.
      await passar(60_000);
      expect(mocks.consultas).toBe(2);
      expect(mocks.tocar).toHaveBeenCalledTimes(1);
    });
  }

  it("join depois da 1ª resposta: relê uma vez e o histórico não toca", async () => {
    mocks.estado = "joining"; mocks.atraso = 50; mocks.rows = [aviso("historico")];
    renderHook(() => useAvisos({ entregar: true }), { wrapper });
    const { onStateChange } = mocks.realtime.mock.lastCall![0];
    act(() => onStateChange({ state: "joining", failureCount: 0, initial: true }));
    await passar(300);
    mocks.estado = "joined";
    act(() => onStateChange({ state: "joined", failureCount: 0, initial: false }));
    await passar(2_000);
    expect(mocks.consultas).toBe(2);
    expect(mocks.tocar).not.toHaveBeenCalled();
  });
});
