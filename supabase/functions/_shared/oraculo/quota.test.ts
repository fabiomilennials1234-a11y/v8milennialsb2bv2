import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { checkQuota } from "./quota.ts";

Deno.test("checkQuota — 25 conversas por dia por usuário, contadas em turnos do usuário", () => {
  const q = checkQuota({ turnsToday: 24, orgLimit: null });

  assertEquals(q.allowed, true);
  assertEquals(q.limit, 25);
  assertEquals(q.remaining, 1);
});

Deno.test("checkQuota — organização ajusta o teto sem deploy", () => {
  assertEquals(checkQuota({ turnsToday: 40, orgLimit: 100 }), {
    allowed: true,
    limit: 100,
    remaining: 60,
  });
});

Deno.test("checkQuota — no teto, recusa e não devolve saldo negativo", () => {
  assertEquals(checkQuota({ turnsToday: 30, orgLimit: 25 }), {
    allowed: false,
    limit: 25,
    remaining: 0,
  });
});
