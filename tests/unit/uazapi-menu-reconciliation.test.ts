import { afterEach, describe, expect, it, vi } from "vitest";
import "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider";

const provider = () => new UazapiProvider({ baseUrl: "https://uazapi.test", token: "test-token", adminToken: "test-admin", instanceId: "instance", organizationId: "org", supabaseAdmin: createMockSupabase().sb });
describe("Reconciliação de pergunta Uazapi", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("recupera aceite por tracking sem enviar outra mensagem", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{
      id: "internal-id", messageid: "original-whatsapp-id", fromMe: true, chatid: "5511999999999@s.whatsapp.net",
      track_id: "question-occurrence", track_source: "workflow-question-buttons", status: "Read", messageTimestamp: 1700000000123,
    }], hasMore: false }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    expect(await provider().findTrackedMenu({ number: "5511999999999", trackId: "question-occurrence", trackSource: "workflow-question-buttons" }))
      .toEqual({ state: "accepted", whatsappMessageId: "original-whatsapp-id", acceptedAt: "2023-11-14T22:13:20.123Z" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("https://uazapi.test/message/find");
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ chatid: "5511999999999@s.whatsapp.net", track_id: "question-occurrence", track_source: "workflow-question-buttons", limit: 2, offset: 0 });
  });
  it("ausência no histórico permanece ausência, nunca autorização de reenvio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [], hasMore: false }), { status: 200 })));
    expect(await provider().findTrackedMenu({ number: "5511999999999", trackId: "q", trackSource: "workflow-question-buttons" })).toEqual({ state: "not_found" });
  });
  it.each([
    { change: { track_id: "other" }, reason: "tracking diferente" },
    { change: { chatid: "5511888888888@s.whatsapp.net" }, reason: "outra conversa" },
    { change: { fromMe: false }, reason: "mensagem recebida" },
    { change: { messageTimestamp: 0 }, reason: "sem horário original" },
    { change: { status: "unknown-state" }, reason: "status desconhecido" },
  ])("mantém incerto quando encontra $reason", async ({ change }) => {
    const message = { messageid: "wa", chatid: "5511999999999@s.whatsapp.net", fromMe: true, track_id: "q", track_source: "workflow-question-buttons", status: "Sent", messageTimestamp: 1700000000123, ...change };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [message] }), { status: 200 })));
    expect(await provider().findTrackedMenu({ number: "5511999999999", trackId: "q", trackSource: "workflow-question-buttons" })).toEqual({ state: "uncertain" });
  });
  it("não escolhe arbitrariamente uma de duas mensagens com mesmo tracking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ messageid: "one" }, { messageid: "two" }] }), { status: 200 })));
    expect(await provider().findTrackedMenu({ number: "5511999999999", trackId: "q", trackSource: "workflow-question-buttons" })).toEqual({ state: "uncertain" });
  });
  it("preserva falha explícita em vez de tratá-la como aceite", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ messageid: "wa", chatid: "5511999999999@s.whatsapp.net", fromMe: true, track_id: "q", track_source: "workflow-question-buttons", status: "Failed", messageTimestamp: 1700000000123 }] }), { status: 200 })));
    expect(await provider().findTrackedMenu({ number: "5511999999999", trackId: "q", trackSource: "workflow-question-buttons" })).toEqual({ state: "failed", whatsappMessageId: "wa", acceptedAt: "2023-11-14T22:13:20.123Z" });
  });

});
