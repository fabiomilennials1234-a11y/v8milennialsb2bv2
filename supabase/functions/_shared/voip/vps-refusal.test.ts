/**
 * Testes da tradução de recusa da VPS em código do CRM (issue #1365).
 *
 * O teste que importa é o primeiro: a resposta LITERAL que produção devolveu em
 * 2026-08-03 tem que deixar de virar `vps_refused`. Enquanto virar, o vendedor
 * lê "o serviço de chamadas recusou a ligação" e não tem o que fazer.
 */

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refusedCallPatch, vpsRefusalCode } from "./vps-refusal.ts";

// ─── o caso de produção, pelos dois caminhos ────────────────────────────────

// A VPS de HOJE, sem `code`. Este é o corpo exato que ficou gravado em
// `voip_calls.end_reason` como `vps_refused:51985960716: number is not on WhatsApp`.
Deno.test("a recusa literal de produção deixa de ser vps_refused (VPS sem code)", () => {
  const codigo = vpsRefusalCode({
    status: 404,
    error: "51985960716: number is not on WhatsApp",
  });

  assertEquals(codigo, "peer_not_on_whatsapp");
  assertNotEquals(codigo, "vps_refused");
});

// A VPS nova, com código estável. É a fonte preferida.
Deno.test("a VPS com code é a fonte preferida", () => {
  assertEquals(
    vpsRefusalCode({
      status: 404,
      error: "51985960716: number is not on WhatsApp",
      code: "peer_not_on_whatsapp",
    }),
    "peer_not_on_whatsapp",
  );
});

// O código ganha da prosa quando os dois discordam — é o ponto de existir um
// código: prosa muda, código não.
Deno.test("o code vence a prosa quando discordam", () => {
  assertEquals(
    vpsRefusalCode({
      status: 503,
      error: "51985960716: number is not on WhatsApp",
      code: "session_not_paired",
    }),
    "session_not_paired",
  );
});

// ─── "não existe" nunca pode virar "tente de novo" ──────────────────────────

// Falha ao FALAR com o WhatsApp e "o número não existe" dão conselhos opostos.
// A VPS produz a primeira como `fmt.Errorf("resolving %s: %w", ...)`.
Deno.test("falha ao falar com o WhatsApp não vira número inexistente", () => {
  const codigo = vpsRefusalCode({
    status: 502,
    error: "resolving 5551985960716: socket fechado",
  });

  assertEquals(codigo, "whatsapp_unreachable");
  assertNotEquals(codigo, "peer_not_on_whatsapp");
});

// ─── os outros motivos que a mesma rota produz ──────────────────────────────

Deno.test("os demais motivos da rota de iniciar chamada têm código próprio", () => {
  const casos: ReadonlyArray<readonly [number, string, string]> = [
    [503, "not paired", "session_not_paired"],
    [409, "operator already on a call", "operator_busy"],
    [429, "max concurrent calls", "org_concurrency_reached"],
    [400, "phone required", "invalid_peer"],
  ];

  for (const [status, error, esperado] of casos) {
    assertEquals(vpsRefusalCode({ status, error }), esperado, `prosa: ${error}`);
  }
});

Deno.test("os mesmos motivos, agora pelo code estável da VPS", () => {
  const casos: ReadonlyArray<readonly [string, string]> = [
    ["session_not_paired", "session_not_paired"],
    ["operator_busy", "operator_busy"],
    ["max_concurrent_calls", "org_concurrency_reached"],
    ["peer_phone_required", "invalid_peer"],
    ["whatsapp_unreachable", "whatsapp_unreachable"],
  ];

  for (const [code, esperado] of casos) {
    assertEquals(vpsRefusalCode({ status: 500, error: "", code }), esperado, `code: ${code}`);
  }
});

// ─── "não respondeu" é diferente de "recusou" ───────────────────────────────

// `callVps` classifica isto antes: 504 timeout, 502 rede. É a primeira pergunta
// de qualquer incidente de voz, e não pode cair no mesmo balde de uma recusa.
Deno.test("timeout e falha de rede viram vps_unreachable, não vps_refused", () => {
  assertEquals(
    vpsRefusalCode({ status: 504, error: "timeout falando com a VPS" }),
    "vps_unreachable",
  );
  assertEquals(
    vpsRefusalCode({ status: 502, error: "falha de rede: TypeError: fetch failed" }),
    "vps_unreachable",
  );
});

// ─── fim de linha ───────────────────────────────────────────────────────────

// O balde genérico continua existindo — este conserto tira causas de dentro
// dele, não o elimina. O que não pode é uma causa conhecida cair aqui.
Deno.test("motivo desconhecido continua caindo em vps_refused", () => {
  assertEquals(vpsRefusalCode({ status: 500, error: "algo novo e não mapeado" }), "vps_refused");
  assertEquals(vpsRefusalCode({ status: 500, error: "" }), "vps_refused");
});

// Código futuro da VPS que o CRM não conhece NÃO pode vazar para a tabela de
// mensagens do front — lá ele viraria o fallback genérico sem ninguém perceber
// que um código novo apareceu. Cai no balde conhecido, de propósito.
Deno.test("code desconhecido da VPS não vaza para o front", () => {
  assertEquals(
    vpsRefusalCode({ status: 418, error: "prosa qualquer", code: "codigo_que_ainda_nao_existe" }),
    "vps_refused",
  );
});

// ─── como a recusa fica registrada no ledger ────────────────────────────────

const AGORA = "2026-08-03T13:43:06.697Z";

// `expired` significa "a reserva venceu sem ser usada e o reaper a recolheu" —
// é o que `fn_voip_call_reserve` grava, com `end_reason = 'reservation_expired'`.
// A recusa da VPS chegou em ~400ms, com resposta na mão. Marcar isso como
// "expirou" faz quem lê o histórico procurar timeout onde houve um 404 limpo.
Deno.test("recusa da VPS termina a chamada como 'ended', não 'expired'", () => {
  const patch = refusedCallPatch("peer_not_on_whatsapp", "51985960716: number is not on WhatsApp", AGORA);

  assertEquals(patch.status, "ended");
  assertNotEquals(patch.status as string, "expired");
});

// O motivo começa pelo código estável. Antes era `vps_refused:<prosa>` — prefixo
// idêntico para toda causa, então filtrar o histórico por causa exigia casar
// substring em inglês.
Deno.test("o motivo começa pelo código estável e mantém a prosa atrás", () => {
  const patch = refusedCallPatch("peer_not_on_whatsapp", "51985960716: number is not on WhatsApp", AGORA);

  assert(
    patch.end_reason.startsWith("peer_not_on_whatsapp:"),
    `end_reason = ${patch.end_reason}`,
  );
  assert(patch.end_reason.includes("number is not on WhatsApp"));
});

// A coluna tem teto. Prosa longa da VPS não pode derrubar o UPDATE — se
// derrubasse, a reserva ficaria segurando cota até o reaper passar, que é
// justamente o que esta função existe para evitar.
Deno.test("motivo longo é truncado em 200 e não derruba o UPDATE", () => {
  const patch = refusedCallPatch("vps_refused", "x".repeat(500), AGORA);

  assertEquals(patch.end_reason.length, 200);
  assert(patch.end_reason.startsWith("vps_refused:"));
});

Deno.test("o instante é o mesmo em ended_at e updated_at", () => {
  const patch = refusedCallPatch("vps_refused", "seja lá o que for", AGORA);

  assertEquals(patch.ended_at, AGORA);
  assertEquals(patch.updated_at, AGORA);
});
