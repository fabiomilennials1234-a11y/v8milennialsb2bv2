/**
 * Encaminhar mensagem (v1): teto de destinos, o que é encaminhável e o ritmo
 * entre envios. O envio manual NÃO passa pelo ritmo do send governor (a regra 1
 * isenta `manual`), então o teto e o espaçamento são desta ação.
 */
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  FORWARD_GAP_MAX_MS,
  FORWARD_GAP_MIN_MS,
  FORWARD_MAX_TARGETS,
  ForwardSkippedError,
  type ForwardPlan,
  isWhatsAppCdnUrl,
  parseForwardRequest,
  planForward,
  runForward,
} from "./forward-message.ts";

const ID = "7b8f1d62-5c0a-4a5e-9d3c-2f1e8a9b0c11";

Deno.test("parse: aceita 1 a 5 destinos, normaliza e remove duplicados", () => {
  const r = parseForwardRequest({
    source_message_id: ID,
    targets: ["+55 (11) 91234-5678", "5511912345678", "5511987654321@s.whatsapp.net", "120363025246125486@g.us"],
  });
  assert(r.ok);
  assertEquals(r.targets, ["5511912345678", "5511987654321", "120363025246125486@g.us"]);
  assertEquals(r.messageId, ID);
});

Deno.test("parse: mais de 5 destinos é recusado inteiro, nunca truncado", () => {
  const targets = Array.from({ length: FORWARD_MAX_TARGETS + 1 }, (_, i) => `55119${String(10000000 + i)}`);
  const r = parseForwardRequest({ source_message_id: ID, targets });
  assertEquals(r, { ok: false, error: "too_many_targets" });
});

Deno.test("parse: duplicados contam uma vez só para o teto", () => {
  const r = parseForwardRequest({ source_message_id: ID, targets: Array(9).fill("5511912345678") });
  assert(r.ok);
  assertEquals(r.targets.length, 1);
});

Deno.test("parse: sem destino, id inválido e número curto", () => {
  assertEquals(parseForwardRequest({ source_message_id: ID, targets: [] }), { ok: false, error: "no_targets" });
  assertEquals(parseForwardRequest({ source_message_id: "x", targets: ["5511912345678"] }), { ok: false, error: "invalid_request" });
  assertEquals(parseForwardRequest({ source_message_id: ID, targets: ["55"] }), { ok: false, error: "invalid_number" });
  assertEquals(parseForwardRequest(null), { ok: false, error: "invalid_request" });
  assertEquals(parseForwardRequest({ source_message_id: ID, targets: "5511912345678" }), { ok: false, error: "invalid_request" });
});

Deno.test("plan: texto e conversation viram texto; legenda de mídia vira caption", () => {
  assertEquals(planForward({ message_type: "text", content: "oi" }), { ok: true, plan: { kind: "text", text: "oi" } });
  assertEquals(planForward({ message_type: "conversation", content: "oi" }), { ok: true, plan: { kind: "text", text: "oi" } });
  const img = planForward({ message_type: "image", content: "legenda", media_url: "https://x.supabase.co/storage/v1/object/public/media/a.jpg" });
  assertEquals(img, {
    ok: true,
    plan: { kind: "media", type: "image", file: "https://x.supabase.co/storage/v1/object/public/media/a.jpg", caption: "legenda" },
  });
});

Deno.test("plan: documento leva o nome original; ptt continua ptt", () => {
  const doc = planForward({
    message_type: "document",
    media_url: "https://x.supabase.co/storage/v1/object/public/media/h.pdf",
    media_file_name: "Pedido 03.pdf",
  });
  assertEquals((doc as { plan: ForwardPlan }).plan, {
    kind: "media",
    type: "document",
    file: "https://x.supabase.co/storage/v1/object/public/media/h.pdf",
    filename: "Pedido 03.pdf",
  });
  const ptt = planForward({ message_type: "ptt", media_url: "https://x.supabase.co/storage/v1/object/public/media/a.ogg" });
  assertEquals((ptt as { plan: ForwardPlan }).plan.kind === "media" && (ptt as { plan: { type: string } }).plan.type, "ptt");
});

