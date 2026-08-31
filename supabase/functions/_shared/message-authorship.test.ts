import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { authorFromWebhookEcho, readAuthorFromPayload, resolveAuthor } from "./message-authorship.ts";

Deno.test("resolveAuthor — envio humano pela caixa de entrada carrega o Team Member que enviou", () => {
  const author = resolveAuthor({
    actor: { teamMemberId: "tm-vendedora-ana" },
    sentSource: "manual",
  });

  assertEquals(author, "tm-vendedora-ana");
});

Deno.test("resolveAuthor — envio de robô não ganha autor, mesmo disparado dentro da sessão de um humano", () => {
  const actor = { teamMemberId: "tm-vendedora-ana" };

  assertEquals(resolveAuthor({ actor, sentSource: "copilot" }), null);
  assertEquals(resolveAuthor({ actor, sentSource: "workflow" }), null);
  assertEquals(resolveAuthor({ actor, sentSource: "mass_send" }), null);
});

Deno.test("resolveAuthor — ator sem Team Member na org alvo (Master, Gestor de Portfólio) fica sem autor", () => {
  assertEquals(resolveAuthor({ actor: null, sentSource: "manual" }), null);
  assertEquals(resolveAuthor({ actor: { teamMemberId: "" }, sentSource: "manual" }), null);
});

Deno.test("readAuthorFromPayload — o autor volta do provedor no eco do track_id", () => {
  const autor = readAuthorFromPayload(
    { track_source: "whatsapp-api-proxy", track_id: "3f1b8c2e-0000-4000-8000-000000000001" },
    "manual",
  );

  assertEquals(autor, "3f1b8c2e-0000-4000-8000-000000000001");
});

Deno.test("readAuthorFromPayload — eco vazio, ausente ou não-UUID não vira autor", () => {
  assertEquals(readAuthorFromPayload({ track_source: "whatsapp-api-proxy", track_id: "" }, "manual"), null);
  assertEquals(readAuthorFromPayload({}, "manual"), null);
  assertEquals(readAuthorFromPayload(null, "manual"), null);
  assertEquals(readAuthorFromPayload({ track_id: "campanha-black-friday" }, "manual"), null);
});

Deno.test("readAuthorFromPayload — mensagem de robô não ganha autor nem com track_id válido", () => {
  const payload = { track_id: "3f1b8c2e-0000-4000-8000-000000000001" };

  assertEquals(readAuthorFromPayload(payload, "copilot"), null);
  assertEquals(readAuthorFromPayload(payload, "workflow"), null);
  assertEquals(readAuthorFromPayload(payload, "mass_send"), null);
});

Deno.test("authorFromWebhookEcho — envio humano do CRM vira autor; disparo de workflow com o mesmo eco, não", () => {
  const tm = "3f1b8c2e-0000-4000-8000-000000000001";

  assertEquals(
    authorFromWebhookEcho({ track_source: "whatsapp-api-proxy", track_id: tm }, "outgoing", "inst-1"),
    tm,
  );
  assertEquals(
    authorFromWebhookEcho({ track_source: "workflow-action", track_id: tm }, "outgoing", "inst-1"),
    null,
  );
  assertEquals(
    authorFromWebhookEcho({ track_source: "whatsapp-api-proxy", track_id: tm }, "incoming", "inst-1"),
    null,
  );
});
