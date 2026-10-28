import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  isAmbiguousSendFailure,
  parseRecentOutgoing,
  reconcileAmbiguousSend,
  type ReconcileDeps,
} from "./send-outcome-reconcile.ts";

const T0 = 1_790_000_000_000;
const row = (over: Record<string, unknown> = {}) => ({
  id: "owner:ABC", messageid: "ABC", fromMe: true, text: "Bom dia",
  messageTimestamp: Math.floor((T0 + 1_000) / 1000), status: "Pending", ...over,
});

function deps(over: Partial<ReconcileDeps> & { rows?: unknown[][] } = {}) {
  const calls = { find: 0, sleeps: [] as number[] };
  const pages = over.rows ?? [[]];
  const d: ReconcileDeps = {
    findRecent: over.findRecent ?? (() => Promise.resolve(pages[Math.min(calls.find++, pages.length - 1)])),
    existingIds: over.existingIds ?? (() => Promise.resolve(new Set<string>())),
    sleep: (ms) => { calls.sleeps.push(ms); return Promise.resolve(); },
    now: () => T0 + 15_000,
  };
  return { d, calls };
}

Deno.test("isAmbiguousSendFailure: timeout e 5xx sim; 4xx, 429 e breaker aberto nao", () => {
  assertEquals(isAmbiguousSendFailure({ status: 504, provider_code: "timeout" }), true);
  assertEquals(isAmbiguousSendFailure({ status: 500 }), true);
  assertEquals(isAmbiguousSendFailure({ status: 502, provider_code: "invalid_send_response" }), true);
  assertEquals(isAmbiguousSendFailure({ status: 429 }), false);
  assertEquals(isAmbiguousSendFailure({ status: 400 }), false);
  assertEquals(isAmbiguousSendFailure({ status: 422 }), false);
  assertEquals(isAmbiguousSendFailure({ status: 503, provider_code: "circuit_breaker_open" }), false);
  assertEquals(isAmbiguousSendFailure(new Error("boom")), false);
});

Deno.test("achou na 1a consulta: devolve o id real, uma so consulta", async () => {
  const { d, calls } = deps({ rows: [[row()]] });
  const out = await reconcileAmbiguousSend(d, { text: "Bom dia", sentAtMs: T0 });
  assertEquals(out.found?.messageId, "owner:ABC");
  assertEquals(out.attempts, 1);
  assertEquals(calls.find, 1);
});

Deno.test("achou so na 2a consulta (espacadas)", async () => {
  const { d, calls } = deps({ rows: [[], [row()]] });
  const out = await reconcileAmbiguousSend(d, { text: "Bom dia", sentAtMs: T0 });
  assertEquals(out.found?.messageId, "owner:ABC");
  assertEquals(out.attempts, 2);
  assertEquals(calls.sleeps, [2000, 3000]);
});

Deno.test("nao achou: found=null apos 2 consultas, nunca mais que isso", async () => {
  const { d, calls } = deps({ rows: [[row({ text: "outro texto" })]] });
  const out = await reconcileAmbiguousSend(d, { text: "Bom dia", sentAtMs: T0 });
  assertEquals(out.found, null);
  assertEquals(out.attempts, 2);
  assertEquals(calls.find, 2);
});

Deno.test("find lancando erro conta como desconhecido, nao propaga", async () => {
  const { d } = deps({ findRecent: () => Promise.reject({ status: 504, provider_code: "timeout" }) });
  const out = await reconcileAmbiguousSend(d, { text: "Bom dia", sentAtMs: T0 });
  assertEquals(out.found, null);
});

Deno.test("ignora: incoming, anterior ao envio, outra origem, id ja gravado, falha", async () => {
  const known = new Set(["owner:OLD"]);
  const { d } = deps({
    existingIds: () => Promise.resolve(known),
    rows: [[
      row({ id: "in", fromMe: false }),
      row({ id: "old-ts", messageTimestamp: Math.floor((T0 - 60_000) / 1000) }),
      row({ id: "auto", track_source: "pipe-rule-dispatch" }),
      row({ id: "owner:OLD" }),
      row({ id: "bad", status: "failed" }),
    ]],
  });
  const out = await reconcileAmbiguousSend(d, { text: "Bom dia", sentAtMs: T0 });
  assertEquals(out.found, null);
});

Deno.test("texto igual: casa por trim/CRLF e escolhe a mais antiga da janela", async () => {
  const { d } = deps({
    rows: [[
      row({ id: "late", text: " Bom dia\r\n", messageTimestamp: Math.floor((T0 + 9_000) / 1000) }),
      row({ id: "early", messageTimestamp: Math.floor((T0 + 1_000) / 1000) }),
    ]],
  });
  const out = await reconcileAmbiguousSend(d, { text: "Bom dia", sentAtMs: T0 });
  assertEquals(out.found?.messageId, "early");
});

Deno.test("parseRecentOutgoing aceita timestamp em ms e content.text", () => {
  const parsed = parseRecentOutgoing([{ messageid: "X", fromMe: true, content: { text: "oi" }, messageTimestamp: T0 }]);
  assertEquals(parsed, [{ messageId: "X", text: "oi", timestampMs: T0 }]);
});
