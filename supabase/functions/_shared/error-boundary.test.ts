/**
 * withErrorBoundary — o que o cliente recebe quando a função quebra (ADR-0038, S5).
 */
import { assert, assertEquals, assertFalse, assertMatch } from "jsr:@std/assert@^1.0.0";
import { UNHANDLED_ERROR_MESSAGE, withErrorBoundary } from "./error-boundary.ts";

// logError escreve no console; o teste não precisa desse ruído.
const silence = () => {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
};

Deno.test("500 leva frase PT, código do contrato e request_id — nunca a mensagem técnica", async () => {
  const restore = silence();
  try {
    const handler = withErrorBoundary("teste", () => {
      throw new TypeError("Cannot read properties of undefined (reading 'map')");
    });
    const res = await handler(new Request("https://x.test/fn", { method: "POST", headers: { origin: "https://torquecrm.com.br" } }));
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, UNHANDLED_ERROR_MESSAGE);
    assertEquals(body.code, "server.unavailable");
    assertMatch(body.request_id, /^[0-9a-f-]{36}$/);
    assertFalse(JSON.stringify(body).includes("Cannot read properties"));
    assertEquals(res.headers.get("X-Request-ID"), body.request_id);
  } finally {
    restore();
  }
});

Deno.test("mantém CORS no 500 — sem ele o navegador reporta falha de CORS e esconde o erro", async () => {
  const restore = silence();
  try {
    const handler = withErrorBoundary("teste", () => Promise.reject(new Error("boom")));
    const res = await handler(new Request("https://x.test/fn", { headers: { origin: "https://torquecrm.com.br" } }));
    assert(res.headers.get("Access-Control-Allow-Origin"), "sem Access-Control-Allow-Origin");
  } finally {
    restore();
  }
});

Deno.test("reusa o request_id que o front mandou, para casar com o toast e o runtime_logs", async () => {
  const restore = silence();
  try {
    const requestId = "3f2a0c1e-9b7d-4c2a-8f11-2b6e5d4c3a10";
    const handler = withErrorBoundary("teste", () => {
      throw new Error("boom");
    });
    const res = await handler(new Request("https://x.test/fn", { headers: { "x-torque-request-id": requestId } }));
    assertEquals((await res.json()).request_id, requestId);
  } finally {
    restore();
  }
});

Deno.test("sem erro, a resposta passa intacta", async () => {
  const handler = withErrorBoundary("teste", () => new Response("ok", { status: 201 }));
  const res = await handler(new Request("https://x.test/fn"));
  assertEquals(res.status, 201);
  assertEquals(await res.text(), "ok");
});
