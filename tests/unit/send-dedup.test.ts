/**
 * send-dedup — dedup atômica POR CONTAGEM em todo caminho de send (#1156).
 *
 * O núcleo (`tryReserveSend`) delega a atomicidade ao RPC `fn_reserve_send`
 * (UPSERT com reset-por-gap no Postgres) e decide `ok`/`duplicate` pelo
 * `hit_count` devolvido, contra o limiar por source. Aqui mockamos o RPC e
 * exercemos o CONTRATO de contagem + o mapa de source + os gates de flag.
 *
 * Race real + reset-por-gap no SQL + RLS vivem em pgTAP
 * (supabase/tests/send_dedup_reserve.test.sql) e no integration.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// logRuntime é chamado no fail-open de reserveSendOrSkip — espionamos.
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
}));

import { logRuntime } from "../../supabase/functions/_shared/logger.ts";
import {
  normalizeContent,
  hashContent,
  getDefaultWindow,
  deriveSendSource,
  dedupBarAt,
  conversationalDedupEnabled,
  tryReserveSend,
  reserveSendOrSkip,
  type SendSource,
} from "../../supabase/functions/_shared/send-dedup.ts";

/** Deno.env stub (node vitest não tem Deno). Reconstruído a cada teste. */
let envMap: Record<string, string>;
beforeEach(() => {
  envMap = {};
  vi.stubGlobal("Deno", { env: { get: (k: string) => envMap[k] } });
  vi.clearAllMocks();
});

/**
 * Cliente Supabase fake: só `.rpc(fn, args)`. `handler` recebe os args e devolve
 * `{ data, error }` — modela o `fn_reserve_send` (retorna hit_count).
 */
function rpcClient(handler: (fn: string, args: any) => { data: any; error: any }) {
  const calls: Array<{ fn: string; args: any }> = [];
  const client = {
    rpc: async (fn: string, args: any) => {
      calls.push({ fn, args });
      return handler(fn, args);
    },
  };
  return { client, calls };
}

/** Atalho: rpc que sempre devolve o mesmo hit_count. */
const constHit = (hit: number) => rpcClient(() => ({ data: hit, error: null }));

describe("normalizeContent", () => {
  it("lowercases and trims", () => {
    expect(normalizeContent("  HELLO World  ")).toBe("hello world");
  });

  it("collapses internal whitespace and strips zero-width joiners", () => {
    const a = "Oi‍Filipe!"; // ZWJ entre palavras
    const b = "Oi  Filipe!  ";
    expect(normalizeContent(a)).toBe("oifilipe!");
    expect(normalizeContent(b)).toBe("oi filipe!");
  });
});

describe("hashContent", () => {
  it("is deterministic for same normalized content", async () => {
    const h1 = await hashContent("Oi Filipe!");
    const h2 = await hashContent("  OI   filipe!  ");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{32}$/);
  });

  it("differs for different content", async () => {
    expect(await hashContent("Oi Filipe!")).not.toBe(await hashContent("Oi Marcos!"));
  });
});

describe("getDefaultWindow", () => {
  it("manual = 10s (operador clica rápido, janela curta)", () => {
    expect(getDefaultWindow("manual")).toBe(10);
  });
  it("copilot e copilot_v2 = 300s (cobre loop lento do Bertin ~150s)", () => {
    expect(getDefaultWindow("copilot")).toBe(300);
    expect(getDefaultWindow("copilot_v2")).toBe(300);
  });
  it("mass_send = 24h", () => {
    expect(getDefaultWindow("mass_send")).toBe(86_400);
  });
  it("cobre todo SendSource", () => {
    const sources: SendSource[] = ["manual", "copilot", "copilot_v2", "workflow", "mass_send", "followup"];
    for (const s of sources) expect(getDefaultWindow(s)).toBeGreaterThan(0);
  });
});

