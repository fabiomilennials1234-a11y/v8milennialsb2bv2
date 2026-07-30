import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";
import type { SessionEvent } from "@/modules/communication/lib/torquecallsEvents";

const createVoiceSession = vi.fn();
const pairVoiceSession = vi.fn();
const requestStreamToken = vi.fn();

/**
 * Cada chamada a `subscribeSessionEvents` (uma por stream aberto) devolve uma
 * promise CONTROLÁVEL, não uma que nunca resolve nem rejeita. Um mock que
 * nunca resolve nem rejeita esconde exatamente o bug que esta rodada de teste
 * existe pra provar: `retry` reabrindo o stream depois que o anterior caiu ou
 * terminou sozinho. `streams` guarda um handle por chamada, na ordem em que
 * aconteceram — os testes usam `streams.at(-1)` pra mirar no mais recente.
 */
interface StreamHandle {
  onEvent: (e: SessionEvent) => void;
  resolve: () => void;
  reject: (err: unknown) => void;
}
let streams: StreamHandle[] = [];

const subscribeSessionEvents = vi.fn((args: { onEvent: (e: SessionEvent) => void }) => {
  return new Promise<void>((resolve, reject) => {
    streams.push({ onEvent: args.onEvent, resolve, reject });
  });
});

function emit(event: SessionEvent) {
  streams.at(-1)?.onEvent(event);
}

vi.mock("@/modules/communication/lib/torquecallsApi", () => ({
  createVoiceSession: (...a: unknown[]) => createVoiceSession(...a),
  pairVoiceSession: (...a: unknown[]) => pairVoiceSession(...a),
  requestStreamToken: (...a: unknown[]) => requestStreamToken(...a),
  VoiceControlError: class extends Error { constructor(public code: string, m?: string) { super(m); } },
  VOICE_CONTROL_MESSAGES: { session_cap_reached: "Limite atingido." },
}));

vi.mock("@/modules/communication/lib/torquecallsEvents", () => ({
  subscribeSessionEvents: (args: { onEvent: (e: SessionEvent) => void }) => subscribeSessionEvents(args),
}));

import { useVoicePairing } from "./useVoicePairing";

// O hook chama `useQueryClient()` para invalidar `voip_sessions` e
// `whatsapp_instances` no pareamento — sem Provider, `renderHook` derruba
// com "No QueryClient set" antes de qualquer asserção rodar.
const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

beforeEach(() => {
  createVoiceSession.mockReset().mockResolvedValue({ tcSessionId: "tc-1" });
  pairVoiceSession.mockReset().mockResolvedValue(undefined);
  requestStreamToken.mockReset().mockResolvedValue({
    token: "tk", expiresAt: 0, renewInMs: 50_000, vpsUrl: "https://calls.example",
  });
  subscribeSessionEvents.mockClear();
  streams = [];
});

