/**
 * Regressão do chamado "o chat não atualiza" (Chique Distribuidora, 05/08).
 *
 * O patch de realtime da lista escrevia o `last_message_time` novo NO MESMO
 * ÍNDICE (`prev.map((c, idx) => ...)`) e devolvia o array na ordem antiga. A
 * conversa que acabava de receber mensagem não subia — e como a lista
 * virtualiza acima de 50 conversas, numa org com 130+ a linha nem estava
 * renderizada: nada mudava na tela. Só o refetch de 20s reordenava.
 *
 * Estes testes prendem o comportamento no ponto exato do defeito: depois do
 * patch, a ordem tem que ser a mesma que a RPC devolve
 * (`ORDER BY p.last_message_time DESC`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let capturedOnEvent: ((payload: unknown) => void) | null = null;

vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { onEvent: (payload: unknown) => void }) => {
    capturedOnEvent = opts.onEvent;
  },
}));

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));

import { useWhatsAppMessagesRealtime } from "./useWhatsAppRealtime";
import { chatQueryKeys } from "./shared/queryKeys";

const ORG = "org-1";
const INST = "inst-1";

function contato(phone: string, time: string, unread = 0) {
  return {
    phone_number: phone,
    normalized_phone: phone,
    last_message: "oi",
    last_message_time: time,
    last_message_direction: "incoming" as const,
    unread_count: unread,
    is_group: false,
    lead_id: null,
    conversation_id: null,
    archived_at: null,
  };
}

function setup(seed: ReturnType<typeof contato>[], filterKey?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(chatQueryKeys.contacts(ORG, INST, filterKey), seed);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  renderHook(() => useWhatsAppMessagesRealtime(null, INST), { wrapper });
  return queryClient;
}

function lista(qc: QueryClient, filterKey?: string) {
  return (qc.getQueryData(chatQueryKeys.contacts(ORG, INST, filterKey)) ??
    []) as ReturnType<typeof contato>[];
}

function insertDe(phone: string, timestamp: string, instanceId?: string) {
  return {
    eventType: "INSERT",
    new: {
      id: `m-${phone}-${timestamp}`,
      phone_number: phone,
      timestamp,
      content: "mensagem nova",
      direction: "incoming",
      ...(instanceId === undefined ? {} : { instance_id: instanceId }),
    },
    old: null,
  };
}

beforeEach(() => {
  capturedOnEvent = null;
});

describe("useWhatsAppMessagesRealtime — ordem da lista de conversas", () => {
  it("a conversa que recebe mensagem SOBE para o topo", () => {
    const qc = setup([
      contato("5548999990001", "2026-08-06T10:00:00Z"),
      contato("5548999990002", "2026-08-05T10:00:00Z"),
      contato("5548999990003", "2026-08-04T10:00:00Z"),
    ]);

    // A última da lista recebe a mensagem mais nova de todas.
    capturedOnEvent?.(insertDe("5548999990003", "2026-08-06T15:00:00Z"));

    expect(lista(qc).map((c) => c.phone_number)).toEqual([
      "5548999990003",
      "5548999990001",
      "5548999990002",
    ]);
  });

  it("o patch continua atualizando prévia, horário e não-lidas", () => {
    const qc = setup([
      contato("5548999990001", "2026-08-06T10:00:00Z"),
      contato("5548999990003", "2026-08-04T10:00:00Z", 2),
    ]);

    capturedOnEvent?.(insertDe("5548999990003", "2026-08-06T15:00:00Z"));

    const topo = lista(qc)[0];
    expect(topo.phone_number).toBe("5548999990003");
    expect(topo.last_message).toBe("mensagem nova");
    expect(topo.last_message_time).toBe("2026-08-06T15:00:00Z");
    // Conversa não aberta (o hook subiu com phoneNumber null) → não-lida sobe.
    expect(topo.unread_count).toBe(3);
  });

  it("mensagem ANTIGA não reordena nada — evento fora de ordem não bagunça a lista", () => {
    const qc = setup([
      contato("5548999990001", "2026-08-06T10:00:00Z"),
      contato("5548999990002", "2026-08-05T10:00:00Z"),
    ]);

    capturedOnEvent?.(insertDe("5548999990002", "2026-07-01T10:00:00Z"));

    expect(lista(qc).map((c) => c.phone_number)).toEqual([
      "5548999990001",
      "5548999990002",
    ]);
    expect(lista(qc)[1].last_message_time).toBe("2026-08-05T10:00:00Z");
  });

  it("reordena TODAS as variantes filtradas da instância, não só a lista sem filtro", () => {
    // O patch usa `setQueriesData` no prefixo (issue #1277) — se a ordenação
    // ficasse de fora de alguma variante, o inbox filtrado voltaria a "não
    // atualizar".
    const qc = setup([
      contato("5548999990001", "2026-08-06T10:00:00Z"),
      contato("5548999990003", "2026-08-04T10:00:00Z"),
    ]);
    qc.setQueryData(chatQueryKeys.contacts(ORG, INST, "unread"), [
      contato("5548999990001", "2026-08-06T10:00:00Z"),
      contato("5548999990003", "2026-08-04T10:00:00Z"),
    ]);

    capturedOnEvent?.(insertDe("5548999990003", "2026-08-06T15:00:00Z"));

    expect(lista(qc, "unread").map((c) => c.phone_number)).toEqual([
      "5548999990003",
      "5548999990001",
    ]);
  });
});

// ─── A thread aberta é de UMA caixa ─────────────────────────────────────────

describe("useWhatsAppMessagesRealtime — a thread aberta pertence a uma caixa", () => {
  const OUTRA = "inst-2";
  const TELEFONE = "5548999990001";

  /** Monta o cache da THREAD (não o da lista) com a conversa aberta em `INST`. */
  function setupThread() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(chatQueryKeys.messages(ORG, TELEFONE, INST), []);
    queryClient.setQueryData(chatQueryKeys.messages(ORG, TELEFONE, OUTRA), []);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useWhatsAppMessagesRealtime(TELEFONE, INST), { wrapper });
    return queryClient;
  }

  const thread = (qc: QueryClient, inst: string) =>
    (qc.getQueryData(chatQueryKeys.messages(ORG, TELEFONE, inst)) ?? []) as unknown[];

  it("mensagem da MESMA caixa entra na thread aberta", () => {
    const qc = setupThread();

    capturedOnEvent?.(insertDe(TELEFONE, "2026-08-06T15:00:00Z", INST));

    expect(thread(qc, INST)).toHaveLength(1);
  });

  it("mensagem do MESMO telefone em OUTRA caixa NÃO entra na thread aberta", () => {
    // É o defeito que a caixa unificada cria: o mesmo número fala com dois
    // números nossos. Sem o recorte por caixa, o vendedor leria na thread do
    // Comercial uma mensagem que o cliente mandou para a Técnica.
    const qc = setupThread();

    capturedOnEvent?.(insertDe(TELEFONE, "2026-08-06T15:00:00Z", OUTRA));

    expect(thread(qc, INST)).toHaveLength(0);
    // E não vaza para o cache da outra caixa por acidente: quem escreve lá é a
    // thread daquela caixa quando ELA estiver aberta.
    expect(thread(qc, OUTRA)).toHaveLength(0);
  });

  it("mensagem SEM caixa continua entrando — parar de receber é pior que receber", () => {
    // `whatsapp_messages.instance_id` é nulável. Recusar a mensagem faria a
    // tela congelar, que é o chamado "o chat não atualiza" por outra porta.
    const qc = setupThread();

    capturedOnEvent?.(insertDe(TELEFONE, "2026-08-06T15:00:00Z"));

    expect(thread(qc, INST)).toHaveLength(1);
  });
});