describe("deriveSendSource — fronteira trackSource → enum fechado", () => {
  it("mapeia a classe copilot* (5 trackSource) pro eixo conversacional", () => {
    expect(deriveSendSource("copilot")).toBe("copilot");
    expect(deriveSendSource("copilot_v2")).toBe("copilot_v2");
    expect(deriveSendSource("copilot-followup")).toBe("copilot");
    expect(deriveSendSource("copilot-outbound")).toBe("copilot");
    expect(deriveSendSource("copilot-outbound-audio")).toBe("copilot");
  });
  it("mapeia os self-sources", () => {
    expect(deriveSendSource("workflow")).toBe("workflow");
    expect(deriveSendSource("mass_send")).toBe("mass_send");
    expect(deriveSendSource("followup")).toBe("followup");
    expect(deriveSendSource("manual")).toBe("manual");
  });
  it("fora-de-escopo e desconhecido → null (chamador PULA o dedup, nunca classifica errado)", () => {
    expect(deriveSendSource("carteira_bulk")).toBeNull();
    expect(deriveSendSource("dispatch-router-mass")).toBeNull();
    expect(deriveSendSource("portfolio_alert")).toBeNull();
    expect(deriveSendSource("qualquer-coisa-nova")).toBeNull();
    expect(deriveSendSource(null)).toBeNull();
    expect(deriveSendSource(undefined)).toBeNull();
    expect(deriveSendSource("")).toBeNull();
  });
});

describe("dedupBarAt — limiar por FREQUÊNCIA", () => {
  it("copilot/copilot_v2 = 3 (permite 2 acks legítimos, barra a 3ª)", () => {
    expect(dedupBarAt("copilot")).toBe(3);
    expect(dedupBarAt("copilot_v2")).toBe(3);
  });
  it("demais = 2 (repetir literal em workflow/mass é bug)", () => {
    expect(dedupBarAt("workflow")).toBe(2);
    expect(dedupBarAt("mass_send")).toBe(2);
    expect(dedupBarAt("manual")).toBe(2);
    expect(dedupBarAt("followup")).toBe(2);
  });
  it("eixo copilot é env-tunável (SEND_DEDUP_COPILOT_BAR_AT)", () => {
    envMap.SEND_DEDUP_COPILOT_BAR_AT = "5";
    expect(dedupBarAt("copilot")).toBe(5);
  });
  it("env inválido (< 2 ou não-inteiro) cai no default 3", () => {
    envMap.SEND_DEDUP_COPILOT_BAR_AT = "1";
    expect(dedupBarAt("copilot")).toBe(3);
    envMap.SEND_DEDUP_COPILOT_BAR_AT = "abc";
    expect(dedupBarAt("copilot")).toBe(3);
  });
});

describe("conversationalDedupEnabled — kill-switch + allowlist", () => {
  it("default OFF (flag ausente) → false (comportamento byte-a-byte de hoje)", () => {
    expect(conversationalDedupEnabled("org-x")).toBe(false);
  });
  it("ENABLED=true sem allowlist → true pra qualquer org", () => {
    envMap.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    expect(conversationalDedupEnabled("org-x")).toBe(true);
  });
  it("ENABLED=true com allowlist → só as orgs listadas (canário)", () => {
    envMap.SEND_DEDUP_CONVERSATIONAL_ENABLED = "true";
    envMap.SEND_DEDUP_CONVERSATIONAL_ORGS = " org-a , org-b ";
    expect(conversationalDedupEnabled("org-a")).toBe(true);
    expect(conversationalDedupEnabled("org-b")).toBe(true);
    expect(conversationalDedupEnabled("org-c")).toBe(false);
  });
  it("ENABLED != 'true' ignora allowlist → false", () => {
    envMap.SEND_DEDUP_CONVERSATIONAL_ENABLED = "1";
    envMap.SEND_DEDUP_CONVERSATIONAL_ORGS = "org-a";
    expect(conversationalDedupEnabled("org-a")).toBe(false);
  });
});

