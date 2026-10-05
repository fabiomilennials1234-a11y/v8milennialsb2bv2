/**
 * QA da política de reconciliação do chat — as três lacunas que o revisor
 * deixou abertas no CP-v4:
 *
 *   A. SEGUNDO MONTADOR. A bolha já tem o canal "joined"; entrar no /chat monta
 *      um 2º `useRealtimeChannel` na MESMA chave de status. O SUBSCRIBED dele
 *      sobe o `joinCount` → conta como reconexão → reconcilia. Quanto isso
 *      custa em RPC por entrada no /chat?
 *   B. CANAL ZUMBI. "joined" e mudo (apply_rls dropando sob carga). A thread
 *      aberta precisa reconciliar sozinha em ≤ 150 s, e a volta de foco
 *      adianta — mas não refaz dentro dos 30 s de staleTime.
 *   C. TROCA DE ORG na mesma aba (mesmo QueryClient): throttle e marcador de
 *      join são por org; nada de A suprime ou dispara B.
 *
 * Transporte REAL (`useRealtimeChannel` + `realtimeStatusStore`), só o socket
 * é dublado: cada `supabase.channel()` devolve um canal cujo SUBSCRIBED o
 * teste emite. RPC com latência configurável sobre fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpcMock, teamMemberMock, canais, latencia } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  teamMemberMock: vi.fn(),
  canais: [] as Array<{ nome: string; status: ((s: string, e?: Error) => void) | null }>,
  latencia: { ms: 0 },
}));

vi.mock("@/integrations/supabase/client", () => {
  const supabase = {
    rpc(nome: string, args: unknown) {
      return rpcMock(nome, args);
    },
    from() {
      throw new Error("from() não deveria ser chamado: manifest vazio");
    },
    channel(nome: string) {
      const registro = { nome, status: null as ((s: string, e?: Error) => void) | null };
      canais.push(registro);
      const ch = {
        on: () => ch,
        subscribe: (cb: (s: string, e?: Error) => void) => {
          registro.status = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel: () => Promise.resolve("ok"),
  };
  return { supabase };
});

vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCurrentTeamMember: () => teamMemberMock(),
}));

vi.mock("@/modules/communication/lib/chipInstanceIds", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveChipInstanceIds: async (_org: string, instanceId: string) => [instanceId],
}));

vi.mock("@/modules/communication/hooks/chat/shared/enriquecerContatos", () => ({
  enriquecerContatos: async (contatos: unknown[]) => contatos,
}));

import { useWhatsAppMessages } from "@/modules/communication/hooks/chat/useWhatsAppMessages";
import { useWhatsAppMessagesRealtime } from "@/modules/communication/hooks/chat/useWhatsAppRealtime";
import { useConversasUnificadas } from "@/modules/communication/hooks/chat/useConversasUnificadas";
import type { InboxBox } from "@/modules/communication/hooks/chat/types";
import { getChannelStatus } from "@/lib/realtimeStatusStore";
import { whatsAppRealtimeStatusKey } from "@/shared/realtime/useRealtimeChannelStatus";
import { CHAT_RECONCILE_MIN_INTERVAL_MS } from "@/modules/communication/hooks/chat/chatReconcile";
import {
  JITTER_MAX_FRACAO,
  PISO_SAUDAVEL_MS,
} from "@/modules/communication/hooks/chat/reconcilePolicy";

const PHONE = "5511999990000";
const INST = "inst-1";
const CHIP: InboxBox = { kind: "whatsapp", id: INST, name: "Carol", status: "connected", provider: "uazapi" };
const LISTA_RPC = "get_whatsapp_conversation_list_multi";
const THREAD_RPC = "whatsapp_thread_manifest";
let seq = 0;

const chamadas = (nome: string) => rpcMock.mock.calls.filter(([n]) => n === nome).length;

function esperar(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Emite SUBSCRIBED no canal de índice `i` (ordem de criação). */
async function subscribed(i: number) {
  await act(async () => {
    canais[i]?.status?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
  });
}

function novoQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** Bolha: o provider global monta o realtime sem thread aberta. */
function montarBolha(qc: QueryClient) {
  return renderHook(() => useWhatsAppMessagesRealtime(null, null), { wrapper: wrapper(qc) });
}

