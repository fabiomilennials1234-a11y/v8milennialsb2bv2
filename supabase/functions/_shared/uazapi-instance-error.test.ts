import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  INSTANCE_DISCONNECTED,
  isInstanceDisconnected,
  uazapiErrorText,
} from "./uazapi-instance-error.ts";
import { providerRefusal } from "./provider-error-status.ts";
import { UazapiClient } from "./uazapi-client.ts";

// Corpo real do 503, capturado em prod (instância deslogada, 24/11/2026).
const PROD_503 = { error: true, message: "WhatsApp disconnected: session is not reconnectable" };

Deno.test("uazapiErrorText: pula o `error: true` e devolve a razão de `message`", () => {
  assertEquals(uazapiErrorText(PROD_503), "WhatsApp disconnected: session is not reconnectable");
  assertEquals(uazapiErrorText({ error: "the number 55@s.whatsapp.net is not on WhatsApp" }), "the number 55@s.whatsapp.net is not on WhatsApp");
  assertEquals(uazapiErrorText({ error: true }), null);
  assertEquals(uazapiErrorText("true"), null);
});

Deno.test("isInstanceDisconnected: o corpo de prod sim; destinatário e erro genérico não", () => {
  assertEquals(isInstanceDisconnected(PROD_503), true);
  assertEquals(isInstanceDisconnected({ message: "instance is not connected" }), true);
  assertEquals(isInstanceDisconnected({ error: "the number 5585@s.whatsapp.net is not on WhatsApp" }), false);
  assertEquals(isInstanceDisconnected({ error: "internal server error" }), false);
  assertEquals(isInstanceDisconnected({ error: true }), false);
  assertEquals(isInstanceDisconnected(null), false);
});

Deno.test("providerRefusal: desconectado e breaker viram 409 com texto acionável; o resto não", () => {
  const off = providerRefusal({ status: 503, provider_code: INSTANCE_DISCONNECTED });
  assertEquals(off?.status, 409);
  assertEquals(off?.code, INSTANCE_DISCONNECTED);
  assertEquals(off?.message.includes("não foi enviada"), true);
  const breaker = providerRefusal({ status: 503, provider_code: "circuit_breaker_open" });
  assertEquals(breaker?.status, 409);
  assertEquals(breaker?.code, "circuit_breaker_open");
  assertEquals(providerRefusal({ status: 500 }), null);
  assertEquals(providerRefusal({ status: 504, provider_code: "timeout" }), null);
  assertEquals(providerRefusal(new Error("boom")), null);
});

function stubFetch(status: number, body: unknown) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function caught(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try { await p; } catch (e) { return e as Record<string, unknown>; }
  throw new Error("expected rejection");
}

Deno.test("REGRESSÃO Carol: 503 de número deslogado = 1 chamada, código estável, razão real, sem breaker", async () => {
  const f = stubFetch(503, PROD_503);
  try {
    // Token único: o breaker é por credencial e module-level.
    const client = new UazapiClient({ baseUrl: "https://uaz.test", token: `tok-${crypto.randomUUID()}` });

    // GET é replay-safe: antes fazia 3 tentativas com backoff (~3,5 s) e somava no breaker.
    const err = await caught(client.getMessageLimits());
    assertEquals(f.calls.length, 1);
    assertEquals(err.provider_code, INSTANCE_DISCONNECTED);
    assertEquals(err.status, 503);
    assertEquals(
      err.message,
      "Uazapi server error 503 on GET /instance/wa_messages_limits: WhatsApp disconnected: session is not reconnectable",
    );

    // Envio: mesmo código; e mais 3 recusas não abrem o breaker (que esconderia a razão real).
    for (let i = 0; i < 3; i++) {
      const send = await caught(client.sendText({ number: "5585999990000", text: "Olá" }));
      assertEquals(send.provider_code, INSTANCE_DISCONNECTED);
    }
    assertEquals(f.calls.length, 4);
  } finally {
    f.restore();
  }
});
