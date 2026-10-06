/**
 * QA perf S0 (realtime) — cenários de USUÁRIO sobre o canal compartilhado.
 * (Escrito pelo QA; e3 era a repro da reabertura dupla, corrigida no registry.)
 *
 * `realtime-channel-dedup.test.tsx` cobre a primitiva (refcount, joinCount,
 * StrictMode). Aqui os consumidores são os hooks REAIS de produção montados
 * juntos, como a tela monta:
 *
 *   a. /chat + bolha: mensagem chega UMA vez em thread, sidebar e bolha.
 *   b. fechar /chat com a bolha aberta: o canal fica, a bolha segue recebendo.
 *   c. funil com 2 assinantes de pipeline_entries (mesmo filtro): ambos recebem;
 *      desmontar um não para o outro.
 *   d. troca de org na mesma aba: canal velho fecha, novo abre com o filtro da
 *      org nova, evento atrasado da org velha não chega ao consumidor.
 *   e. visibilidade/online: reconexão UMA vez por canal, não por consumidor.
 *   f. circuit breaker: mesmo estado para todos, cooldown 120 s, sonda única.
 *   g. detalhe do lead: 3 canais, cada evento invalida as chaves certas.
 *   +  contagem de `supabase.channel()` numa árvore realista.
 *
 * Transporte real (registry + useRealtimeChannel + realtimeStatusStore); só o
 * socket é dublado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import type { ReactNode } from "react";

type Cb = (...args: unknown[]) => void;
interface FakeChannel {
  name: string;
  cfg: { table?: string; filter?: string; event?: string } | null;
  onEvent: Cb | null;
  onStatus: Cb | null;
  on: Cb;
  subscribe: Cb;
}

const { created, removed, teamMemberMock } = vi.hoisted(() => ({
  created: [] as FakeChannel[],
  removed: [] as FakeChannel[],
  teamMemberMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn((name: string) => {
      const ch = { name, cfg: null, onEvent: null, onStatus: null } as unknown as FakeChannel;
      ch.on = (_t: unknown, cfg: unknown, cb: unknown) => {
        ch.cfg = cfg as FakeChannel["cfg"];
        ch.onEvent = cb as Cb;
        return ch;
      };
      ch.subscribe = (cb: unknown) => {
        ch.onStatus = cb as Cb;
        return ch;
      };
      created.push(ch);
      return ch;
    }),
    removeChannel: vi.fn((ch: FakeChannel) => {
      removed.push(ch);
      return Promise.resolve("ok");
    }),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
  },
}));

vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCurrentTeamMember: () => teamMemberMock(),
}));

import { supabase } from "@/integrations/supabase/client";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { RealtimeOrgProvider } from "@/shared/realtime/realtime-org-context";
import { realtimeChannelRegistrySnapshot } from "@/shared/realtime/realtimeChannelRegistry";
import { getChannelStatus } from "@/lib/realtimeStatusStore";
import { useWhatsAppMessagesRealtime } from "@/modules/communication/hooks/chat/useWhatsAppRealtime";
import { useChatBubbleContactsRealtime } from "@/modules/communication/hooks/chat/useChatBubbleContactsRealtime";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import { useFunilRealtime } from "@/modules/pipelines/hooks/model/useFunilRealtime";
import { useLeadDetailRealtime } from "@/modules/leads/components/lead-detail/hooks/useLeadDetailRealtime";

let seq = 0;
const uniq = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const live = () => created.filter((c) => !removed.includes(c));
const liveOf = (table: string) => live().filter((c) => c.cfg?.table === table);
const lastCh = () => created[created.length - 1];
const subscribed = (ch: FakeChannel) => act(() => ch.onStatus?.("SUBSCRIBED"));
const failed = (ch: FakeChannel, msg = "boom") => act(() => ch.onStatus?.("CHANNEL_ERROR", new Error(msg)));
const emit = (ch: FakeChannel, payload: unknown) => act(() => ch.onEvent?.(payload));
const avancar = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const keyOf = (f: unknown) => JSON.stringify((f as { queryKey: unknown }).queryKey);

function novoQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}
function comQc(qc: QueryClient, org?: string | null) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <RealtimeOrgProvider organizationId={org ?? null}>{children}</RealtimeOrgProvider>
    </QueryClientProvider>
  );
}

/** Leva o canal mais recente a 5 falhas (circuito aberto). */
function abrirCircuito() {
  for (let i = 0; i < 5; i++) {
    failed(lastCh(), `e${i}`);
    if (i < 4) avancar(30_000);
  }
}

