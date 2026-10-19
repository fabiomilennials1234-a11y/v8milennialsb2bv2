/**
 * Perf F3 (RAM/pool do PostgREST, 19/10): a lista multi do chat
 * (`get_whatsapp_conversation_list_multi`, ~500 ms) era refeita a CADA mensagem
 * enviada — `useSendWhatsAppMessage`/`useSendWhatsAppMedia` invalidavam a raiz
 * `["whatsapp_contacts"]` no `onSettled`, sem teto, mesmo com o realtime já
 * aplicando o INSERT outgoing na linha da conversa.
 *
 * Contrato novo (`reconciliarListaAposEnvio`):
 *   1. conversa JÁ na lista → envio não refaz a lista (o realtime patcha);
 *   2. conversa AUSENTE (primeira mensagem para um contato) → refaz só a lista
 *      que não tem a conversa, pelo teto de 15 s de `chatReconcile.ts`;
 *   3. lista de outra caixa ou de outra org → intocada (escopo inalterado);
 *   4. os hooks de envio usam esse contrato no lugar da invalidação da raiz.
 *
 * E `invalidarListaDeConversas` (mutações de composição — arquivar, excluir,
 * etiqueta): refaz já, mas pega carona em fetch em voo e não refaz lista de aba
 * oculta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockFrom, mockFunctionsInvoke } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockFunctionsInvoke: vi.fn(),
}));

function createChainMock(resolvedData: unknown[]) {
  const chain: Record<string, unknown> = {};
  [
    "select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains",
    "order", "limit", "range", "insert", "update", "delete", "upsert", "not",
    "is", "filter", "match",
  ].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: resolvedData[0] ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData[0] ?? null, error: null });
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: resolvedData, error: null, count: resolvedData.length }).then(resolve, reject);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: (...args: unknown[]) => mockFunctionsInvoke(...args) },
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/f.png" } }),
      }),
    },
  },
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "token" } }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-a", role: "admin", user_id: "u1" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-a", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-a", teamMemberId: "tm1" }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

import {
  reconciliarListaAposEnvio,
  invalidarListaDeConversas,
  CHAT_RECONCILE_MIN_INTERVAL_MS,
} from "@/modules/communication/hooks/chat/chatReconcile";
import type { Relogio } from "@/modules/communication/hooks/chat/unreadRefresh";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import {
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
} from "@/modules/communication/hooks/useWhatsAppChat";

const ORG = "org-a";
const CAIXA = "inst-1";
const OUTRA_CAIXA = "inst-2";
const FONE = "5511999999999";

function contato(phone: string, instanceId: string | null) {
  return {
    phone_number: phone,
    instance_id: instanceId,
    last_message: "oi",
    last_message_time: "2026-10-19T10:00:00Z",
    last_message_direction: "incoming",
    unread_count: 0,
  };
}

/** Relógio manual: `avancar` dispara os timers vencidos. */
function relogioManual(): Relogio & { avancar: (ms: number) => void } {
  let agora = 1_000_000;
  let timers: Array<{ em: number; fn: () => void; id: number }> = [];
  let seq = 0;
  return {
    now: () => agora,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.push({ em: agora + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => {
      timers = timers.filter((t) => t.id !== h);
    },
    avancar(ms) {
      agora += ms;
      const vencidos = timers.filter((t) => t.em <= agora);
      timers = timers.filter((t) => t.em > agora);
      vencidos.forEach((t) => t.fn());
    },
  };
}

function novoClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/** Quais chaves `whatsapp_contacts` foram invalidadas. */
function chavesInvalidadas(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls
    .map((c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey)
    .filter((k): k is unknown[] => Array.isArray(k) && k[0] === "whatsapp_contacts");
}

describe("reconciliarListaAposEnvio", () => {
  let qc: QueryClient;
  let relogio: ReturnType<typeof relogioManual>;

  beforeEach(() => {
    qc = novoClient();
    relogio = relogioManual();
  });

  it("conversa já na lista multi → não refaz a lista", () => {
    qc.setQueryData(chatQueryKeys.contactsMulti(ORG, [CAIXA, OUTRA_CAIXA]), {
      contatos: [contato(FONE, CAIXA)],
      cheia: false,
    });
    const spy = vi.spyOn(qc, "invalidateQueries");

    reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);

    expect(spy).not.toHaveBeenCalled();
  });

  it("conversa já na lista de uma caixa (array cru) → não refaz", () => {
    qc.setQueryData(chatQueryKeys.contacts(ORG, CAIXA), [contato(FONE, CAIXA)]);
    const spy = vi.spyOn(qc, "invalidateQueries");

    reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);

    expect(spy).not.toHaveBeenCalled();
  });

  it("telefone em formato diferente ainda casa (normalização)", () => {
    qc.setQueryData(chatQueryKeys.contactsMulti(ORG, [CAIXA]), {
      contatos: [contato("+55 (11) 99999-9999", CAIXA)],
      cheia: false,
    });
    const spy = vi.spyOn(qc, "invalidateQueries");

    reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);

    expect(spy).not.toHaveBeenCalled();
  });

  it("conversa ausente (primeira mensagem) → refaz SÓ a lista que não a tem", () => {
    const semConversa = chatQueryKeys.contactsMulti(ORG, [CAIXA]);
    const comConversa = chatQueryKeys.contacts(ORG, CAIXA);
    qc.setQueryData(semConversa, { contatos: [contato("5511888888888", CAIXA)], cheia: false });
    qc.setQueryData(comConversa, [contato(FONE, CAIXA)]);
    const spy = vi.spyOn(qc, "invalidateQueries");

    reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);

    expect(chavesInvalidadas(spy)).toEqual([[...semConversa]]);
  });

  it("mesmo contato em OUTRA caixa não conta: a linha é (caixa, telefone)", () => {
    const lista = chatQueryKeys.contactsMulti(ORG, [CAIXA, OUTRA_CAIXA]);
    qc.setQueryData(lista, { contatos: [contato(FONE, OUTRA_CAIXA)], cheia: false });
    const spy = vi.spyOn(qc, "invalidateQueries");

    reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);

    expect(chavesInvalidadas(spy)).toEqual([[...lista]]);
  });

  it("lista que não mostra a caixa do envio e lista de outra org → intocadas", () => {
    qc.setQueryData(chatQueryKeys.contactsMulti(ORG, [OUTRA_CAIXA]), { contatos: [], cheia: false });
    qc.setQueryData(chatQueryKeys.contacts(ORG, OUTRA_CAIXA), []);
    qc.setQueryData(chatQueryKeys.contactsMulti("org-b", [CAIXA]), { contatos: [], cheia: false });
    const spy = vi.spyOn(qc, "invalidateQueries");

    reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);

    expect(spy).not.toHaveBeenCalled();
  });

  it("rajada de envios para contato novo colapsa no teto (1 já + 1 no fim da janela)", () => {
    const lista = chatQueryKeys.contactsMulti(ORG, [CAIXA]);
    qc.setQueryData(lista, { contatos: [], cheia: false });
    const spy = vi.spyOn(qc, "invalidateQueries");

    for (let i = 0; i < 5; i++) reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);
    expect(chavesInvalidadas(spy)).toHaveLength(1);

    relogio.avancar(CHAT_RECONCILE_MIN_INTERVAL_MS);
    expect(chavesInvalidadas(spy)).toHaveLength(2);
  });

  it("lista ainda não carregada → nada a reconciliar", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    reconciliarListaAposEnvio(qc, ORG, FONE, CAIXA, relogio);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sem org → não toca em nada (nunca mira a raiz sem tenant)", () => {
    qc.setQueryData(chatQueryKeys.contactsMulti(ORG, [CAIXA]), { contatos: [], cheia: false });
    const spy = vi.spyOn(qc, "invalidateQueries");
    reconciliarListaAposEnvio(qc, null, FONE, CAIXA, relogio);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("invalidarListaDeConversas", () => {
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("mira a raiz da org, refaz ativas e pega carona em fetch em voo", async () => {
    const qc = novoClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    await invalidarListaDeConversas(qc, ORG);

    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["whatsapp_contacts", ORG], refetchType: "active" },
      { cancelRefetch: false },
    );
  });

  it("aba oculta → só marca stale, não refaz", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const qc = novoClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    await invalidarListaDeConversas(qc, ORG);

    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["whatsapp_contacts", ORG], refetchType: "none" },
      { cancelRefetch: false },
    );
  });
});

