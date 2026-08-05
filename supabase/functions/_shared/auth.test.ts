/**
 * Testes de `timingSafeCompare` — a comparação usada por `requireCronAuth`,
 * `validateEvolutionWebhook`, `validateCalcomWebhook` e `validateWebhookApiKey`.
 *
 * Duas camadas, porque uma sozinha não segura o que importa:
 *
 *   1. COMPORTAMENTO. Igual/diferente/tamanhos diferentes/multibyte/vazio.
 *      Pega quebra funcional — não pega troca por `===`, que responde igual.
 *
 *   2. GUARDA DE FONTE. Uma implementação com `a === b` passaria por TODA
 *      asserção de comportamento e mesmo assim seria a regressão de segurança
 *      que este arquivo existe para impedir: `===` em V8 sai no primeiro byte
 *      diferente, e esse tempo é o vazamento. Medir tempo em JS é instável
 *      (GC, JIT, escalonador) e um teste instável acaba desligado; então a
 *      camada 2 lê o fonte e exige a delegação a uma primitiva de tempo
 *      constante. Mesmo desenho de `scripts/test-voip-choke.sh`.
 */

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import { getClientIdentifier, timingSafeCompare } from "./auth.ts";

// ─── 1. Comportamento ────────────────────────────────────────────────────────

Deno.test("timingSafeCompare — strings idênticas casam", () => {
  assert(timingSafeCompare("tq_live_abc123", "tq_live_abc123"));
});

Deno.test("timingSafeCompare — diferença no PRIMEIRO byte não casa", () => {
  assertFalse(timingSafeCompare("Xq_live_abc123", "tq_live_abc123"));
});

Deno.test("timingSafeCompare — diferença no ÚLTIMO byte não casa", () => {
  assertFalse(timingSafeCompare("tq_live_abc123", "tq_live_abc12X"));
});

Deno.test("timingSafeCompare — comprimentos diferentes não casam", () => {
  assertFalse(timingSafeCompare("segredo", "segredo-mais-longo"));
  assertFalse(timingSafeCompare("segredo-mais-longo", "segredo"));
});

Deno.test("timingSafeCompare — vazio casa com vazio", () => {
  assert(timingSafeCompare("", ""));
});

Deno.test("timingSafeCompare — vazio não casa com não-vazio", () => {
  assertFalse(timingSafeCompare("", "x"));
  assertFalse(timingSafeCompare("x", ""));
});

Deno.test("timingSafeCompare — multibyte compara por BYTE, não por code point", () => {
  // "ção" e "çao" têm o mesmo nº de caracteres e nº de bytes diferente:
  // o caminho de tamanho e o de conteúdo têm de continuar corretos em UTF-8.
  assert(timingSafeCompare("segredo-ção", "segredo-ção"));
  assertFalse(timingSafeCompare("segredo-ção", "segredo-cao"));
  assert(timingSafeCompare("🔐🔐", "🔐🔐"));
  assertFalse(timingSafeCompare("🔐🔐", "🔐🔓"));
});

// ─── 2. Guarda de fonte ──────────────────────────────────────────────────────

const AUTH_SOURCE = Deno.readTextFileSync(new URL("./auth.ts", import.meta.url));

/** Corpo de `timingSafeCompare`, sem comentários — o comentário EXPLICA o
 * mecanismo e um casador ingênuo acusaria a própria explicação. */
function timingSafeCompareBody(): string {
  const start = AUTH_SOURCE.indexOf("export function timingSafeCompare");
  assert(start >= 0, "timingSafeCompare sumiu de _shared/auth.ts");
  const end = AUTH_SOURCE.indexOf("\n}", start);
  assert(end > start, "não consegui delimitar o corpo de timingSafeCompare");
  return AUTH_SOURCE.slice(start, end)
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

Deno.test("timingSafeCompare — delega a uma primitiva de tempo constante", () => {
  const body = timingSafeCompareBody();
  assert(
    /timingSafeEqual\s*\(/.test(body),
    "o corpo não chama timingSafeEqual — a comparação precisa vir de uma " +
      "primitiva de tempo constante, não de uma comparação de conveniência",
  );
});

Deno.test("timingSafeCompare — não compara os dois segredos com ===", () => {
  const body = timingSafeCompareBody();
  assertFalse(
    /\b([ab])\s*[!=]==?\s*([ab])\b/.test(body),
    "comparar os parâmetros diretamente (a === b) sai no primeiro byte " +
      "diferente: esse tempo É o vazamento que a função existe para evitar",
  );
});

Deno.test("timingSafeCompare — importa a primitiva, não a reimplementa por acidente", () => {
  assert(
    /import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from/.test(AUTH_SOURCE),
    "timingSafeEqual tem de ser importado de um módulo real do runtime — " +
      "`crypto.subtle.timingSafeEqual` não existe neste Deno (medido: undefined)",
  );
});

// ─── getClientIdentifier ─────────────────────────────────────────────────────
// Coberto aqui porque a duplicação dele em torquecalls-webhook nasceu dos erros
// de tipo deste arquivo. Com auth.ts compilando, importar volta a ser possível.

Deno.test("getClientIdentifier — cf-connecting-ip vence os demais", () => {
  const req = new Request("http://t.invalid", {
    headers: {
      "cf-connecting-ip": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    },
  });
  assertEquals(getClientIdentifier(req), "1.1.1.1");
});

Deno.test("getClientIdentifier — cai para o primeiro do x-forwarded-for", () => {
  const req = new Request("http://t.invalid", {
    headers: { "x-forwarded-for": " 3.3.3.3 , 4.4.4.4" },
  });
  assertEquals(getClientIdentifier(req), "3.3.3.3");
});

Deno.test("getClientIdentifier — sem cabeçalho nenhum devolve 'unknown'", () => {
  assertEquals(getClientIdentifier(new Request("http://t.invalid")), "unknown");
});
