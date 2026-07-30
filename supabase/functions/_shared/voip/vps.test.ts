/**
 * `callVps` é o único ponto que lê o corpo HTTP cru da VPS e o converte em
 * `VpsResult`. `control_gate.test.ts` injeta `VpsResult` já pronto via
 * `fakeVoipDeps` — o que prova que `forwardSessionAction`/`createSession`
 * REPASSAM um `code` que já chegou, mas não prova que `callVps` de fato o
 * EXTRAI do corpo JSON de verdade. Sem este arquivo a fronteira real —
 * "o que a VPS manda pela rede" — nunca era exercitada.
 */
import { assertEquals } from "@std/assert";
import { callVps } from "./vps.ts";

function withFakeFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("callVps: repassa code quando o corpo de erro da VPS tem um", async () => {
  Deno.env.set("TORQUECALLS_VPS_URL", "https://vps.example.test");
  const res = await withFakeFetch(
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: "device already has 4 linked devices", code: "device_limit_reached" }),
          { status: 409 },
        ),
      ),
    () => callVps("POST", "/api/sessions/tc-1/pair", { token: "t" }),
  );

  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.status, 409);
    assertEquals(res.code, "device_limit_reached");
    assertEquals(res.error, "device already has 4 linked devices");
  }
});

Deno.test("callVps: corpo de erro sem code não inventa um", async () => {
  Deno.env.set("TORQUECALLS_VPS_URL", "https://vps.example.test");
  const res = await withFakeFetch(
    () => Promise.resolve(new Response(JSON.stringify({ error: "falha genérica" }), { status: 500 })),
    () => callVps("POST", "/api/sessions/tc-1/pair", { token: "t" }),
  );

  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.code, undefined);
    assertEquals(res.error, "falha genérica");
  }
});

Deno.test("callVps: sucesso continua sem campo code (só o ramo de erro carrega)", async () => {
  Deno.env.set("TORQUECALLS_VPS_URL", "https://vps.example.test");
  const res = await withFakeFetch(
    () => Promise.resolve(new Response(JSON.stringify({ session: { id: "tc-1" } }), { status: 200 })),
    () => callVps("POST", "/api/sessions", { token: "t" }),
  );

  assertEquals(res.ok, true);
  if (res.ok) assertEquals((res.data as { session: { id: string } }).session.id, "tc-1");
});