beforeEach(() => {
  created.length = 0;
  removed.length = 0;
  vi.mocked(supabase.channel).mockClear();
  vi.mocked(supabase.removeChannel).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── a / b ───────────────────────────────────────────────────────────────────

describe("a/b — /chat + bolha dividem o canal de whatsapp_messages", () => {
  const INST = "inst-1";
  const P = "5511999990001"; // thread aberta no /chat e na bolha
  const Q = "5511999990002"; // conversa fechada

  function contato(phone: string) {
    return {
      phone_number: phone,
      instance_id: INST,
      contact_name: phone,
      last_message: "antiga",
      last_message_time: "2026-10-06T10:00:00.000Z",
      last_message_direction: "incoming",
      unread_count: 0,
    };
  }
  type Contato = ReturnType<typeof contato>;
  function msg(id: string, phone: string, ts: string) {
    return {
      id,
      message_id: `wamid-${id}`,
      phone_number: phone,
      instance_id: INST,
      direction: "incoming",
      content: `oi ${id}`,
      timestamp: ts,
    };
  }

  function montar() {
    const org = uniq("org");
    teamMemberMock.mockReturnValue({ data: { organization_id: org } });
    const qc = novoQc();
    qc.setQueryData(chatQueryKeys.messages(org, P, INST), []);
    qc.setQueryData(chatQueryKeys.contacts(org, INST), [contato(P), contato(Q)]);
    qc.setQueryData(chatQueryKeys.bubbleContacts(org, INST), [contato(P), contato(Q)]);
    // Bolha (ChatBubbleProvider): thread do P aberta + patcher cross-instância.
    const bolha = renderHook(
      () => {
        useWhatsAppMessagesRealtime(P, INST);
        return useChatBubbleContactsRealtime([INST], P);
      },
      { wrapper: comQc(qc) },
    );
    // /chat (ChatShellWithContext): mesma thread aberta.
    const chat = renderHook(() => useWhatsAppMessagesRealtime(P, INST), { wrapper: comQc(qc) });
    return { org, qc, bolha, chat };
  }

  const sidebar = (qc: QueryClient, org: string) => qc.getQueryData(chatQueryKeys.contacts(org, INST)) as Contato[];
  const sidebarQ = (qc: QueryClient, org: string) => sidebar(qc, org).find((c) => c.phone_number === Q)!;
  const bolhaQ = (qc: QueryClient, org: string) =>
    (qc.getQueryData(chatQueryKeys.bubbleContacts(org, INST)) as Contato[]).find((c) => c.phone_number === Q)!;

  it("a. 3 consumidores → 1 canal; mensagem chega 1× na thread, sidebar e bolha", () => {
    const { org, qc } = montar();
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    const [ch] = liveOf("whatsapp_messages");
    expect(ch.cfg?.filter).toBe(`organization_id=eq.${org}`);
    expect(realtimeChannelRegistrySnapshot().find((e) => e.key.includes(org))?.subscribers).toBe(3);
    subscribed(ch);

    emit(ch, { eventType: "INSERT", new: msg("m1", P, "2026-10-06T12:00:01.000Z"), old: {} });
    expect(qc.getQueryData(chatQueryKeys.messages(org, P, INST))).toHaveLength(1);

    emit(ch, { eventType: "INSERT", new: msg("m2", Q, "2026-10-06T12:00:02.000Z"), old: {} });
    expect(sidebarQ(qc, org)).toMatchObject({ unread_count: 1, last_message: "oi m2" });
    expect(bolhaQ(qc, org)).toMatchObject({ unread_count: 1, last_message: "oi m2" });
    // Sidebar reordenada: Q (mais recente) sobe.
    expect(sidebar(qc, org)[0].phone_number).toBe(Q);
    // Thread do P não ganhou a mensagem do Q.
    expect(qc.getQueryData(chatQueryKeys.messages(org, P, INST))).toHaveLength(1);
  });

  it("b. fechar /chat com a bolha aberta não fecha o canal; a bolha segue recebendo", () => {
    const { org, qc, chat, bolha } = montar();
    const [ch] = liveOf("whatsapp_messages");
    subscribed(ch);

    chat.unmount();
    expect(supabase.removeChannel).not.toHaveBeenCalled();
    expect(liveOf("whatsapp_messages")).toEqual([ch]);
    expect(realtimeChannelRegistrySnapshot().find((e) => e.key.includes(org))?.subscribers).toBe(2);
    expect(bolha.result.current.isReconnecting).toBe(false);

    emit(ch, { eventType: "INSERT", new: msg("m3", Q, "2026-10-06T12:00:03.000Z"), old: {} });
    expect(bolhaQ(qc, org).unread_count).toBe(1);
    emit(ch, { eventType: "INSERT", new: msg("m4", P, "2026-10-06T12:00:04.000Z"), old: {} });
    expect(qc.getQueryData(chatQueryKeys.messages(org, P, INST))).toHaveLength(1);

    bolha.unmount();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
    expect(liveOf("whatsapp_messages")).toHaveLength(0);
  });
});

// ─── c ───────────────────────────────────────────────────────────────────────

describe("c — funil com 2 assinantes de pipeline_entries", () => {
  it("mover card atualiza os dois; desmontar um não para o outro", async () => {
    const org = uniq("org");
    const PIPE = uniq("pipe");
    const qc = novoQc();
    // A lista na tela. `useRealtimeSubscription` pede a invalidação ao
    // agendador, que só refaz query que existe e não viu o evento — sem query
    // `["pipeline_entries"]` em cache não haveria o que invalidar.
    const lista$ = new QueryObserver(qc, { queryKey: ["pipeline_entries"], queryFn: async () => [], staleTime: Infinity });
    const soltaLista$ = lista$.subscribe(() => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const avancarComFetch = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const board = renderHook(() => useFunilRealtime(PIPE), { wrapper: comQc(qc, org) });
    const lista = renderHook(() => useRealtimeSubscription("pipeline_entries", ["pipeline_entries"]), {
      wrapper: comQc(qc, org),
    });
    expect(liveOf("pipeline_entries")).toHaveLength(1);
    const [ch] = liveOf("pipeline_entries");
    expect(ch.cfg?.filter).toBe(`organization_id=eq.${org}`);
    subscribed(ch);

    const keys = () => spy.mock.calls.map(([f]) => keyOf(f));
    emit(ch, { eventType: "UPDATE", new: { id: uniq("e"), pipeline_id: PIPE, stage_key: "s2" }, old: {} });
    await avancarComFetch(2_000);
    expect(keys()).toContain(JSON.stringify(["pipeline-page", PIPE, "s2"]));
    expect(keys()).toContain(JSON.stringify(["pipeline-stage-counts", PIPE]));
    expect(keys()).toContain(JSON.stringify(["pipeline_entries"]));

    board.unmount();
    expect(liveOf("pipeline_entries")).toEqual([ch]);
    spy.mockClear();
    emit(ch, { eventType: "UPDATE", new: { id: uniq("e"), pipeline_id: PIPE, stage_key: "s3" }, old: {} });
    await avancarComFetch(2_000);
    expect(keys()).toContain(JSON.stringify(["pipeline_entries"]));
    expect(keys()).not.toContain(JSON.stringify(["pipeline-page", PIPE, "s3"]));

    lista.unmount();
    soltaLista$();
    expect(liveOf("pipeline_entries")).toHaveLength(0);
  });
});

// ─── d ───────────────────────────────────────────────────────────────────────

describe("d — troca de organização na mesma aba", () => {
  it("canal da org antiga fecha, novo abre com filtro da nova; evento atrasado da antiga não chega", () => {
    const o1 = uniq("org");
    const o2 = uniq("org");
    const qc = novoQc();
    const recebidos: unknown[] = [];
    teamMemberMock.mockReturnValue({ data: { organization_id: o1 } });

    function Consumidor({ org }: { org: string }) {
      useRealtimeSubscription("pipeline_entries", ["pipeline_entries"]);
      useRealtimeChannel({
        table: "pipeline_entries",
        filter: `organization_id=eq.${org}`,
        onEvent: (p) => recebidos.push(p),
      });
      useWhatsAppMessagesRealtime(null, null);
      return null;
    }
    function Arvore({ org }: { org: string }) {
      return (
        <QueryClientProvider client={qc}>
          <RealtimeOrgProvider organizationId={org}>
            <Consumidor org={org} />
          </RealtimeOrgProvider>
        </QueryClientProvider>
      );
    }

    const view = render(<Arvore org={o1} />);
    const [pe1] = liveOf("pipeline_entries");
    const [wa1] = liveOf("whatsapp_messages");
    expect(liveOf("pipeline_entries")).toHaveLength(1);
    expect(liveOf("whatsapp_messages")).toHaveLength(1);
    subscribed(pe1);
    subscribed(wa1);

    teamMemberMock.mockReturnValue({ data: { organization_id: o2 } });
    view.rerender(<Arvore org={o2} />);

    expect(removed).toEqual(expect.arrayContaining([pe1, wa1]));
    const pe2 = liveOf("pipeline_entries");
    const wa2 = liveOf("whatsapp_messages");
    expect(pe2).toHaveLength(1);
    expect(wa2).toHaveLength(1);
    expect(pe2[0].cfg?.filter).toBe(`organization_id=eq.${o2}`);
    expect(wa2[0].cfg?.filter).toBe(`organization_id=eq.${o2}`);
    expect(realtimeChannelRegistrySnapshot().some((e) => e.key.includes(o1))).toBe(false);

    // Evento em trânsito no socket da org antiga.
    emit(pe1, { eventType: "UPDATE", new: { id: "velho", organization_id: o1 }, old: {} });
    expect(recebidos).toHaveLength(0);
    // Status atrasado da org antiga não contamina o canal novo.
    act(() => pe1.onStatus?.("CHANNEL_ERROR", new Error("late")));
    const novo = realtimeChannelRegistrySnapshot().find(
      (e) => e.key.startsWith("pipeline_entries") && e.key.includes(o2),
    );
    expect(novo?.state).toBe("joining");

    subscribed(pe2[0]);
    emit(pe2[0], { eventType: "UPDATE", new: { id: "novo", organization_id: o2 }, old: {} });
    expect(recebidos).toHaveLength(1);
  });
});

// ─── e ───────────────────────────────────────────────────────────────────────

describe("e — visibilidade/online reconectam UMA vez por canal", () => {
  function tresConsumidores(table: string) {
    const filter = `organization_id=eq.${uniq("org")}`;
    return renderHook(() => ({
      a: useRealtimeChannel({ table, filter, onEvent: vi.fn() }),
      b: useRealtimeChannel({ table, filter, onEvent: vi.fn() }),
      c: useRealtimeChannel({ table, filter, onEvent: vi.fn(), statusKey: `sk:${filter}` }),
    }));
  }
  const disparar = () =>
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

  it("canal saudável: aba visível/online não reconecta", () => {
    tresConsumidores("goals");
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    subscribed(created[0]);
    disparar();
    avancar(5_000);
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });

  it("canal em polling (cooldown longe): 3 consumidores × (visível+online+visível) → 1 canal novo", () => {
    const h = tresConsumidores("activities");
    abrirCircuito();
    expect(h.result.current.a.state).toBe("polling");
    const antes = created.length;
    disparar();
    avancar(1_000);
    expect(created.length - antes).toBe(1);
    expect(live()).toHaveLength(1);
  });

  it("canal errored: visível+online durante o backoff de 1 s → 1 canal novo (não 2)", () => {
    // REPRO (corrigido): o timer de backoff e o de dedup venciam juntos;
    // `reopen()` não cancelava o outro timer pendente e o 2º reabria o canal
    // que acabara de entrar em "joining" — 2 joins, o 1º morto em voo.
    tresConsumidores("follow_ups");
    const antes = created.length;
    failed(created[0]);
    disparar();
    avancar(1_000);
    expect(created.length - antes).toBe(1);
    avancar(5_000); // nenhum timer remanescente reabre depois
    expect(created.length - antes).toBe(1);
  });

  it("canal errored com 1 consumidor: visível+online durante o backoff → 1 canal novo", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    renderHook(() => useRealtimeChannel({ table: "goals", filter, onEvent: vi.fn() }));
    const antes = created.length;
    failed(created[0]);
    disparar();
    avancar(1_000);
    expect(created.length - antes).toBe(1);
    avancar(5_000);
    expect(created.length - antes).toBe(1);
  });

  it("visível/online durante 'joining' → 0 canal novo (não mata o join em voo)", () => {
    const h = tresConsumidores("upsell_clients");
    expect(h.result.current.a.state).toBe("joining");
    disparar();
    avancar(5_000);
    expect(created).toHaveLength(1);
    expect(removed).toHaveLength(0);
    subscribed(created[0]);
    expect(h.result.current.c.state).toBe("joined");
  });

  it("sonda reaberta por visibilidade durante polling cancela a sonda do cooldown (1 canal por reconexão)", () => {
    tresConsumidores("activities");
    abrirCircuito();
    const antes = created.length;
    disparar();
    avancar(1_000);
    expect(created.length - antes).toBe(1);
    avancar(120_000); // cooldown antigo não pode reabrir o join da sonda
    expect(created.length - antes).toBe(1);
  });
});

// ─── f ───────────────────────────────────────────────────────────────────────

describe("f — circuit breaker é do canal", () => {
  it("5 falhas → todos (inclusive quem entra depois) em polling; cooldown 120 s; sonda única; volta joined para todos", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    const sk = `sk:${filter}`;
    const h = renderHook(() => ({
      a: useRealtimeChannel({ table: "checklists", filter, onEvent: vi.fn() }),
      b: useRealtimeChannel({ table: "checklists", filter, onEvent: vi.fn(), statusKey: sk }),
    }));
    abrirCircuito();
    expect(supabase.channel).toHaveBeenCalledTimes(5);
    expect(h.result.current.a.state).toBe("polling");
    expect(h.result.current.b.state).toBe("polling");
    expect(getChannelStatus(sk)).toMatchObject({ state: "polling", circuitOpen: true, consecutiveFailures: 5 });
    expect(getChannelStatus(`rt_checklists_${filter}`)).toMatchObject({ state: "polling", circuitOpen: true });

    const late = renderHook(() => useRealtimeChannel({ table: "checklists", filter, onEvent: vi.fn() }));
    expect(late.result.current.state).toBe("polling");

    const antes = created.length;
    avancar(119_999);
    expect(created.length - antes).toBe(0);
    avancar(1);
    expect(created.length - antes).toBe(1);
    expect(live()).toHaveLength(1);

    subscribed(lastCh());
    expect(h.result.current.a.state).toBe("joined");
    expect(h.result.current.b.state).toBe("joined");
    expect(late.result.current.state).toBe("joined");
    // Fechamento do circuito chega ao diagnóstico do hook (antes nunca saía:
    // a sonda passa por "joining" antes do SUBSCRIBED).
    expect(h.result.current.a.diagnostics.at(-1)).toMatchObject({ newState: "joined", type: "circuit_close" });
    expect(late.result.current.diagnostics.at(-1)?.type).toBe("circuit_close");
    expect(getChannelStatus(sk).diagnostics.some((d) => d.type === "circuit_close")).toBe(true);
    expect(getChannelStatus(sk)).toMatchObject({ state: "joined", circuitOpen: false, consecutiveFailures: 0 });
  });

  it("sonda que falha reabre o circuito por mais 120 s (1 canal por ciclo)", () => {
    const filter = `organization_id=eq.${uniq("org")}`;
    renderHook(() => {
      useRealtimeChannel({ table: "upsell_orders", filter, onEvent: vi.fn() });
      useRealtimeChannel({ table: "upsell_orders", filter, onEvent: vi.fn() });
    });
    abrirCircuito();
    avancar(120_000);
    const antes = created.length;
    failed(lastCh(), "sonda");
    avancar(119_999);
    expect(created.length - antes).toBe(0);
    avancar(1);
    expect(created.length - antes).toBe(1);
  });
});

// ─── g ───────────────────────────────────────────────────────────────────────

describe("g — detalhe do lead: 3 canais, invalidações certas", () => {
  it("leads / pipeline_entries / pipe_proposta_items invalidam as chaves do lead", () => {
    const org = uniq("org");
    const LEAD = uniq("lead");
    const qc = novoQc();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useLeadDetailRealtime(LEAD, true, org), { wrapper: comQc(qc, org) });
    expect(supabase.channel).not.toHaveBeenCalled();
    avancar(500);
    expect(live().map((c) => [c.cfg?.table, c.cfg?.filter])).toEqual(
      expect.arrayContaining([
        ["leads", `id=eq.${LEAD}`],
        ["pipeline_entries", `lead_id=eq.${LEAD}`],
        ["pipe_proposta_items", undefined],
      ]),
    );
    expect(live()).toHaveLength(3);
    for (const c of live()) subscribed(c);

    const chaves = () => spy.mock.calls.map(([f]) => keyOf(f)).sort();
    const ch = (t: string) => liveOf(t)[0];
    const esperado = (...ks: unknown[][]) => ks.map((k) => JSON.stringify(k)).sort();

    emit(ch("leads"), { eventType: "UPDATE", new: { id: LEAD }, old: {} });
    avancar(150);
    expect(chaves()).toEqual(esperado(["lead-detail", LEAD], ["lead-visibility", LEAD]));

    spy.mockClear();
    emit(ch("pipeline_entries"), { eventType: "UPDATE", new: { id: "pe", lead_id: LEAD }, old: {} });
    avancar(150);
    expect(chaves()).toEqual(esperado(["pipeline_entries", LEAD], ["lead-pipes", LEAD]));

    spy.mockClear();
    emit(ch("pipe_proposta_items"), { eventType: "INSERT", new: { id: "pi" }, old: {} });
    avancar(150);
    expect(chaves()).toEqual(esperado(["pipe_propostas_items", LEAD], ["lead-pipes", LEAD]));
  });
});

