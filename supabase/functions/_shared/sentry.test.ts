/**
 * Sentry das edge functions (ADR-0038, S6) — o que sai e o que não sai.
 */
import { assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import { captureUnhandled, type EdgeEvent, prepareEdgeEvent, scrubPii, scrubText, stripQuery } from "./sentry.ts";

Deno.test("scrubPii: telefone, e-mail, CPF e CNPJ mascarados; UUID e JID preservados", () => {
  assertEquals(scrubPii("tel 5511987654321"), "tel 5511*****4321");
  assertEquals(scrubPii("joao@empresa.com.br"), "j***@empresa.com.br");
  assertEquals(scrubPii("5511987654321@s.whatsapp.net"), "5511*****4321@s.whatsapp.net");
  assertEquals(scrubPii("123.456.789-01 e 12.345.678/0001-90"), "***.***.***-01 e **.***.***/****-90");
  assertEquals(
    scrubPii("lead 550e8400-e29b-41d4-a716-446655440000"),
    "lead 550e8400-e29b-41d4-a716-446655440000",
  );
});

Deno.test("stripQuery corta query e fragmento", () => {
  assertEquals(stripQuery("https://x/functions/v1/fn?phone=5511987654321#t"), "https://x/functions/v1/fn");
});

Deno.test("scrubText: o erro de fetch do Deno traz a URL inteira — o token da query não sai", () => {
  assertEquals(
    scrubText("error sending request for url (https://graph.facebook.com/v19.0/me?access_token=EAAG123): timed out"),
    "error sending request for url (https://graph.facebook.com/v19.0/me): timed out",
  );
});

Deno.test("prepareEdgeEvent: exceção mascarada, request só com o método (URL de webhook tem segredo no path), user só com id, sem extra", () => {
  const raw = {
    message: "falhou para joao@empresa.com.br",
    exception: { values: [{ type: "Error", value: "duplicate key 5511987654321" }] },
    request: { url: "https://x/functions/v1/whatsapp-webhook/s3cr3t", method: "POST", headers: { authorization: "Bearer x" }, data: "{}" },
    user: { id: "u-1", email: "a@b.com", ip_address: "1.2.3.4" },
    extra: { payload: { phone: "5511987654321" } },
    server_name: "edge-host-123",
  };
  const event: EdgeEvent = prepareEdgeEvent<EdgeEvent>(raw);
  assertEquals(event.message, "falhou para j***@empresa.com.br");
  assertEquals(event.exception?.values?.[0].value, "duplicate key 5511*****4321");
  assertEquals(event.request, { method: "POST" });
  assertEquals(event.user, { id: "u-1" });
  assertFalse("extra" in event);
  assertFalse("server_name" in event);
});

Deno.test("sem SENTRY_DSN_EDGE não carrega o SDK nem lança", async () => {
  const previous = Deno.env.get("SENTRY_DSN_EDGE");
  Deno.env.delete("SENTRY_DSN_EDGE");
  try {
    await captureUnhandled(new Error("boom"), {
      functionName: "teste",
      requestId: "r-1",
      method: "POST",
    });
  } finally {
    if (previous !== undefined) Deno.env.set("SENTRY_DSN_EDGE", previous);
  }
});
