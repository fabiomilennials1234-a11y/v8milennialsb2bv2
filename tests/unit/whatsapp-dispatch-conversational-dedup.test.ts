// @vitest-environment node
/**
 * Dedup conversacional no choke único (#1156).
 *
 * O gate mora DENTRO de `governSend` (send-governor/gate.ts), no ramo allow,
 * ANTES do doSend e do accounting pós-send. Morar aqui cobre TODOS os callers
 * diretos de governSend (copilot-v2-worker, dispatch-router, followup-sender,
 * outbound-sender + helpers do whatsapp-dispatch) — o v2 chamava governSend
 * direto e bypassava o fix quando ele morava nas closures do dispatch.
 *
 * Determinístico, SEM DB: injetamos `deps` (governor em modo off → ramo allow),
 * mockamos `reserveSendOrSkip` e o logger, e exercemos a sequência real
 * governSend(allow) → dedup gate → doSend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {};
  return {
    env,
    reserveSpy: vi.fn(async (_args: any) => ({ duplicate: false })),
    logRuntimeSpy: vi.fn(async () => {}),
    doSendSpy: vi.fn(async () => ({ message_id: "m1", success: true })),
  };
});

vi.stubGlobal("Deno", {
  env: { get: (k: string) => h.env[k], toObject: () => ({}) },
  serve: () => {},
});

// send-dedup: real deriveSendSource/conversationalDedupEnabled/getDefaultWindow/
// hashContent; só reserveSendOrSkip mockado.
vi.mock("../../supabase/functions/_shared/send-dedup.ts", async (importActual) => {
  const actual = await importActual<typeof import("../../supabase/functions/_shared/send-dedup.ts")>();
  return { ...actual, reserveSendOrSkip: h.reserveSpy };
});
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: h.logRuntimeSpy,
  redactSecrets: (v: unknown) => v,
}));

const { governSend, isSkippedSend } = await import("../../supabase/functions/_shared/send-governor/gate.ts");

const SUPA = {} as any;
const PHONE = "5511988887777";
// Governor em modo off → ramo allow, sem tocar ledger. Isola o dedup gate.
const DEPS = {
  resolveGovernorState: async () => ({ mode: "off" }) as any,
  evaluateSend: () => ({ action: "allow", wouldBe: "allow", reason: "allowed", category: "automation", mode: "off", shadowed: false }) as any,
  recordDecision: async () => {},
  incrementAutomationUsage: async () => {},
  recordBanSignal: async () => {},
} as any;

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    orgId: "org-A",
    instanceId: "inst-1",
    category: "automation" as const,
    recipientPhone: PHONE,
    trackSource: "copilot",
    content: "Oi Filipe!",
    ...overrides,
  };
}

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.reserveSpy.mockClear().mockResolvedValue({ duplicate: false });
  h.logRuntimeSpy.mockClear();
  h.doSendSpy.mockClear().mockResolvedValue({ message_id: "m1", success: true });
});

describe("governSend — dedup gate (#1156)", () => {
  it("kill-switch OFF (default): reserve nem é chamado, doSend roda", async () => {
    const r = await governSend(SUPA, ctx(), h.doSendSpy, DEPS);
    expect(h.reserveSpy).not.toHaveBeenCalled();
    expect(h.doSendSpy).toHaveBeenCalledTimes(1);
    expect(isSkippedSend(r)).toBe(false);
  });

  it("ON + duplicate:true → NÃO chama doSend, retorna skip dedup_conversational, loga dedup_skip", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    h.reserveSpy.mockResolvedValue({ duplicate: true, ttlSeconds: 300 });
    const r = await governSend(SUPA, ctx(), h.doSendSpy, DEPS);
    expect(h.doSendSpy).not.toHaveBeenCalled();
    expect(isSkippedSend(r)).toBe(true);
    if (isSkippedSend(r)) {
      expect(r.reason).toBe("dedup_conversational");
      expect(r.action).toBe("block");
    }
    expect(h.logRuntimeSpy).toHaveBeenCalledWith(expect.objectContaining({ action: "dedup_skip", status: "skipped" }));
    // telefone só HASHEADO no log, nunca cru
    const logArg = h.logRuntimeSpy.mock.calls.find((c) => c[0]?.action === "dedup_skip")![0];
    expect(JSON.stringify(logArg)).not.toContain(PHONE);
    expect(logArg.payloadSnapshot.phone_hash).toMatch(/^[a-f0-9]{32}$/);
  });

  it("ON + duplicate:false → doSend roda", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    h.reserveSpy.mockResolvedValue({ duplicate: false });
    const r = await governSend(SUPA, ctx(), h.doSendSpy, DEPS);
    expect(h.reserveSpy).toHaveBeenCalledTimes(1);
    expect(h.doSendSpy).toHaveBeenCalledTimes(1);
    expect(isSkippedSend(r)).toBe(false);
  });

  it("ON + idk presente → repassado pro reserve (chunk de mensagem lógica)", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    await governSend(SUPA, ctx({ idempotencyKey: "log-1:2" }), h.doSendSpy, DEPS);
    expect(h.reserveSpy).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "log-1:2", source: "copilot" }));
  });

  it("ON + sem content → reserve nem é chamado, doSend roda", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    const r = await governSend(SUPA, ctx({ content: null }), h.doSendSpy, DEPS);
    expect(h.reserveSpy).not.toHaveBeenCalled();
    expect(h.doSendSpy).toHaveBeenCalledTimes(1);
    expect(isSkippedSend(r)).toBe(false);
  });

  it("ON + trackSource desconhecido → pula dedup, doSend roda, loga dedup_source_unknown 1×", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    // valor único (o Set de dedup de log é module-level e persiste no teste)
    await governSend(SUPA, ctx({ trackSource: "sistema_x_unico" }), h.doSendSpy, DEPS);
    await governSend(SUPA, ctx({ trackSource: "sistema_x_unico" }), h.doSendSpy, DEPS);
    expect(h.reserveSpy).not.toHaveBeenCalled();
    expect(h.doSendSpy).toHaveBeenCalledTimes(2);
    const unknownLogs = h.logRuntimeSpy.mock.calls.filter((c) => c[0]?.action === "dedup_source_unknown");
    expect(unknownLogs).toHaveLength(1); // 1× por valor distinto, não por send
  });

  it("ON + allowlist NÃO inclui a org → no-op, doSend roda", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    h.env.SEND_DEDUP_CONVERSATIONAL_ORGS = "org-outra,org-mais";
    const r = await governSend(SUPA, ctx(), h.doSendSpy, DEPS);
    expect(h.reserveSpy).not.toHaveBeenCalled();
    expect(h.doSendSpy).toHaveBeenCalledTimes(1);
    expect(isSkippedSend(r)).toBe(false);
  });

  it("ON + allowlist inclui a org → deduplica", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    h.env.SEND_DEDUP_CONVERSATIONAL_ORGS = "org-A,org-mais";
    h.reserveSpy.mockResolvedValue({ duplicate: true, ttlSeconds: 300 });
    const r = await governSend(SUPA, ctx(), h.doSendSpy, DEPS);
    expect(h.reserveSpy).toHaveBeenCalledTimes(1);
    expect(h.doSendSpy).not.toHaveBeenCalled();
    expect(isSkippedSend(r)).toBe(true);
  });

  it("FAIL-OPEN: reserve lança → doSend roda mesmo assim (belt-and-braces)", async () => {
    h.env.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    h.reserveSpy.mockRejectedValue(new Error("infra down"));
    const r = await governSend(SUPA, ctx(), h.doSendSpy, DEPS);
    expect(h.doSendSpy).toHaveBeenCalledTimes(1);
    expect(isSkippedSend(r)).toBe(false);
  });
});
