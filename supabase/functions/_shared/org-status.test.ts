/**
 * Testes de `isOrgBlocked` — o gate de assinatura que o backend usa.
 *
 * O que importa aqui, em ordem de risco:
 *   1. Org bloqueada tem de dar `true` (senão a suspensão não corta o motor).
 *   2. Erro de banco tem de dar `false` — FAIL-OPEN deliberado. Se isto virar
 *      fail-closed, um blip de banco cala o WhatsApp de toda a base.
 *   3. A regra NÃO pode ser reimplementada em TS: o módulo tem que perguntar
 *      para a RPC `org_access_blocked`, que é a mesma fonte das policies.
 */

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import { isOrgBlocked, __resetOrgStatusCache } from "./org-status.ts";

const ORG = "11111111-1111-1111-1111-111111111111";

function fakeSupabase(impl: (fn: string, args: unknown) => { data?: unknown; error?: unknown }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    rpc(fn: string, args: any) {
      calls.push({ fn, args });
      return Promise.resolve(impl(fn, args));
    },
  };
}

Deno.test("org bloqueada → true", async () => {
  __resetOrgStatusCache();
  const sb = fakeSupabase(() => ({ data: true }));
  assert(await isOrgBlocked(sb, ORG));
  assertEquals(sb.calls[0].fn, "org_access_blocked");
  assertEquals(sb.calls[0].args, { p_org_id: ORG });
});

Deno.test("org ativa → false", async () => {
  __resetOrgStatusCache();
  const sb = fakeSupabase(() => ({ data: false }));
  assertFalse(await isOrgBlocked(sb, ORG));
});

Deno.test("org ausente → false, sem ida ao banco", async () => {
  __resetOrgStatusCache();
  const sb = fakeSupabase(() => ({ data: true }));
  assertFalse(await isOrgBlocked(sb, null));
  assertFalse(await isOrgBlocked(sb, undefined));
  assertFalse(await isOrgBlocked(sb, ""));
  assertEquals(sb.calls.length, 0);
});

Deno.test("erro de banco → FAIL-OPEN (false), nunca bloqueia por acidente", async () => {
  __resetOrgStatusCache();
  const sb = fakeSupabase(() => ({ error: { message: "connection reset" } }));
  assertFalse(await isOrgBlocked(sb, ORG));
});

Deno.test("exceção crua → FAIL-OPEN (false)", async () => {
  __resetOrgStatusCache();
  const sb = {
    rpc() {
      throw new Error("boom");
    },
  };
  assertFalse(await isOrgBlocked(sb, ORG));
});

Deno.test("resultado é cacheado — segunda chamada não consulta de novo", async () => {
  __resetOrgStatusCache();
  const sb = fakeSupabase(() => ({ data: true }));
  assert(await isOrgBlocked(sb, ORG));
  assert(await isOrgBlocked(sb, ORG));
  assertEquals(sb.calls.length, 1);
});

Deno.test("cache é por org — org diferente consulta de novo", async () => {
  __resetOrgStatusCache();
  const outra = "22222222-2222-2222-2222-222222222222";
  const sb = fakeSupabase((_fn, args) => ({
    data: (args as { p_org_id: string }).p_org_id === ORG,
  }));
  assert(await isOrgBlocked(sb, ORG));
  assertFalse(await isOrgBlocked(sb, outra));
  assertEquals(sb.calls.length, 2);
});

// ─── Guarda de fonte ─────────────────────────────────────────────────────────
// A regra "suspended/cancelled/expired AND NOT billing_override" mora no banco.
// Reimplementá-la aqui em TS cria duas verdades que divergem em silêncio: a tela
// bloqueia e o motor continua enviando, ou o contrário. Este teste falha se
// alguém trocar a RPC por uma consulta direta às colunas.
Deno.test("guarda de fonte — usa a RPC, não relê as colunas em TS", async () => {
  const src = await Deno.readTextFile(new URL("./org-status.ts", import.meta.url));
  assert(
    src.includes('rpc("org_access_blocked"'),
    "isOrgBlocked deve chamar a RPC org_access_blocked",
  );
  assertFalse(
    /subscription_status\s*[!=]==?/.test(src) || src.includes('from("organizations")'),
    "a regra de bloqueio não pode ser reimplementada em TS — ela mora na RPC",
  );
});