/** /chat: 2º realtime + lista unificada + thread aberta. */
function montarChat(qc: QueryClient) {
  return renderHook(
    () => {
      useWhatsAppMessagesRealtime(PHONE, INST);
      useConversasUnificadas([CHIP]);
      return useWhatsAppMessages(PHONE, INST);
    },
    { wrapper: wrapper(qc) },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  canais.length = 0;
  latencia.ms = 0;
  rpcMock.mockReset();
  rpcMock.mockImplementation(async (nome: string) => {
    if (latencia.ms > 0) await esperar(latencia.ms);
    if (nome === THREAD_RPC) {
      return { data: { fingerprint: "fp", unchanged: false, manifest: [] }, error: null };
    }
    return { data: [], error: null };
  });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

// ─── A. Segundo montador ────────────────────────────────────────────────────

describe("A. 2º montador na mesma chave de status (bolha joined → entra no /chat)", () => {
  function preparar() {
    const org = `org-qa-a-${++seq}`;
    teamMemberMock.mockReturnValue({ data: { organization_id: org } });
    return { org, key: whatsAppRealtimeStatusKey(org) };
  }

  it("RPC rápida (200 ms, resolve antes do join do 2º canal): +1 lista e +1 thread por entrada", async () => {
    const { key } = preparar();
    latencia.ms = 200;
    const qc = novoQc();

    montarBolha(qc);
    await subscribed(0);
    expect(getChannelStatus(key).joinCount).toBe(1);
    await avancar(60_000); // bolha estável, janela do throttle bem fechada

    montarChat(qc);
    await avancar(800); // fetch inicial da lista e da thread resolve (200 ms)
    const listaBase = chamadas(LISTA_RPC);
    const threadBase = chamadas(THREAD_RPC);
    expect(listaBase).toBe(1);
    expect(threadBase).toBe(1);

    await subscribed(1); // 2º canal entra → joinCount 2 → "reconexão"
    expect(getChannelStatus(key).joinCount).toBe(2);
    await avancar(CHAT_RECONCILE_MIN_INTERVAL_MS);

    // NÚMERO MEDIDO: 1 RPC de lista + 1 manifest extra por entrada.
    expect(chamadas(LISTA_RPC) - listaBase).toBe(1);
    expect(chamadas(THREAD_RPC) - threadBase).toBe(1);
  });

  it("RPC lenta (12 s, pico): reconciliação pega carona no fetch em voo → 0 extra", async () => {
    const { key } = preparar();
    latencia.ms = 12_000;
    const qc = novoQc();

    montarBolha(qc);
    await subscribed(0);
    await avancar(60_000);

    montarChat(qc);
    await avancar(800); // fetch inicial ainda em voo
    await subscribed(1);
    expect(getChannelStatus(key).joinCount).toBe(2);
    await avancar(CHAT_RECONCILE_MIN_INTERVAL_MS + 12_000);

    // cancelRefetch:false — invalidar durante o fetch não abre outro.
    expect(chamadas(LISTA_RPC)).toBe(1);
    expect(chamadas(THREAD_RPC)).toBe(1);
  });

  it("entra/sai/entra em 5 s: 2ª entrada colapsa na borda de saída do throttle (≤ 1 extra por 15 s)", async () => {
    preparar();
    latencia.ms = 200;
    const qc = novoQc();

    montarBolha(qc);
    await subscribed(0);
    await avancar(60_000);

    const chat1 = montarChat(qc);
    await avancar(800);
    await subscribed(1);
    await avancar(1_000);
    const listaAposEntrada1 = chamadas(LISTA_RPC);
    expect(listaAposEntrada1).toBe(2); // inicial + reconciliação

    chat1.unmount();
    await avancar(3_000);
    montarChat(qc); // cache fresco (staleTime 30 s): sem fetch de montagem
    await avancar(800);
    expect(chamadas(LISTA_RPC)).toBe(listaAposEntrada1);
    await subscribed(2); // 3º SUBSCRIBED, dentro da janela de 15 s
    await avancar(500);
    expect(chamadas(LISTA_RPC)).toBe(listaAposEntrada1); // segurado pelo teto

    await avancar(CHAT_RECONCILE_MIN_INTERVAL_MS);
    // Borda de saída: exatamente 1 a mais na janela.
    expect(chamadas(LISTA_RPC) - listaAposEntrada1).toBe(1);
  });

  it("join lento do 2º canal derruba o status compartilhado: bolha vê 'joining' até o SUBSCRIBED", async () => {
    // Documenta o follow-up do revisor (não é regressão desta trilha): o 2º
    // montador grava "joining" por cima do "joined" da bolha. Se o SUBSCRIBED
    // dele passar de 10 s, a ABA INTEIRA entra em fallback com o socket da
    // bolha saudável.
    const { key } = preparar();
    const qc = novoQc();
    montarBolha(qc);
    await subscribed(0);
    expect(getChannelStatus(key).state).toBe("joined");

    montarChat(qc);
    await avancar(0);
    expect(getChannelStatus(key).state).toBe("joining");
  });
});

// ─── B. Canal zumbi ─────────────────────────────────────────────────────────

describe("B. canal zumbi (joined, nenhum evento) com a thread aberta", () => {
  function preparar() {
    const org = `org-qa-b-${++seq}`;
    teamMemberMock.mockReturnValue({ data: { organization_id: org } });
    const qc = novoQc();
    const r = renderHook(
      () => {
        useWhatsAppMessagesRealtime(PHONE, INST);
        return useWhatsAppMessages(PHONE, INST);
      },
      { wrapper: wrapper(qc) },
    );
    return { qc, r };
  }

  it("reconcilia sozinha em (120 s, 150 s] — nunca antes do piso, nunca depois do teto com jitter", async () => {
    preparar();
    await subscribed(0);
    await avancar(0);
    expect(chamadas(THREAD_RPC)).toBe(1);

    await avancar(PISO_SAUDAVEL_MS.thread - 1_000);
    expect(chamadas(THREAD_RPC)).toBe(1); // piso de 120 s vale literalmente

    await avancar(PISO_SAUDAVEL_MS.thread * JITTER_MAX_FRACAO + 1_000); // até 150 s
    expect(chamadas(THREAD_RPC)).toBe(2);
  });

  it("segue reconciliando: 10 min de zumbi → entre 4 e 5 manifests extras", async () => {
    preparar();
    await subscribed(0);
    await avancar(0);
    await avancar(600_000);
    const extras = chamadas(THREAD_RPC) - 1;
    // 600/150 = 4 no pior jitter; 600/120 = 5 no melhor.
    expect(extras).toBeGreaterThanOrEqual(4);
    expect(extras).toBeLessThanOrEqual(5);
  });

  it("foco adianta depois de 30 s; dentro dos 30 s de staleTime não refaz", async () => {
    preparar();
    await subscribed(0);
    await avancar(0);
    expect(chamadas(THREAD_RPC)).toBe(1);

    // Troca de aba aos 10 s: ainda fresco.
    await avancar(10_000);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(chamadas(THREAD_RPC)).toBe(1);

    // Volta aos 40 s: passou do staleTime → reconcilia na hora, sem esperar 120 s.
    await avancar(30_000);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(chamadas(THREAD_RPC)).toBe(2);
  });

  it("aba sem foco não consome o backstop (refetchIntervalInBackground=false)", async () => {
    preparar();
    await subscribed(0);
    await avancar(0);
    act(() => focusManager.setFocused(false));
    await avancar(600_000);
    expect(chamadas(THREAD_RPC)).toBe(1);
  });
});

// ─── C. Troca de org na mesma aba ───────────────────────────────────────────

describe("C. troca de org na mesma aba (mesmo QueryClient)", () => {
  it("throttle e marcador de join não vazam: reconciliação de A não segura nem dispara B", async () => {
    const orgA = `org-qa-cA-${++seq}`;
    const orgB = `org-qa-cB-${seq}`;
    let org = orgA;
    teamMemberMock.mockImplementation(() => ({ data: { organization_id: org } }));
    const qc = novoQc();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const raizes = () =>
      spy.mock.calls.map(([f]) => (f?.queryKey as unknown[] | undefined)?.slice(0, 2).join("|"));

    const r = renderHook(
      () => {
        useWhatsAppMessagesRealtime(PHONE, INST);
        return useWhatsAppMessages(PHONE, INST);
      },
      { wrapper: wrapper(qc) },
    );

    // A: 1º join + rejoin → reconcilia A, abre a janela de 15 s de A.
    await subscribed(0);
    await subscribed(0);
    expect(getChannelStatus(whatsAppRealtimeStatusKey(orgA)).joinCount).toBe(2);
    expect(raizes()).toEqual([`whatsapp_messages|${orgA}`, `whatsapp_contacts|${orgA}`]);
    spy.mockClear();

    // Troca para B 2 s depois (dentro da janela de A).
    await avancar(2_000);
    org = orgB;
    r.rerender();
    await avancar(0);
    const canalB = canais.length - 1;
    expect(canais[canalB]?.nome).toContain(orgB);

    // 1º join de B: cache de B acabou de nascer — nada.
    await subscribed(canalB);
    expect(getChannelStatus(whatsAppRealtimeStatusKey(orgB)).joinCount).toBe(1);
    expect(spy).not.toHaveBeenCalled();

    // Rejoin de B ainda dentro da janela de A: dispara NA HORA e só em B.
    await subscribed(canalB);
    expect(raizes()).toEqual([`whatsapp_messages|${orgB}`, `whatsapp_contacts|${orgB}`]);

    // Nenhuma borda de saída de A cai depois da troca.
    spy.mockClear();
    await avancar(CHAT_RECONCILE_MIN_INTERVAL_MS * 2);
    expect(raizes().some((k) => k?.includes(orgA))).toBe(false);
  });

  it("status de A em fallback não contamina o intervalo de B", async () => {
    const orgA = `org-qa-cA-${++seq}`;
    const orgB = `org-qa-cB-${seq}`;
    let org = orgA;
    teamMemberMock.mockImplementation(() => ({ data: { organization_id: org } }));
    const qc = novoQc();
    const r = renderHook(
      () => {
        useWhatsAppMessagesRealtime(PHONE, INST);
        return useWhatsAppMessages(PHONE, INST);
      },
      { wrapper: wrapper(qc) },
    );

    // A nunca chega a joined: erro → backoff, status não saudável.
    await act(async () => {
      canais[0]?.status?.("CHANNEL_ERROR", new Error("x"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getChannelStatus(whatsAppRealtimeStatusKey(orgA)).state).not.toBe("joined");

    org = orgB;
    r.rerender();
    await avancar(0);
    const canalB = canais.findIndex((c) => c.nome.includes(orgB));
    await subscribed(canalB);
    const base = chamadas(THREAD_RPC);

    // B saudável: nada em 100 s (fallback de A faria 30 s).
    await avancar(100_000);
    expect(chamadas(THREAD_RPC)).toBe(base);
  });
});
