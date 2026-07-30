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
    invoke.mockResolvedValue({ data: { code: "session_cap_reached" }, error: { message: "409" } });
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toMatchObject({ code: "session_cap_reached" });
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
  it("cobre todos os códigos que a tela pode receber", () => {
    for (const code of [
      "voice_feature_off",
      "session_cap_reached",
      "session_orphaned",
      "device_limit_reached",
    ]) {
      expect(VOICE_CONTROL_MESSAGES[code]).toBeTruthy();
    }
  });
});