describe("useVoicePairing", () => {
  it("vai de ocioso até o QR na tela", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    expect(result.current.status).toBe("ocioso");

    await act(async () => { await result.current.start("inst-1"); });
    await waitFor(() => expect(result.current.status).toBe("aguardando-qr"));

    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "codigo-do-qr" }));
    await waitFor(() => expect(result.current.status).toBe("qr-na-tela"));
    expect(result.current.qr).toBe("codigo-do-qr");
  });

  it("troca o QR quando ele rotaciona, sem sair do estado", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "primeiro" }));
    await waitFor(() => expect(result.current.qr).toBe("primeiro"));
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "segundo" }));
    await waitFor(() => expect(result.current.qr).toBe("segundo"));
    expect(result.current.status).toBe("qr-na-tela");
  });

  it("conclui quando o auth-state diz que pareou, e larga o QR", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "codigo" }));
    await waitFor(() => expect(result.current.status).toBe("qr-na-tela"));

    act(() => emit({ type: "auth-state", sessionId: "tc-1", paired: true }));
    await waitFor(() => expect(result.current.status).toBe("pareado"));
    // O QR é credencial: some assim que deixa de ser necessário.
    expect(result.current.qr).toBeNull();
  });

  it("ignora evento de outra sessão", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "OUTRA", qr: "nao-e-meu" }));
    await waitFor(() => expect(result.current.status).toBe("aguardando-qr"));
    expect(result.current.qr).toBeNull();
  });

  it("mostra a mensagem traduzida quando a criação é recusada", async () => {
    const { VoiceControlError } = await import("@/modules/communication/lib/torquecallsApi");
    createVoiceSession.mockRejectedValue(new (VoiceControlError as any)("session_cap_reached", "Limite atingido."));
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    await waitFor(() => expect(result.current.status).toBe("falhou"));
    expect(result.current.error).toBe("Limite atingido.");
  });

  it("tentar de novo reusa a sessão em vez de criar outra", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    createVoiceSession.mockClear();

    await act(async () => { await result.current.retry(); });

    expect(pairVoiceSession).toHaveBeenCalledWith({ tcSessionId: "tc-1" });
    expect(createVoiceSession).not.toHaveBeenCalled();
  });

  it("o stream caindo depois do QR na tela leva a falhou", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "codigo" }));
    await waitFor(() => expect(result.current.status).toBe("qr-na-tela"));

    act(() => { streams.at(-1)?.reject(new Error("conexão caiu")); });
    await waitFor(() => expect(result.current.status).toBe("falhou"));
  });

  it("retry a partir de falhou reabre o stream: session-qr depois volta pra tela", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "codigo" }));
    await waitFor(() => expect(result.current.status).toBe("qr-na-tela"));

    // O stream original morre sem nenhum pareamento ter concluído.
    act(() => { streams.at(-1)?.reject(new Error("conexão caiu")); });
    await waitFor(() => expect(result.current.status).toBe("falhou"));

    expect(subscribeSessionEvents).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.retry(); });

    // Este é o teste que prova o CRITICAL consertado: sem `openStream` dentro
    // de `retry`, esta segunda chamada nunca acontece e nenhum evento volta a
    // ser ouvido.
    expect(subscribeSessionEvents).toHaveBeenCalledTimes(2);

    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "novo-codigo" }));
    await waitFor(() => expect(result.current.status).toBe("qr-na-tela"));
    expect(result.current.qr).toBe("novo-codigo");
  });

  it("o stream terminando sozinho sem parear leva a falhou, não trava em aguardando-qr", async () => {
    const { result } = renderHook(() => useVoicePairing(), { wrapper });
    await act(async () => { await result.current.start("inst-1"); });
    await waitFor(() => expect(result.current.status).toBe("aguardando-qr"));

    act(() => { streams.at(-1)?.resolve(); });
    await waitFor(() => expect(result.current.status).toBe("falhou"));
  });

  it("cancelar no meio da criação da sessão não deixa o hook seguir em frente", async () => {
    let releaseCreate: ((v: { tcSessionId: string }) => void) | null = null;
    createVoiceSession.mockImplementation(
      () => new Promise<{ tcSessionId: string }>((resolve) => { releaseCreate = resolve; }),
    );

    const { result } = renderHook(() => useVoicePairing(), { wrapper });

    let startPromise!: Promise<void>;
    act(() => { startPromise = result.current.start("inst-1"); });
    await waitFor(() => expect(result.current.status).toBe("criando"));

    act(() => result.current.cancel());
    expect(result.current.status).toBe("ocioso");

    // `createVoiceSession` só resolve DEPOIS do cancel — é a janela em que
    // nada existia pra abortar. A continuação de `start` tem que se abandonar
    // sozinha em vez de ressuscitar o fluxo cancelado.
    await act(async () => {
      releaseCreate?.({ tcSessionId: "tc-1" });
      await startPromise;
    });

    expect(result.current.status).toBe("ocioso");
    expect(result.current.qr).toBeNull();
    expect(requestStreamToken).not.toHaveBeenCalled();
  });
});
