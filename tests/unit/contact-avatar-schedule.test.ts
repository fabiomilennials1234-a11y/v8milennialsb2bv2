// @vitest-environment node
/**
 * scheduleContactAvatarCandidate (_shared/contact-avatar-schedule.ts) — o
 * código REAL que o webhook chama depois de persistir a mensagem. RPC
 * dublada, logger dublado. Prende: retorno síncrono void, nunca lança, nunca
 * deixa rejeição solta, loga sem PII, zero fetch, memo e o call site no handler.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logRuntime = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime }));

import { scheduleContactAvatarCandidate } from "../../supabase/functions/_shared/contact-avatar-schedule";
import { AvatarCandidateMemo } from "../../supabase/functions/_shared/contact-avatar";

type Shape = Record<string, unknown>;
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/uazapi/torquesdr-sse-shapes-2026-09-11.json", import.meta.url), "utf8"),
) as Array<{ event: string; shape: Shape }>;
const messagesShape = fixture.find((f) => f.event === "messages")!.shape;
function materialize(node: unknown): unknown {
  if (node === "string") return "";
  if (node === "number") return 0;
  if (node === "boolean") return false;
  if (node && typeof node === "object") {
    const s = node as Shape;
    if (s.type === "array") return [];
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, materialize(v)]));
  }
  return null;
}
const PREVIEW = "https://pps.whatsapp.net/v/t61.24694-24/1_n.jpg?stp=dst-jpg_s96x96&ccb=11-4&oh=01_Q5&oe=69300000";
function payload(over: { chat?: Shape; message?: Shape } = {}): Shape {
  const p = materialize(messagesShape) as Record<string, Shape>;
  return {
    ...p,
    chat: { ...p.chat, wa_chatid: "5511999990001@s.whatsapp.net", wa_isGroup: false, imagePreview: PREVIEW, ...over.chat },
    message: { ...p.message, fromMe: false, ...over.message },
  };
}
const instance = { id: "00000000-0000-4000-8000-000000000011", organization_id: "00000000-0000-4000-8000-000000000001", provider: "uazapi" };
type Edge = { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } };

let waitUntil: ReturnType<typeof vi.fn>;
beforeEach(() => {
  logRuntime.mockClear();
  waitUntil = vi.fn();
  (globalThis as Edge).EdgeRuntime = { waitUntil };
});
afterEach(() => {
  delete (globalThis as Edge).EdgeRuntime;
});

describe("scheduleContactAvatarCandidate", () => {
  it.each([
    ["RPC devolve error", () => Promise.resolve({ error: { message: "boom" } })],
    ["RPC rejeita", () => Promise.reject(new Error("network down"))],
    ["RPC lança síncrono", () => { throw new Error("sync throw"); }],
  ])("%s: void síncrono, sem throw, sem rejeição solta, loga sem PII", async (_n, impl) => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const rpc = vi.fn(impl as () => Promise<{ error: unknown }>);
    let ret: unknown = "unset";
    expect(() => { ret = scheduleContactAvatarCandidate({ rpc }, instance, payload(), new AvatarCandidateMemo()); }).not.toThrow();
    expect(ret).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);
    expect(rpc).toHaveBeenCalledWith("registrar_avatar_candidato", expect.objectContaining({ p_phone: "5511999990001", p_url: PREVIEW }));
    expect(logRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "contact_avatar_register_error", status: "error", module: "webhook" }));
    expect(unhandled).not.toHaveBeenCalled();
    const snap = JSON.stringify(logRuntime.mock.calls[0]);
    expect(snap).not.toContain("5511999990001");
    expect(snap).not.toContain("pps.whatsapp.net");
  });

  it("grupo, fromMe, host fora e caixa não-Uazapi: nenhuma RPC", () => {
    const rpc = vi.fn();
    const memo = new AvatarCandidateMemo();
    scheduleContactAvatarCandidate({ rpc }, instance, payload({ chat: { wa_isGroup: true } }), memo);
    scheduleContactAvatarCandidate({ rpc }, instance, payload({ message: { fromMe: true } }), memo);
    scheduleContactAvatarCandidate({ rpc }, instance, payload({ chat: { imagePreview: "https://evil.example/x.jpg" } }), memo);
    scheduleContactAvatarCandidate({ rpc }, { ...instance, provider: "meta_cloud" }, payload(), memo);
    expect(rpc).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("payload lixo não lança", () => {
    const rpc = vi.fn();
    expect(() => scheduleContactAvatarCandidate({ rpc }, instance, { chat: "x" })).not.toThrow();
    expect(() => scheduleContactAvatarCandidate({ rpc }, instance, { chat: null, message: null })).not.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("zero download: nunca chama fetch", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    scheduleContactAvatarCandidate({ rpc: vi.fn(async () => ({ error: null })) }, instance, payload(), new AvatarCandidateMemo());
    await waitUntil.mock.calls[0][0];
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });

  it("memo: 50 mensagens do mesmo contato = 1 RPC", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const memo = new AvatarCandidateMemo();
    for (let i = 0; i < 50; i++) {
      scheduleContactAvatarCandidate({ rpc }, instance, payload(), memo);
      await waitUntil.mock.calls.at(-1)?.[0];
    }
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("call site: o handler chama DEPOIS de handleMessagesEvent, sem await", () => {
    const src = readFileSync(new URL("../../supabase/functions/whatsapp-webhook/handler.ts", import.meta.url), "utf8");
    expect(src).toMatch(/await handleMessagesEvent\([^)]*\);\s*\n\s*scheduleContactAvatarCandidate\(supabase, instance, payload\);/);
    expect(src).toMatch(/import \{ scheduleContactAvatarCandidate \} from "\.\.\/_shared\/contact-avatar-schedule\.ts";/);
  });
});
