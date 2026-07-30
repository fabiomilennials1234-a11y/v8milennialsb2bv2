import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  createVoiceSession,
  requestStreamToken,
  VOICE_CONTROL_MESSAGES,
  VoiceControlError,
} from "./torquecallsApi";

beforeEach(() => invoke.mockReset());

/**
 * Reproduz o shape REAL do `@supabase/functions-js` — não o que é conveniente
 * de mockar. Quando a edge function responde com status de erro, o client
 * devolve `data: null` e põe a resposta HTTP crua, ainda não lida, em
 * `error.context`. Um mock `{ data: { code }, error: {...} }` (o do round
 * anterior) NUNCA pegaria esse bug: `data` é sempre `null` nesse caminho, e o
 * teste passava lendo um shape que o client de verdade nunca produz.
 */
function httpErrorInvokeResult(status: number, body: Record<string, unknown>) {
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify(body), { status }),
    },
  };
}

describe("createVoiceSession", () => {
  it("manda a instância e devolve o id da sessão", async () => {
    invoke.mockResolvedValue({ data: { tc_session_id: "tc-1" }, error: null });
    const out = await createVoiceSession({ whatsappInstanceId: "inst-1" });
    expect(out).toEqual({ tcSessionId: "tc-1" });
    expect(invoke).toHaveBeenCalledWith("torquecalls-control", {
      body: { action: "createSession", whatsapp_instance_id: "inst-1", name: "TorqueCalls" },
    });
  });

  it("traduz o código do erro em vez de vazar o cru", async () => {
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, { error: "Limite atingido", code: "session_cap_reached" }),
    );
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toMatchObject({ code: "session_cap_reached" });
  });

  it("é uma VoiceControlError de verdade, não um Error genérico", async () => {
    invoke.mockResolvedValue(
      httpErrorInvokeResult(403, { error: "Sem voz no plano", code: "voice_feature_off" }),
    );
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toBeInstanceOf(VoiceControlError);
  });

  it("pairVoiceSession reusa a sessão em vez de criar outra", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    const { pairVoiceSession } = await import("./torquecallsApi");
    await pairVoiceSession({ tcSessionId: "tc-1" });
    expect(invoke).toHaveBeenCalledWith("torquecalls-control", {
      body: { action: "pairSession", tc_session_id: "tc-1" },
    });
  });
});

describe("requestStreamToken", () => {
  it("só pede o QR quando pair é explícito", async () => {
    invoke.mockResolvedValue({ data: { token: "t", expires_at: 1, renew_in_ms: 1, vps_url: "u" }, error: null });
    await requestStreamToken({ tcSessionId: "tc-1" });
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("pair");

    invoke.mockClear();
    await requestStreamToken({ tcSessionId: "tc-1", pair: true });
    expect(invoke.mock.calls[0][1].body).toMatchObject({ pair: true });
  });
});

describe("VOICE_CONTROL_MESSAGES", () => {
  it("cobre todos os códigos que a tela pode receber hoje", () => {
    for (const code of ["voice_feature_off", "session_cap_reached", "session_orphaned"]) {
      expect(VOICE_CONTROL_MESSAGES[code]).toBeTruthy();
    }
  });

  // Não é esquecimento: nenhum caminho hoje produz "device_limit_reached" (ver
  // o comentário acima da tabela em torquecallsApi.ts). Um teste "cobre todos
  // os códigos" que incluísse essa chave provaria só que a tabela TEM a
  // chave — não que algum código real a alcança. Foi exatamente esse tipo de
  // falso-verde que deixou passar o defeito do round anterior.
  it("NÃO promete tradução para device_limit_reached — nenhum código chega até ela hoje", () => {
    expect(VOICE_CONTROL_MESSAGES.device_limit_reached).toBeUndefined();
  });
});

// O `signal()` (plano `torquecalls-signal`, usado por startCall/endCall/
// requestStreamToken) tinha o MESMO defeito: lia `error.context.body`, que é
// o próprio `Response`, e `Response.body` é um ReadableStream — nunca um
// `{ code }`. `CallDeniedError` nunca nascia de uma recusa HTTP de verdade.
describe("signal() — mesma fronteira de invoke, mesmo conserto", () => {
  it("CallDeniedError sai de uma recusa HTTP com code, via startCall", async () => {
    const { startCall, CallDeniedError } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, { error: "Você já está em uma chamada.", code: "operator_busy" }),
    );
    await expect(startCall({ tcSessionId: "tc-1", leadId: "lead-1" }))
      .rejects.toBeInstanceOf(CallDeniedError);
  });

  it("a mensagem traduzida chega, não o fallback genérico", async () => {
    const { startCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, { error: "cru", code: "operator_busy" }),
    );
    await expect(startCall({ tcSessionId: "tc-1", leadId: "lead-1" }))
      .rejects.toMatchObject({ code: "operator_busy", message: "Você já está em uma chamada." });
  });
});