describe("tryReserveSend — contrato de contagem (via fn_reserve_send)", () => {
  const base = {
    orgId: "org-1",
    phone: "+5511937347373",
    contentHash: "deadbeef",
  };

  it("hit_count 1 (1ª ocorrência) → ok", async () => {
    const { client } = constHit(1);
    const r = await tryReserveSend({ supabase: client as any, ...base, source: "copilot" });
    expect(r.kind).toBe("ok");
  });

  it("copilot permite a 2ª (hit=2 < bar 3) → ok", async () => {
    const { client } = constHit(2);
    const r = await tryReserveSend({ supabase: client as any, ...base, source: "copilot" });
    expect(r.kind).toBe("ok");
  });

  it("copilot barra a 3ª (hit=3 >= bar 3) → duplicate com ttlSeconds da janela", async () => {
    const { client } = constHit(3);
    const r = await tryReserveSend({ supabase: client as any, ...base, source: "copilot" });
    expect(r.kind).toBe("duplicate");
    if (r.kind === "duplicate") expect(r.ttlSeconds).toBe(300);
  });

  it("workflow barra já na 2ª (bar 2)", async () => {
    const { client } = constHit(2);
    const r = await tryReserveSend({ supabase: client as any, ...base, source: "workflow" });
    expect(r.kind).toBe("duplicate");
  });

  it("idk presente: barra a 2ª ocorrência do MESMO idk (replay literal), independente do source", async () => {
    const dup = constHit(2);
    const rDup = await tryReserveSend({ supabase: dup.client as any, ...base, source: "copilot", idempotencyKey: "log-1:0" });
    expect(rDup.kind).toBe("duplicate"); // bar 2 mesmo sendo copilot

    const ok = constHit(1);
    const rOk = await tryReserveSend({ supabase: ok.client as any, ...base, source: "copilot", idempotencyKey: "log-1:0" });
    expect(rOk.kind).toBe("ok"); // 1ª do idk sempre passa (chunk distinto)
  });

  it("passa idk e ttl override pro RPC (p_idempotency_key / p_ttl_seconds)", async () => {
    const { client, calls } = constHit(1);
    await tryReserveSend({ supabase: client as any, ...base, source: "copilot", idempotencyKey: "k", windowSeconds: 42 });
    expect(calls[0].fn).toBe("fn_reserve_send");
    expect(calls[0].args.p_idempotency_key).toBe("k");
    expect(calls[0].args.p_ttl_seconds).toBe(42);
    expect(calls[0].args.p_source).toBe("copilot");
  });

  it("erro de infra do RPC → LANÇA (caller faz fail-open)", async () => {
    const { client } = rpcClient(() => ({ data: null, error: { message: "relation does not exist" } }));
    await expect(
      tryReserveSend({ supabase: client as any, ...base, source: "workflow" }),
    ).rejects.toThrow(/send-dedup reserve failed/);
  });
});

describe("reserveSendOrSkip — wrapper fail-open", () => {
  it("hit=1 → não duplicate", async () => {
    const { client } = constHit(1);
    const r = await reserveSendOrSkip({ supabase: client, orgId: "o", phone: "p", content: "Olá!", source: "copilot" });
    expect(r.duplicate).toBe(false);
  });

  it("hit atinge o limiar → duplicate", async () => {
    const { client } = constHit(3);
    const r = await reserveSendOrSkip({ supabase: client, orgId: "o", phone: "p", content: "Oi Filipe!", source: "copilot" });
    expect(r.duplicate).toBe(true);
  });

  it("FAIL-OPEN (duplicate=false) + GRITA via logRuntime quando a infra erra", async () => {
    const { client } = rpcClient(() => ({ data: null, error: { message: "no rpc" } }));
    const r = await reserveSendOrSkip({ supabase: client, orgId: "o", phone: "p", content: "hi", source: "workflow" });
    expect(r.duplicate).toBe(false);
    expect(logRuntime).toHaveBeenCalledTimes(1);
    const arg = (logRuntime as any).mock.calls[0][0];
    expect(arg.action).toBe("dedup_reserve_fail_open");
    expect(arg.status).toBe("error");
    // nunca conteúdo/telefone cru no log
    expect(JSON.stringify(arg)).not.toContain("hi");
  });

  it("nunca dedupa conteúdo vazio/whitespace (não chama o RPC)", async () => {
    const rpc = vi.fn();
    const r = await reserveSendOrSkip({ supabase: { rpc } as any, orgId: "o", phone: "p", content: "   ", source: "workflow" });
    expect(r.duplicate).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("orgId ou phone ausente → não dedupa (não chama o RPC)", async () => {
    const rpc = vi.fn();
    expect((await reserveSendOrSkip({ supabase: { rpc } as any, orgId: "", phone: "p", content: "x", source: "workflow" })).duplicate).toBe(false);
    expect((await reserveSendOrSkip({ supabase: { rpc } as any, orgId: "o", phone: "", content: "x", source: "workflow" })).duplicate).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