describe("hooks de envio não invalidam mais a raiz da lista", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: CAIXA, metadata: {}, instance_name: "Main" }]));
    mockFunctionsInvoke.mockResolvedValue({ data: { key: { id: "msg-new" } }, error: null });
  });

  function montar<T>(hook: () => T) {
    const qc = novoClient();
    qc.setQueryData(chatQueryKeys.contactsMulti(ORG, [CAIXA]), {
      contatos: [contato(FONE, CAIXA)],
      cheia: false,
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
    return { ...renderHook(hook, { wrapper }), spy };
  }

  it("texto: conversa na lista → nenhuma invalidação de whatsapp_contacts", async () => {
    const { result, spy } = montar(() => useSendWhatsAppMessage());
    await act(async () => {
      await result.current
        .mutateAsync({ phoneNumber: FONE, message: "Olá", instanceName: "Main", instanceId: CAIXA })
        .catch(() => undefined); // o onSettled roda no sucesso E na falha
    });
    expect(chavesInvalidadas(spy)).toEqual([]);
  });

  it("mídia: conversa na lista → nenhuma invalidação de whatsapp_contacts", async () => {
    const { result, spy } = montar(() => useSendWhatsAppMedia());
    await act(async () => {
      await result.current
        .mutateAsync({
          phoneNumber: FONE,
          media: "https://example.com/f.png",
          mediaType: "image",
          instanceName: "Main",
          instanceId: CAIXA,
        } as never)
        .catch(() => undefined);
    });
    expect(chavesInvalidadas(spy)).toEqual([]);
  });
});
