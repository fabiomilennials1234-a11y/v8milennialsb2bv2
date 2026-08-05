/**
 * Testes da forma discável do destino.
 *
 * O primeiro bloco mede a TRANSFORMAÇÃO com os números reais que falharam em
 * produção. São os casos que provam o conserto — se algum deles voltar a sair
 * sem o `55`, a chamada volta a ser oferecida a um número de outro país.
 *
 * O segundo bloco guarda o lado oposto, que é onde uma correção apressada
 * costuma quebrar: número que JÁ está certo não pode ser alterado.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toDialDigits } from "./peer-phone.ts";

// ─── os casos medidos em produção ───────────────────────────────────────────

// Lead "Marcelo Montemezzo". O CRM mandava `51985960716`; a VPS perguntava ao
// WhatsApp por `+51985960716` — Peru — e recebia "number is not on WhatsApp".
// Registrado duas vezes em `voip_calls.end_reason` em 2026-08-03.
Deno.test("51985960716 (o caso que quebrou) ganha o DDI e deixa de ser peruano", () => {
  assertEquals(toDialDigits("51985960716"), "5551985960716");
});

// Lead "isabelly". CRM manda `48996458738`, JID real `554896458738`. Mesmo
// padrão: faltava o 55 e o `+48` aponta para a Polônia.
Deno.test("48996458738 (o segundo caso) ganha o DDI e deixa de ser polonês", () => {
  assertEquals(toDialDigits("48996458738"), "5548996458738");
});

// O terceiro caso obrigatório: um número que JÁ vem com DDI não pode ser
// alterado. 13 dígitos = 55 + DDD + 9 + 8.
Deno.test("5551985960716 já tem DDI e sai intocado (nunca 555551985960716)", () => {
  assertEquals(toDialDigits("5551985960716"), "5551985960716");
});

// ─── o JID real, que é a forma de 12 dígitos ────────────────────────────────

// `555185960716` é o JID que o WhatsApp devolveu para o Marcelo — 55 + DDD +
// oito dígitos, sem o nono. Chega assim nas chamadas de ENTRADA, pelo webhook
// da VPS. Repor DDI aqui produziria `55555185960716`.
Deno.test("555185960716 (JID real, 12 dígitos) sai intocado", () => {
  assertEquals(toDialDigits("555185960716"), "555185960716");
});

Deno.test("554896458738 (JID real da isabelly) sai intocado", () => {
  assertEquals(toDialDigits("554896458738"), "554896458738");
});

// ─── o DDD que colide com o próprio DDI ─────────────────────────────────────

// Santa Maria/RS é DDD 55. `55999887766` tem 11 dígitos e COMEÇA com "55" sem
// ter DDI nenhum. Uma regra que decidisse por prefixo — a de
// `normalizeBrazilianPhone`, em `_shared/whatsapp-dispatch.ts` — deixaria este
// número sem DDI e ofereceria a chamada para `+55 9998-87766`.
// Produção tem 726 leads exatamente nesta forma.
Deno.test("DDD 55 (Santa Maria) ganha o DDI mesmo começando com 55", () => {
  assertEquals(toDialDigits("55999887766"), "5555999887766");
});

// E a forma dele já internacionalizada, 13 dígitos, continua intocada.
Deno.test("DDD 55 já com DDI (13 dígitos) sai intocado", () => {
  assertEquals(toDialDigits("5555999887766"), "5555999887766");
});

// ─── fixo e celular pré-nono-dígito ─────────────────────────────────────────

// 10 dígitos = DDD + 8. É a forma que o WhatsApp guarda no JID sem o DDI.
Deno.test("10 dígitos (DDD + 8) ganham o DDI", () => {
  assertEquals(toDialDigits("5185960716"), "555185960716");
});

// ─── máscara e lixo ─────────────────────────────────────────────────────────

Deno.test("máscara humana é descartada antes de decidir", () => {
  assertEquals(toDialDigits("(51) 98596-0716"), "5551985960716");
  assertEquals(toDialDigits("+55 51 98596-0716"), "5551985960716");
  assertEquals(toDialDigits("51 985960716"), "5551985960716");
});

// Fora da faixa doméstica não há o que presumir. Sai como entrou — e o gate de
// 8..15 dígitos em `authorizeCallAndMint` decide se serve para discar.
Deno.test("comprimento fora de 10/11 sai intocado", () => {
  assertEquals(toDialDigits(""), "");
  assertEquals(toDialDigits(null), "");
  assertEquals(toDialDigits(undefined), "");
  assertEquals(toDialDigits("abc"), "");
  assertEquals(toDialDigits("985960716"), "985960716"); // 9 — sem DDD
  assertEquals(toDialDigits("123456789012345"), "123456789012345"); // 15 — teto
});

// A função é idempotente por construção: aplicar duas vezes não empilha DDI.
// Vale como guarda porque o `peer` passa por caminhos que podem se cruzar
// (autorizar, renovar credencial, atender).
Deno.test("aplicar duas vezes não empilha DDI", () => {
  const uma = toDialDigits("51985960716");
  assertEquals(toDialDigits(uma), uma);
});
