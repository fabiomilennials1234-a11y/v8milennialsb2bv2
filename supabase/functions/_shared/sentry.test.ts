/**
 * Sentry das edge functions (ADR-0038, S6) — o que sai e o que não sai.
 */
import { assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import { captureUnhandled, type EdgeEvent, prepareEdgeEvent } from "./sentry.ts";

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
