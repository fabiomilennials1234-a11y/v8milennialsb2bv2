import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";
import type { SessionEvent } from "@/modules/communication/lib/torquecallsEvents";

const createVoiceSession = vi.fn();
const pairVoiceSession = vi.fn();
const requestStreamToken = vi.fn();
let emit: (e: SessionEvent) => void = () => {};

vi.mock("@/modules/communication/lib/torquecallsApi", () => ({
  createVoiceSession: (...a: unknown[]) => createVoiceSession(...a),
  pairVoiceSession: (...a: unknown[]) => pairVoiceSession(...a),
  requestStreamToken: (...a: unknown[]) => requestStreamToken(...a),
  VoiceControlError: class extends Error { constructor(public code: string, m?: string) { super(m); } },
  VOICE_CONTROL_MESSAGES: { session_cap_reached: "Limite atingido." },
}));

vi.mock("@/modules/communication/lib/torquecallsEvents", () => ({
  subscribeSessionEvents: (args: { onEvent: (e: SessionEvent) => void }) => {
    emit = args.onEvent;
    return new Promise<void>(() => {}); // stream fica aberto
  },
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
});