Deno.test("plan: mídia sem arquivo utilizável é media_unavailable (link da CDN, expirada, ausente)", () => {
  const cdn = "https://mmg.whatsapp.net/v/t62.7118-24/1_n.enc?ccb=11-4";
  assertEquals(planForward({ message_type: "image", media_url: cdn }), { ok: false, error: "media_unavailable" });
  assertEquals(planForward({ message_type: "image", media_url: null }), { ok: false, error: "media_unavailable" });
  assertEquals(
    planForward({ message_type: "image", media_url: "https://x.supabase.co/a.jpg", media_expired: true }),
    { ok: false, error: "media_unavailable" },
  );
});

Deno.test("plan: apagada, vazia e tipos fora da v1 não são encaminháveis", () => {
  assertEquals(planForward({ message_type: "text", content: "oi", deleted_at: "2026-10-08T10:00:00Z" }), { ok: false, error: "not_forwardable" });
  assertEquals(planForward({ message_type: "text", content: "   " }), { ok: false, error: "not_forwardable" });
  for (const t of ["contact", "location", "interactive", "button", "buttons_response", "list_response", "reaction", "poll"]) {
    assertEquals(planForward({ message_type: t, content: "x" }), { ok: false, error: "not_forwardable" }, t);
  }
});

Deno.test("cdn: só subdomínio de whatsapp.net/.com, por hostname", () => {
  assert(isWhatsAppCdnUrl("https://mmg.whatsapp.net/x"));
  assert(!isWhatsAppCdnUrl("https://evil.com/?x=.whatsapp.net/"));
  assert(!isWhatsAppCdnUrl("https://whatsapp.net.evil.com/x"));
  assert(!isWhatsAppCdnUrl("nao e url"));
});

Deno.test("run: envia em ordem, espaça os envios e relata cada destino", async () => {
  const sent: string[] = [];
  const gaps: number[] = [];
  const results = await runForward(
    { kind: "text", text: "oi" },
    ["5511911111111", "5511922222222", "5511933333333"],
    (number) => {
      sent.push(number);
      return Promise.resolve();
    },
    { sleep: (ms) => { gaps.push(ms); return Promise.resolve(); }, random: () => 0.5 },
  );
  assertEquals(sent, ["5511911111111", "5511922222222", "5511933333333"]);
  assertEquals(results.map((r) => r.ok), [true, true, true]);
  // 3 destinos = 2 pausas, nenhuma antes do primeiro nem depois do último.
  assertEquals(gaps.length, 2);
  for (const g of gaps) assert(g >= FORWARD_GAP_MIN_MS && g <= FORWARD_GAP_MAX_MS);
});

Deno.test("run: um destino que falha não derruba os outros e o erro é sanitizado", async () => {
  const results = await runForward(
    { kind: "text", text: "oi" },
    ["5511911111111", "5511922222222"],
    (number) => number === "5511911111111" ? Promise.reject(new Error("463 token=abc123 secret stack")) : Promise.resolve(),
    { sleep: () => Promise.resolve(), random: () => 0 },
  );
  assertEquals(results[0].ok, false);
  assertEquals(results[0].error, "send_failed");
  assertEquals(results[1].ok, true);
  assert(!JSON.stringify(results).includes("abc123"));
});

Deno.test("run: envio segurado pelo governor vira 'skipped', não 'send_failed'", async () => {
  const results = await runForward(
    { kind: "text", text: "oi" },
    ["5511911111111"],
    () => Promise.reject(new ForwardSkippedError()),
    { sleep: () => Promise.resolve(), random: () => 0 },
  );
  assertEquals(results, [{ number: "5511911111111", ok: false, error: "skipped" }]);
});