// ─── contagem ────────────────────────────────────────────────────────────────

describe("contagem — árvore realista (layout + bolha + /chat + funil + detalhe do lead)", () => {
  it("supabase.channel() abertos vs hooks de canal montados", () => {
    const org = uniq("org");
    const LEAD = uniq("lead");
    const PIPE = uniq("pipe");
    teamMemberMock.mockReturnValue({ data: { organization_id: org } });
    const qc = novoQc();

    renderHook(
      () => {
        // Layout: badge de suporte (useSupportUnread). useAvisos (filtro por
        // user_id, 1 canal em ambos) fica de fora: depende de auth.
        useRealtimeSubscription("notifications", ["support-unread", "user-alerts"]);
        // Bolha (ChatBubbleProvider)
        useWhatsAppMessagesRealtime(null, null);
        useChatBubbleContactsRealtime(["inst-1"], null);
        // /chat
        useWhatsAppMessagesRealtime("5511999990001", "inst-1");
        useRealtimeSubscription("channel_messages", ["social_contacts", "social_messages"]);
        // Funil (usePaginatedFunil + usePipelines + usePipelineStages)
        useRealtimeSubscription("pipeline_stages", ["funil-stages"]);
        useFunilRealtime(PIPE);
        useRealtimeSubscription("pipelines", ["pipelines"]);
        useRealtimeSubscription("pipeline_entries", ["pipeline_entries"]);
        useRealtimeSubscription("pipeline_stages", ["pipeline_stages", "custom"]);
        // Detalhe do lead (modal + score + checklist)
        useLeadDetailRealtime(LEAD, true, org);
        useRealtimeSubscription("lead_scores", ["lead_scores"]);
        useRealtimeSubscription("checklists", ["checklists"]);
        useRealtimeSubscription("checklist_items", ["checklist_items", "checklists"]);
      },
      { wrapper: comQc(qc, org) },
    );
    avancar(500); // gate do detalhe do lead

    const canais = vi.mocked(supabase.channel).mock.calls.length;
    const porTabela: Record<string, number> = {};
    for (const c of live()) porTabela[c.cfg?.table ?? "?"] = (porTabela[c.cfg?.table ?? "?"] ?? 0) + 1;
    process.stdout.write(
      `\nCONTAGEM supabase.channel()=${canais} vivos=${live().length} ${JSON.stringify(porTabela)}\n`,
    );
    expect(live().length).toBe(canais);
  });
});
